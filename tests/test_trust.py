"""Data validation, provenance, hardened API behaviour and the Pages config."""

import httpx
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from investiq import api
from investiq.analysis.report import build_report
from investiq.build_static import site_config
from investiq.data import http as http_mod
from investiq.data.provenance import source
from investiq.data.provider import DemoProvider, set_provider
from investiq.data.validation import validate_history


@pytest.fixture
def client():
    set_provider(DemoProvider(end="2026-10-07"))
    return TestClient(api.app)


def test_validation_flags_bad_prices():
    idx = pd.bdate_range("2026-01-01", periods=50)
    close = pd.Series(100.0, index=idx)
    close.iloc[20] = 300.0   # bad print
    close.iloc[30] = -1.0    # impossible
    hist = pd.DataFrame({"Close": close})
    msgs = " ".join(w["message"] for w in validate_history(hist, today=pd.Timestamp("2026-06-30")))
    assert "non-positive" in msgs and "above 60%" in msgs and "days old" in msgs


def test_validation_clean_series_is_quiet():
    idx = pd.bdate_range(end="2026-10-07", periods=300)
    hist = pd.DataFrame({"Close": pd.Series(range(100, 400), index=idx, dtype=float)})
    assert validate_history(hist, today=pd.Timestamp("2026-10-07")) == []


def test_provenance_record_shape():
    s = source("price_history", "yahoo", as_of="2026-10-07", currency="INR")
    assert s["provider_label"].startswith("Yahoo") and s["status"] == "actual" and s["fetched_at"]
    with pytest.raises(ValueError):
        source("x", "yahoo", status="guess")


def test_report_carries_sources_and_section_map():
    r = build_report(DemoProvider(end="2026-10-07"), "TCS")
    ids = {s["id"] for s in r["sources"]}
    assert {"price_history", "company_profile", "financial_statements", "method_valuation"} <= ids
    for section, refs in r["section_sources"].items():
        assert refs, section
    assert r["generated_at"] and r["quote"]["source"] == "price_history" and r["quote"]["realtime"] is False
    assert isinstance(r["data_quality"], list)


def test_live_quote_overrides_report_price(monkeypatch):
    monkeypatch.setenv("FINNHUB_API_KEY", "k")
    payload = {"c": 999.0, "d": 9.0, "dp": 0.91, "h": 1000, "l": 980, "o": 990, "pc": 990.0, "t": 1759851000}
    http_mod.set_client(httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(200, json=payload))))
    r = build_report(DemoProvider(end="2026-10-07"), "AAPL", live_quotes=True)
    assert r["quote"]["price"] == 999.0 and r["quote"]["realtime"] is True
    live = next(s for s in r["sources"] if s["id"] == "live_quote")
    assert live["provider"] == "finnhub" and live["realtime"] is True


def test_health_lists_providers_without_secrets(client, monkeypatch):
    monkeypatch.setenv("FMP_API_KEY", "super-secret-value")
    body = client.get("/api/health").json()
    fmp = next(p for p in body["providers"] if p["id"] == "fmp")
    assert fmp["configured"] is True and fmp["env_vars"] == ["FMP_API_KEY"]
    assert "super-secret-value" not in str(body)
    assert body["ai"] == {"configured": False}


def test_quote_endpoint_falls_back_to_last_close(client):
    q = client.get("/api/quote/TCS").json()
    assert q["symbol"] == "TCS.NS" and q["realtime"] is False and q["source"]["id"] == "price_history"


def test_cors_allows_only_configured_origins(client):
    ok = client.get("/api/health", headers={"Origin": "https://atulswain.github.io"})
    assert ok.headers.get("access-control-allow-origin") == "https://atulswain.github.io"
    bad = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in bad.headers


def test_rate_limit(client, monkeypatch):
    monkeypatch.setattr(api, "limiter", api.RateLimiter(3))
    codes = [client.get("/api/search", params={"q": "tcs"}).status_code for _ in range(5)]
    assert codes == [200, 200, 200, 429, 429]
    assert client.get("/api/health").status_code == 200  # health is never limited


def test_rate_limit_ignores_spoofed_forwarded_for(client, monkeypatch):
    monkeypatch.setattr(api, "limiter", api.RateLimiter(2))
    # The proxy appends the real IP last; the client-controlled first entry changes every time.
    codes = [client.get("/api/search", params={"q": "tcs"},
                        headers={"X-Forwarded-For": f"10.0.0.{i}, 203.0.113.7"}).status_code for i in range(3)]
    assert codes == [200, 200, 429]


def test_unexpected_errors_do_not_leak(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("https://x.io/?apikey=SECRET")
    monkeypatch.setattr(api, "build_report", boom)
    set_provider(DemoProvider(end="2026-10-07"))
    res = TestClient(api.app, raise_server_exceptions=False).get("/api/report/TCS")
    assert res.status_code == 500 and "SECRET" not in res.text


def test_site_config():
    assert site_config(None) == 'window.INVESTIQ_CONFIG = {"static": true};\n'
    assert '"apiBase": "https://investiq-api.onrender.com"' in site_config("https://investiq-api.onrender.com/")
    for bad in ("http://insecure.example", "javascript:alert(1)", "https://x.com/\";alert(1)//"):
        with pytest.raises(ValueError):
            site_config(bad)
