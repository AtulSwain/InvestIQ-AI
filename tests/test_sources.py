"""Data providers, fallbacks, caching, quotas and secret handling - all offline via httpx.MockTransport.

The sample payloads mirror each provider's documented response shape.
"""

import json

import httpx
import pandas as pd
import pytest
import yfinance

from investiq.data import cache as cache_mod
from investiq.data import http as http_mod
from investiq.data.http import AuthError, RateLimitError, redact
from investiq.data.provider import YahooProvider
from investiq.data.sources import get_source, live_quote, provider_status, us_history_fallback

SECRET = "sk-test-SECRET123"

SAMPLES = {
    ("data.alpaca.markets", "/v2/stocks/AAPL/snapshot"): {
        "latestTrade": {"p": 201.5, "t": "2026-10-07T15:30:01Z"},
        "dailyBar": {"o": 199.0, "h": 202.0, "l": 198.5, "c": 201.4, "v": 1_200_000},
        "prevDailyBar": {"c": 200.0},
    },
    ("finnhub.io", "/api/v1/quote"): {"c": 201.0, "d": 1.0, "dp": 0.5, "h": 202, "l": 198, "o": 199,
                                      "pc": 200.0, "t": 1759851000},
    ("api.twelvedata.com", "/quote"): {"symbol": "AAPL", "close": "200.9", "previous_close": "200.0",
                                       "change": "0.9", "percent_change": "0.45", "open": "199", "high": "202",
                                       "low": "198", "volume": "5000000", "timestamp": 1759851000},
    ("financialmodelingprep.com", "/stable/quote"): [{"symbol": "AAPL", "price": 200.8, "previousClose": 200.0,
                                                      "change": 0.8, "changePercentage": 0.4, "dayHigh": 202,
                                                      "dayLow": 198, "open": 199, "volume": 4e6,
                                                      "timestamp": 1759851000}],
    ("www.alphavantage.co", "/query"): {"Global Quote": {"01. symbol": "AAPL", "02. open": "199.0",
                                                         "03. high": "202.0", "04. low": "198.0",
                                                         "05. price": "200.7", "06. volume": "4000000",
                                                         "07. latest trading day": "2026-10-07",
                                                         "08. previous close": "200.0", "09. change": "0.7",
                                                         "10. change percent": "0.35%"}},
}


def history_rows(n=300):
    dates = pd.bdate_range(end="2026-10-07", periods=n)
    return [{"date": d.strftime("%Y-%m-%d"), "open": 100 + i * 0.1, "high": 101 + i * 0.1, "low": 99 + i * 0.1,
             "close": 100 + i * 0.1, "volume": 1e6} for i, d in enumerate(dates)]


class Recorder:
    """Mock transport that serves SAMPLES, records requests and can inject failures per host."""

    def __init__(self, overrides=None):
        self.requests = []
        self.overrides = overrides or {}

    def __call__(self, request: httpx.Request):
        self.requests.append(request)
        key = (request.url.host, request.url.path)
        if request.url.host in self.overrides:
            status, body = self.overrides[request.url.host]
            return httpx.Response(status, json=body)
        if key == ("financialmodelingprep.com", "/stable/historical-price-eod/full"):
            return httpx.Response(200, json=history_rows())
        if key == ("financialmodelingprep.com", "/stable/profile"):
            return httpx.Response(200, json=[{"companyName": "Apple Inc.", "sector": "Technology",
                                              "currency": "USD", "marketCap": 3e12, "beta": 1.2}])
        if key in SAMPLES:
            return httpx.Response(200, json=SAMPLES[key])
        return httpx.Response(404, json={})

    def hosts(self):
        return [r.url.host for r in self.requests]


@pytest.fixture
def mock_http():
    def install(overrides=None):
        rec = Recorder(overrides)
        http_mod.set_client(httpx.Client(transport=httpx.MockTransport(rec)))
        return rec
    return install


def set_keys(monkeypatch, *names):
    env = {"alpaca": ["ALPACA_API_KEY_ID", "ALPACA_API_SECRET_KEY"], "finnhub": ["FINNHUB_API_KEY"],
           "twelvedata": ["TWELVEDATA_API_KEY"], "fmp": ["FMP_API_KEY"], "alphavantage": ["ALPHAVANTAGE_API_KEY"]}
    for n in names:
        for var in env[n]:
            monkeypatch.setenv(var, SECRET)


@pytest.mark.parametrize("provider,expected_price,realtime", [
    ("alpaca", 201.5, True), ("finnhub", 201.0, True), ("twelvedata", 200.9, False),
    ("fmp", 200.8, False), ("alphavantage", 200.7, False),
])
def test_each_provider_parses_its_quote(monkeypatch, mock_http, provider, expected_price, realtime):
    set_keys(monkeypatch, provider)
    mock_http()
    q = get_source(provider).quote("AAPL")
    assert q["price"] == expected_price
    assert q["provider"] == provider and q["realtime"] is realtime
    assert q["change_pct"] == pytest.approx((expected_price / 200 - 1) * 100, abs=0.06)


def test_no_keys_means_no_calls(mock_http):
    rec = mock_http()
    assert live_quote("AAPL") == (None, [])
    assert rec.requests == []


def test_quote_chain_falls_back_in_order(monkeypatch, mock_http):
    set_keys(monkeypatch, "alpaca", "finnhub", "fmp")
    rec = mock_http({"data.alpaca.markets": (500, {}), "finnhub.io": (401, {})})
    q, errors = live_quote("AAPL")
    assert q["provider"] == "fmp"
    assert any("alpaca" in e for e in errors) and any("finnhub" in e for e in errors)
    # 500s are retried, 401 is not.
    assert rec.hosts().count("data.alpaca.markets") == 3
    assert rec.hosts().count("finnhub.io") == 1


def test_india_uses_yahoo_not_keyed_quotes(monkeypatch, mock_http):
    set_keys(monkeypatch, "alpaca", "finnhub", "fmp")
    rec = mock_http()
    assert live_quote("RELIANCE.NS") == (None, [])
    assert rec.requests == []


def test_errors_inside_200_responses(monkeypatch, mock_http):
    set_keys(monkeypatch, "twelvedata", "alphavantage")
    mock_http({"api.twelvedata.com": (200, {"status": "error", "code": 401, "message": "Invalid API key"}),
               "www.alphavantage.co": (200, {"Information": "You have reached the 25 requests/day limit"})})
    with pytest.raises(AuthError):
        get_source("twelvedata").quote("AAPL")
    with pytest.raises(RateLimitError):
        get_source("alphavantage").quote("AAPL")


def test_responses_are_cached(monkeypatch, mock_http):
    set_keys(monkeypatch, "finnhub")
    rec = mock_http()
    get_source("finnhub").quote("AAPL")
    get_source("finnhub").quote("AAPL")
    assert len(rec.requests) == 1


def test_daily_quota_is_enforced(monkeypatch, mock_http):
    set_keys(monkeypatch, "alphavantage")
    mock_http()
    c = cache_mod.get_cache()
    for _ in range(25):
        c.count_call("alphavantage")
    with pytest.raises(RateLimitError, match="daily quota"):
        get_source("alphavantage").quote("MSFT")


def test_secrets_never_leak(monkeypatch, mock_http, tmp_path):
    set_keys(monkeypatch, "fmp", "finnhub")
    cache_mod.set_cache(cache_mod.Cache(tmp_path / "c.sqlite3"))
    mock_http({"financialmodelingprep.com": (500, {})})
    _, errors = live_quote("AAPL")
    assert SECRET not in json.dumps(errors)
    assert SECRET not in json.dumps(provider_status())
    # Cache keys on disk must not contain the key either.
    raw = (tmp_path / "c.sqlite3").read_bytes()
    assert SECRET.encode() not in raw
    assert redact(f"https://x.io/q?symbol=A&apikey={SECRET}&token={SECRET}") == "https://x.io/q?symbol=A&apikey=***&token=***"


def test_disk_cache_survives_restart(tmp_path):
    path = tmp_path / "c.sqlite3"
    cache_mod.Cache(path).set("k", {"v": 1}, ttl=60)
    assert cache_mod.Cache(path).get("k") == {"v": 1}
    cache_mod.Cache(path).set("old", 1, ttl=-1)
    assert cache_mod.Cache(path).get("old") is None


def test_symbol_spelling_per_provider(monkeypatch, mock_http):
    set_keys(monkeypatch, "finnhub")
    rec = mock_http()
    q = get_source("finnhub").quote("BRK-B")
    assert rec.requests[0].url.params["symbol"] == "BRK.B"  # Finnhub spells class shares with a dot
    assert q["symbol"] == "BRK-B"                            # but InvestIQ keeps the Yahoo spelling


def test_us_history_fallback_when_yahoo_fails(monkeypatch, mock_http):
    set_keys(monkeypatch, "fmp")
    mock_http()

    class Broken:
        def __init__(self, *_):
            pass

        def history(self, **_):
            raise RuntimeError("Too Many Requests")

    monkeypatch.setattr(yfinance, "Ticker", Broken)
    data = YahooProvider().get_stock("AAPL")
    assert len(data.history) == 300
    assert data.info["longName"] == "Apple Inc."
    assert {s["id"]: s["provider"] for s in data.sources} == {"price_history": "fmp", "company_profile": "fmp"}
    assert "Yahoo Finance was unavailable" in data.notes[0]

    rows, provider, _ = us_history_fallback("RELIANCE.NS")
    assert rows is None and provider is None
