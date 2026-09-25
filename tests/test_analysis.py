import json

import numpy as np
import pandas as pd
import pytest

from investiq.analysis.performance import cagr, sip_backtest, trailing_returns
from investiq.analysis.projection import analyze_projection
from investiq.analysis.report import build_comparison, build_report
from investiq.analysis.risk import drawdown_episodes
from investiq.analysis.technicals import rsi
from investiq.analysis.valuation import dcf_value, graham_number
from investiq.data.provider import DemoProvider
from investiq.data.symbols import benchmark_for, resolve_candidates


@pytest.fixture(scope="module")
def provider():
    return DemoProvider(end="2026-09-24")


def _series(values, start="2015-01-01"):
    return pd.Series(values, index=pd.bdate_range(start, periods=len(values)), dtype=float)


def test_cagr_doubling_in_ten_years():
    assert cagr(100, 200, 10) == pytest.approx(0.07177, abs=1e-4)
    assert cagr(0, 200, 10) is None


def test_trailing_returns_on_steady_growth():
    idx = pd.bdate_range("2014-01-01", "2026-01-01")
    close = pd.Series(100 * 1.10 ** ((idx - idx[0]).days / 365.25), index=idx)
    rows = {r["period"]: r for r in trailing_returns(close)}
    assert rows["1Y"]["total_return_pct"] == pytest.approx(10, abs=0.3)
    assert rows["10Y"]["cagr_pct"] == pytest.approx(10, abs=0.1)
    assert "15Y" not in rows  # not enough history


def test_drawdown_episode_detects_crash_and_recovery():
    close = _series([100, 110, 120, 60, 80, 125, 130])
    ep = drawdown_episodes(close, min_depth=0.1)[0]
    assert ep["depth_pct"] == -50.0
    assert ep["peak_price"] == 120
    assert ep["trough_price"] == 60
    assert ep["recovered"] is True


def test_rsi_bounds():
    rising = _series(np.linspace(100, 200, 60))
    assert rsi(rising).iloc[-1] == 100
    noisy = _series(100 + np.random.default_rng(1).normal(0, 1, 300).cumsum())
    assert 0 <= rsi(noisy).dropna().iloc[-1] <= 100


def test_valuation_models():
    assert graham_number(10, 100) == pytest.approx(150)
    assert graham_number(-1, 100) is None
    # Zero-growth perpetuity-ish check: value must be positive and finite.
    v = dcf_value(fcf=100, shares=10, growth=0.05, discount=0.10, terminal=0.03)
    assert 100 < v < 300
    assert dcf_value(fcf=-5, shares=10, growth=0.05, discount=0.1, terminal=0.03) is None


def test_sip_backtest_flat_price_breaks_even():
    idx = pd.bdate_range("2020-01-01", "2026-01-01")
    close = pd.Series(100.0, index=idx)
    res = sip_backtest(close, monthly=1000, years=3)
    assert res["value"] == pytest.approx(res["invested"])
    assert abs(res["xirr_pct"]) < 0.01


def test_projection_percentiles_are_ordered(provider):
    close = provider.get_history("TCS.NS")["Close"]
    proj = analyze_projection(close, "IN")
    for h in proj["horizons"]:
        assert h["bear"]["price"] < h["base"]["price"] < h["bull"]["price"]


def test_symbol_resolution():
    assert resolve_candidates("reliance")[0] == "RELIANCE.NS"
    assert resolve_candidates("Infosys")[0] == "INFY.NS"
    assert resolve_candidates("zomato") == ["ETERNAL.NS"]
    assert resolve_candidates("AAPL") == ["AAPL"]
    assert resolve_candidates("infy.bo") == ["INFY.BO"]
    assert benchmark_for("TCS.NS") == "^NSEI"
    assert benchmark_for("MSFT") == "^GSPC"


def test_full_report_is_complete_and_json_safe(provider):
    r = build_report(provider, "reliance")
    assert r["symbol"] == "RELIANCE.NS"
    assert r["is_demo"] is True
    for key in ("performance", "risk", "technicals", "fundamentals", "valuation", "projection", "scorecard"):
        assert r[key]
    periods = {t["period"] for t in r["performance"]["trailing"]}
    assert {"1Y", "10Y"} <= periods
    assert r["valuation"]["fair_value"]["low"] <= r["valuation"]["fair_value"]["high"]
    assert 0 <= r["scorecard"]["overall"] <= 10
    json.dumps(r, allow_nan=False)  # raises on NaN / inf


def test_comparison(provider):
    res = build_comparison(provider, ["RELIANCE", "TCS"])
    assert [s["symbol"] for s in res["stocks"]] == ["RELIANCE.NS", "TCS.NS"]
