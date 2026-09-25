import json

import numpy as np
import pandas as pd
import pytest

from investiq.analysis.decision import trade_plan
from investiq.analysis.financials import altman_z, piotroski
from investiq.analysis.performance import dividend_history, monthly_returns, rolling_returns
from investiq.analysis.report import build_report
from investiq.analysis.valuation import (
    dcf_value,
    dividend_discount_value,
    implied_growth,
    lynch_value,
)
from investiq.data.provider import DemoProvider


@pytest.fixture(scope="module")
def report():
    return build_report(DemoProvider(end="2026-09-24"), "TCS")


def test_reverse_dcf_recovers_growth():
    price = dcf_value(100, 10, 0.12, 0.12, 0.05, net_debt=50)
    assert implied_growth(price, 100, 10, 0.12, 0.05, 50) == pytest.approx(0.12, abs=1e-4)
    assert implied_growth(100, -5, 10, 0.12, 0.05, 0) is None


def test_simple_models():
    assert lynch_value(10, 15) == 150
    assert lynch_value(10, 60) == 250  # growth capped at 25
    assert dividend_discount_value(10, 0.05, 0.12) == pytest.approx(150)
    assert dividend_discount_value(10, 0.12, 0.12) is None


def _fin(**cols):
    idx = pd.to_datetime(["2024-03-31", "2025-03-31"])
    return pd.DataFrame(cols, index=idx, dtype=float)


def test_piotroski_perfect_and_weak():
    good = _fin(net_income=[80, 100], operating_cash_flow=[90, 130], total_assets=[1000, 1000],
                long_term_debt=[300, 200], current_assets=[400, 500], current_liabilities=[300, 300],
                shares=[10, 10], gross_profit=[400, 450], revenue=[1000, 1100])
    res = piotroski(good)
    assert res["score"] == 9 and res["label"] == "Strong"
    bad = _fin(net_income=[100, -20], operating_cash_flow=[90, -30], total_assets=[1000, 1100],
               long_term_debt=[200, 400], current_assets=[500, 400], current_liabilities=[300, 400],
               shares=[10, 12], gross_profit=[450, 380], revenue=[1100, 1000])
    assert piotroski(bad)["score"] == 0


def test_altman_zones():
    df = _fin(total_assets=[1000, 1000], total_liabilities=[400, 400], current_assets=[500, 500],
              current_liabilities=[200, 200], retained_earnings=[400, 400], ebit=[200, 200], revenue=[1200, 1200])
    assert altman_z(df, market_cap=3000, sector="Technology")["zone"] == "Safe"
    assert altman_z(df, market_cap=3000, sector="Financial Services")["z"] is None


def test_monthly_and_rolling_returns():
    idx = pd.bdate_range("2012-01-02", "2026-06-30")
    close = pd.Series(100 * 1.10 ** ((idx - idx[0]).days / 365.25), index=idx)
    months = monthly_returns(close, years=3)
    assert [m["year"] for m in months] == [2026, 2025, 2024]
    assert months[1]["total_pct"] == pytest.approx(10, abs=0.3)
    rolling = {r["years"]: r for r in rolling_returns(close)}
    assert rolling[5]["median_pct"] == pytest.approx(10, abs=0.3)
    assert rolling[5]["positive_pct"] == 100


def test_dividend_history():
    idx = pd.bdate_range("2015-01-01", "2026-06-30")
    close = pd.Series(100.0, index=idx)
    divs = pd.Series([1.0 * 1.1 ** i for i in range(11)],
                     index=pd.to_datetime([f"{2015 + i}-08-01" for i in range(11)]))
    d = dividend_history(divs, close)
    assert d["streak_years"] == 11
    assert d["growth_5y_pct"] == pytest.approx(10, abs=0.1)
    assert dividend_history(pd.Series(dtype=float), close)["paid"] is False


def test_trade_plan_levels_are_ordered(report):
    p = report["trade_plan"]
    assert p["stop_loss"] < p["entry_low"] <= p["entry_high"] <= p["price"]
    assert p["stop_loss"] >= p["entry_high"] * 0.85 - 0.01
    prices = [t["price"] for t in p["targets"]]
    assert prices == sorted(prices) and all(t > p["entry_high"] for t in prices)


def test_trade_plan_far_above_fair_value_has_no_targets():
    tech = {"atr": 2.0, "levels": {"support_3m": 90, "resistance_6m": 120}}
    val = {"fair_value": {"low": 20, "mid": 30, "high": 60}}
    proj = {"horizons": [{"years": 1, "base": {"price": 110}}]}
    p = trade_plan(100, tech, val, {"analyst": {}}, proj)
    assert p["far_above_fair_value"] is True
    assert p["targets"] == [] and p["risk_reward"] is None


def test_trade_plan_waits_when_overvalued():
    tech = {"atr": 2.0, "levels": {"support_3m": 90, "support_6m": 85}}
    val = {"fair_value": {"low": 60, "mid": 70, "high": 80}}
    proj = {"horizons": [{"years": 1, "base": {"price": 105}}]}
    p = trade_plan(100, tech, val, {"analyst": {}}, proj)
    assert p["wait_for_pullback"] is True
    assert p["entry_high"] == 70
    assert p["stop_loss"] < p["entry_low"] < 70  # support at 90 is above the entry, so it's ignored


def test_report_has_new_sections(report):
    for key in ("checklist", "trade_plan", "financials", "breakdown"):
        assert report[key]
    assert report["checklist"]["evaluated"] >= 10
    assert report["financials"]["piotroski"]["out_of"] == 9
    assert report["valuation"]["dcf_sensitivity"]["values"][2][2] is not None
    assert len(report["breakdown"]["seasonality"]) == 12
    json.dumps(report, allow_nan=False)
