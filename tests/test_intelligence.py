"""Market intelligence, extended company data, metrics, risk, peers, portfolio, thesis and AI."""

from types import SimpleNamespace as NS

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from investiq import ai, api
from investiq.analysis.market import market_overview, movers_and_sectors, upcoming_earnings
from investiq.analysis.news import big_moves_with_news, classify, enrich_news, link_to_price
from investiq.analysis.peers import positioning, summary_row
from investiq.analysis.portfolio import analyze_portfolio
from investiq.analysis.report import build_report
from investiq.analysis.thesis import check_thesis
from investiq.data.extended import parse_earnings_dates, parse_major_holders, parse_news, parse_quarterly
from investiq.data.provider import DemoProvider, set_provider

DEMO = DemoProvider(end="2026-10-07")


@pytest.fixture(scope="module")
def report():
    return build_report(DEMO, "RELIANCE")


@pytest.fixture
def client():
    set_provider(DEMO)
    return TestClient(api.app)


# ---------------------------------------------------------------- news

@pytest.mark.parametrize("title,cat", [
    ("Infosys Q2 results beat estimates, revenue up 8%", "earnings"),
    ("Adani Ports to acquire Australian terminal", "m&a"),
    ("SEBI issues show-cause notice to company", "regulatory"),
    ("Brokerage upgrades HDFC Bank, raises target price", "analyst"),
    ("Promoter pledge rises at Vedanta", "insider"),
    ("Company unveils new EV platform", "product"),
    ("Crude oil price surge hits paint makers", "macro"),
    ("Shares trade flat in a quiet session", "general"),
])
def test_news_classification(title, cat):
    assert classify(title) == cat


def test_parse_news_handles_both_yahoo_shapes():
    new = [{"content": {"title": "A", "summary": "s", "pubDate": "2026-10-01T10:00:00Z",
                        "provider": {"displayName": "Reuters"}, "canonicalUrl": {"url": "https://x/a"}}}]
    old = [{"title": "B", "publisher": "ET", "link": "https://x/b", "providerPublishTime": 1759312800}]
    a, b = parse_news(new)[0], parse_news(old)[0]
    assert (a["title"], a["publisher"], a["url"], a["published_at"][:10]) == ("A", "Reuters", "https://x/a", "2026-10-01")
    assert (b["title"], b["publisher"], b["url"]) == ("B", "ET", "https://x/b") and b["published_at"]


def test_enrich_dedupes_and_sorts():
    items = [{"title": "Same headline!", "published_at": "2026-10-01"}, {"title": "same headline", "published_at": "2026-10-02"},
             {"title": "Other", "published_at": "2026-10-03"}]
    out = enrich_news(items)
    assert [n["title"] for n in out] == ["Other", "Same headline!"]


def test_news_linked_to_price_moves():
    idx = pd.bdate_range("2026-09-01", periods=20)
    close = pd.Series(100.0, index=idx)
    close.iloc[10:] = 110.0  # +10% on idx[10]
    news = [{"title": "Big contract win", "published_at": idx[10].strftime("%Y-%m-%dT09:00:00Z"), "category": "product"}]
    linked = link_to_price(news, close)
    assert linked[0]["price_move"]["moved"] is True and linked[0]["price_move"]["change_pct"] == 10.0
    moves = big_moves_with_news(close, news, days=60)
    assert moves[0]["change_pct"] == 10.0 and moves[0]["headlines"][0]["title"] == "Big contract win"


def test_parse_earnings_and_quarterly():
    tz = "America/New_York"
    df = pd.DataFrame({"EPS Estimate": [1.5, 1.2, 1.0], "Reported EPS": [None, 1.3, 0.9], "Surprise(%)": [None, 8.3, -10.0]},
                      index=pd.DatetimeIndex([pd.Timestamp("2099-01-30", tz=tz), pd.Timestamp("2026-07-30", tz=tz),
                                              pd.Timestamp("2026-04-30", tz=tz)]))
    past, upcoming = parse_earnings_dates(df)
    assert [p["date"] for p in past] == ["2026-07-30", "2026-04-30"] and upcoming[0]["date"] == "2099-01-30"
    cols = pd.to_datetime([f"{y}-{m:02d}-30" for y in (2025, 2026) for m in (3, 6, 9, 12)][:8])
    inc = pd.DataFrame([[100 + i * 5 for i in range(8)], [10 + i for i in range(8)]],
                       index=["Total Revenue", "Net Income"], columns=cols)
    q = parse_quarterly(inc, pd.DataFrame())
    assert len(q) == 8 and q[-1]["revenue_yoy_pct"] == pytest.approx((135 / 115 - 1) * 100, abs=0.01)
    assert parse_major_holders(pd.DataFrame({"Value": {"insidersPercentHeld": 0.5}}))["insiders_pct"] == 50.0


# ---------------------------------------------------------------- market

def test_market_overview_and_movers():
    ov = market_overview(DEMO)
    names = {i["name"] for i in ov["instruments"]}
    assert {"NIFTY 50", "S&P 500", "USD/INR", "Gold"} <= names
    assert all(len(i["spark"]) == 60 for i in ov["instruments"])
    mv = movers_and_sectors(DEMO)
    g = mv["movers"]["IN"]["gainers"]
    assert [x["change_pct"] for x in g] == sorted([x["change_pct"] for x in g], reverse=True)
    assert any(s["sector"] == "Information Technology" and s["market"] == "IN" for s in mv["sectors"])


def test_upcoming_earnings_window():
    today = pd.Timestamp.today().normalize()
    ext = {"A": {"earnings": {"upcoming": [{"date": (today + pd.Timedelta(days=3)).strftime("%Y-%m-%d")}]}},
           "B": {"earnings": {"upcoming": [{"date": (today + pd.Timedelta(days=90)).strftime("%Y-%m-%d")}]}}}
    assert [r["symbol"] for r in upcoming_earnings(ext, days=45)] == ["A"]


# ---------------------------------------------------------------- metrics, risk, peers

def test_metric_registry_has_provenance(report):
    m = report["metrics"]
    for key in ("pe", "roe_pct", "roce_pct", "roic_pct", "fcf_yield_pct", "fair_value", "beta"):
        assert key in m and m[key]["source"] and m[key]["period"] and m[key]["status"] in ("actual", "estimate", "derived")
    assert m["fair_value"]["status"] == "estimate" and m["market_cap"]["currency"] == "INR"


def test_risk_profile_is_transparent(report):
    rp = report["risk_profile"]
    dims = {d["dimension"]: d for d in rp["dimensions"]}
    assert dims["Financial"]["evidence"] and dims["Competitive"]["level"] == "Not assessed"
    assert 0 <= rp["overall"] <= 10


def test_positioning_ranks():
    target = {"symbol": "A", "revenue": 300, "roe_pct": 20, "pe": 30, "debt_to_equity": 0.2}
    peers = [{"symbol": "B", "revenue": 100, "roe_pct": 25, "pe": 15, "debt_to_equity": 1.0},
             {"symbol": "C", "revenue": 100, "roe_pct": 10, "pe": -5, "debt_to_equity": 0.5}]
    p = positioning(target, peers)
    assert p["ranks"]["roe_pct"]["rank"] == 2 and p["ranks"]["debt_to_equity"]["rank"] == 1
    assert p["ranks"]["pe"] == {"rank": 2, "of": 2, "value": 30, "peer_median": 30}  # negative P/E excluded
    assert p["share_of_peer_revenue_pct"] == 60.0


def test_summary_row(report):
    row = summary_row(report)
    assert row["symbol"] == "RELIANCE.NS" and row["sector"] and "pe" in row and "score" in row


# ---------------------------------------------------------------- portfolio & thesis

def test_portfolio_mixed_currency():
    res = analyze_portfolio(DEMO, [{"symbol": "TCS", "quantity": 10, "avg_cost": 500},
                                   {"symbol": "AAPL", "quantity": 5, "avg_cost": 100},
                                   {"symbol": "NOPE.NS", "quantity": 1}], base="INR")
    assert len(res["holdings"]) == 3  # demo provider fabricates any symbol
    assert abs(sum(h["weight_pct"] for h in res["holdings"]) - 100) < 0.1
    aapl = next(h for h in res["holdings"] if h["symbol"] == "AAPL")
    assert aapl["value"] == pytest.approx(5 * aapl["price"] * res["usd_inr"], rel=1e-3)
    assert res["risk"]["correlation"]["matrix"] and res["allocation"]["country"]


def test_portfolio_rejects_implausible_fx(monkeypatch):
    real = DEMO.get_history

    def bad_fx(symbol, *a, **k):
        h = real(symbol, *a, **k)
        return h * 40 if symbol == "INR=X" else h  # e.g. a bad tick of ~3400

    monkeypatch.setattr(DEMO, "get_history", bad_fx)
    res = analyze_portfolio(DEMO, [{"symbol": "TCS", "quantity": 1}, {"symbol": "AAPL", "quantity": 1}], base="INR")
    assert res["usd_inr"] is None
    assert any("USD/INR" in e for e in res["errors"])


def test_demo_fx_is_plausible():
    assert 40 < float(DEMO.get_history("INR=X")["Close"].iloc[-1]) < 200


def test_thesis_check(report):
    m = report["metrics"]
    res = check_thesis(report, [
        {"metric": "roe_pct", "op": ">", "value": m["roe_pct"]["value"] - 1},
        {"metric": "debt_to_equity", "op": "<", "value": -1},
        {"metric": "no_such_metric", "op": ">", "value": 1},
    ], since="2026-01-01")
    assert [a["status"] for a in res["assumptions"]] == ["holds", "broken", "unknown"]
    assert res["status"] == "conflict"


# ---------------------------------------------------------------- AI

def _fake_response(content, stop="end_turn"):
    return NS(content=content, stop_reason=stop, model="claude-opus-5-5", usage=NS(input_tokens=10, output_tokens=5))


class FakeClient:
    def __init__(self, responses):
        self.calls = []
        self.responses = list(responses)
        self.beta = NS(messages=NS(create=self.create))

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.responses.pop(0)


def test_ai_documents_and_citations(report):
    docs = ai.documents_for(report)
    titles = [d[0]["title"] for d in docs]
    assert any("key metrics" in t for t in titles) and all(d[0]["citations"] == {"enabled": True} for d in docs)
    content = [
        NS(type="text", text="## Answer\n", citations=None),
        NS(type="text", text="ROE is strong", citations=[NS(type="char_location", document_index=0, cited_text="ROE: 19%")]),
        NS(type="text", text=" and a new plant opened", citations=[NS(type="web_search_result_location", url="https://n.example/x",
                                                                     title="Plant opens", cited_text="opened")]),
    ]
    blocks, sources = ai.parse_response(content, [d[1] for d in docs])
    assert [b["cites"] for b in blocks] == [[], [1], [2]]
    assert sources[0]["title"].endswith("key metrics") and sources[1]["url"] == "https://n.example/x"


def test_ai_run_handles_pause_turn_and_sends_fallbacks(monkeypatch, report):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    fake = FakeClient([_fake_response([NS(type="server_tool_use")], stop="pause_turn"),
                       _fake_response([NS(type="text", text="Done", citations=[])])])
    ai.set_client(fake)
    out = ai.run("Why did it move?", [report])
    assert len(fake.calls) == 2 and out["blocks"][0]["text"] == "Done"
    first = fake.calls[0]
    assert first["model"] == "claude-opus-5-5" and first["fallbacks"] == "default"
    assert first["betas"] == ["server-side-fallback-2026-07-01"] and first["output_config"] == {"effort": "medium"}
    assert first["tools"][0]["type"] == "web_search_20260209" and "thinking" not in first
    assert fake.calls[1]["messages"][-1]["role"] == "assistant"


def test_ai_refusal(monkeypatch, report):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    ai.set_client(FakeClient([_fake_response([], stop="refusal")]))
    assert ai.run("q", [report])["refused"] is True


def test_ai_endpoints(client, monkeypatch):
    assert client.post("/api/ai/ask", json={"question": "hi"}).status_code == 503
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    fake = FakeClient([_fake_response([NS(type="text", text="Summary", citations=[])])])
    ai.set_client(fake)
    r1 = client.get("/api/ai/summary/TCS").json()
    r2 = client.get("/api/ai/summary/TCS").json()
    assert r1["blocks"][0]["text"] == "Summary" and r2.get("cached") is True and len(fake.calls) == 1
    assert client.post("/api/ai/ask", json={"question": ""}).status_code == 400


# ---------------------------------------------------------------- endpoints

def test_market_and_research_endpoints(client):
    assert client.get("/api/market/overview").json()["instruments"]
    assert client.get("/api/market/movers").json()["sectors"]
    macro = client.get("/api/market/macro").json()
    assert macro["us_macro"]["available"] is False and macro["sensitivity"]
    assert "items" in client.get("/api/market/earnings").json()
    assert client.get("/api/market/news", params={"symbols": "TCS,INFY"}).json()["items"]
    ext = client.get("/api/extended/TCS").json()
    assert ext["news"] and ext["earnings"]["history"]
    peers = client.get("/api/peers/TCS").json()
    assert peers["target"]["symbol"] == "TCS.NS" and all(p["sector"] == "Information Technology" for p in peers["peers"])
    port = client.post("/api/portfolio", json={"holdings": [{"symbol": "TCS", "quantity": 1, "avg_cost": 700}]}).json()
    assert port["totals"]["value"] > 0
    th = client.post("/api/thesis/check", json={"symbol": "TCS", "assumptions": [{"metric": "pe", "op": "<", "value": 1000}]}).json()
    assert th["assumptions"][0]["status"] == "holds"


def test_ai_rate_limit(client, monkeypatch):
    monkeypatch.setattr(api, "ai_limiter", api.RateLimiter(1, window=3600))
    assert client.post("/api/ai/ask", json={"question": "a"}).status_code == 503  # allowed, not configured
    assert client.post("/api/ai/ask", json={"question": "a"}).status_code == 429


def test_metric_signals():
    from investiq.analysis.metrics import signal
    assert signal("roe_pct", 20) == "good" and signal("roe_pct", 10) == "ok" and signal("roe_pct", 3) == "weak"
    assert signal("pe", 15) == "good" and signal("pe", 50) == "weak" and signal("pe", -4) == "weak"
    assert signal("debt_to_equity", 3, financial_sector=True) is None
    assert signal("max_drawdown_pct", -20) == "good" and signal("max_drawdown_pct", -70) == "weak"
    assert signal("unknown", 1) is None and signal("roe_pct", None) is None
