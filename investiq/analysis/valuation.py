"""Rough intrinsic-value estimates. Each method is simple and transparent;
the blended range is more useful than any single number."""

from __future__ import annotations

import math
import statistics

from .util import clamp, num, pct

MARKET_ASSUMPTIONS = {
    # discount rate (cost of equity), terminal growth
    "IN": {"discount": 0.12, "terminal": 0.05},
    "US": {"discount": 0.09, "terminal": 0.025},
}


def graham_number(eps, bvps):
    if not eps or not bvps or eps <= 0 or bvps <= 0:
        return None
    return math.sqrt(22.5 * eps * bvps)


def graham_growth_value(eps, growth_pct):
    """Benjamin Graham's revised formula: EPS x (8.5 + 2g), g capped at 20%."""
    if not eps or eps <= 0 or growth_pct is None:
        return None
    g = clamp(growth_pct, 0, 20)
    return eps * (8.5 + 2 * g)


def dcf_value(fcf, shares, growth, discount, terminal, net_debt=0.0, years=10):
    """Two-stage DCF: growth fades linearly to the terminal rate over ``years``."""
    if not fcf or fcf <= 0 or not shares or discount <= terminal:
        return None
    pv, cash = 0.0, fcf
    for year in range(1, years + 1):
        g = growth + (terminal - growth) * (year - 1) / (years - 1)
        cash *= 1 + g
        pv += cash / (1 + discount) ** year
    terminal_value = cash * (1 + terminal) / (discount - terminal)
    pv += terminal_value / (1 + discount) ** years
    equity = pv - (net_debt or 0)
    return equity / shares if equity > 0 else None


def analyze_valuation(fund: dict, price: float, market: str, hist_cagr_pct=None) -> dict:
    a = MARKET_ASSUMPTIONS[market]
    growth_candidates = [
        g for g in (fund.get("profit_cagr_pct"), fund.get("revenue_cagr_pct"),
                    fund.get("earnings_growth_pct"), hist_cagr_pct) if g is not None
    ]
    growth_pct = clamp(statistics.median(growth_candidates), 0, 25) if growth_candidates else 8.0

    net_debt = None
    if fund.get("total_debt") is not None:
        net_debt = fund["total_debt"] - (fund.get("total_cash") or 0)

    methods = []

    def add(name, value, note):
        methods.append({"method": name, "value": num(value, 2), "note": note,
                        "upside_pct": pct(value / price - 1) if value else None})

    add("Graham number", graham_number(fund.get("eps"), fund.get("book_value_per_share")),
        "sqrt(22.5 x EPS x book value) - a conservative value-investor ceiling")
    add("Graham growth formula", graham_growth_value(fund.get("eps"), growth_pct),
        f"EPS x (8.5 + 2 x {growth_pct:.1f}% growth)")
    add("Discounted cash flow",
        dcf_value(fund.get("free_cash_flow"), fund.get("shares_outstanding"), growth_pct / 100,
                  a["discount"], a["terminal"], net_debt),
        f"10y FCF growth fading {growth_pct:.1f}% -> {a['terminal']*100:.1f}%, "
        f"discounted at {a['discount']*100:.0f}%")
    pe = fund.get("pe")
    eps = fund.get("eps")
    if eps and eps > 0 and pe:
        fair_pe = clamp(growth_pct * 1.5, 10, 35) if market == "IN" else clamp(growth_pct * 1.3, 10, 30)
        add("Earnings multiple", eps * fair_pe, f"EPS x a growth-justified P/E of {fair_pe:.1f}")
    analyst = (fund.get("analyst") or {}).get("target_mean")
    add("Analyst consensus", analyst, "Mean 12-month target from covering analysts")

    values = sorted(m["value"] for m in methods if m["value"])
    if values:
        # Drop extreme outliers (>4x apart from the median) so one broken input can't dominate.
        med = statistics.median(values)
        values = [v for v in values if med / 4 <= v <= med * 4]
    if not values:
        return {"methods": methods, "fair_value": None, "verdict": "Insufficient data",
                "growth_assumption_pct": num(growth_pct, 1)}

    fair = statistics.median(values)
    mos = fair / price - 1
    if mos > 0.25:
        verdict = "Undervalued"
    elif mos > 0.05:
        verdict = "Slightly undervalued"
    elif mos > -0.10:
        verdict = "Fairly valued"
    elif mos > -0.30:
        verdict = "Slightly overvalued"
    else:
        verdict = "Overvalued"
    return {
        "methods": methods,
        "fair_value": {"low": num(values[0], 2), "mid": num(fair, 2), "high": num(values[-1], 2)},
        "margin_of_safety_pct": pct(mos),
        "verdict": verdict,
        "growth_assumption_pct": num(growth_pct, 1),
        "discount_rate_pct": pct(a["discount"]),
        "note": "Rough estimates for education only. Banks/financials and loss-making "
                "companies are poorly captured by FCF and EPS-based models.",
    }
