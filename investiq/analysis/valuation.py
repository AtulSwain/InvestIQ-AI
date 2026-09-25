"""Rough intrinsic-value estimates. Each method is simple and transparent;
the blended range is more useful than any single number."""

from __future__ import annotations

import math
import statistics

import pandas as pd

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


def lynch_value(eps, growth_pct):
    """Peter Lynch: a fairly priced growth stock has P/E equal to its growth rate (PEG = 1)."""
    if not eps or eps <= 0 or growth_pct is None:
        return None
    return eps * clamp(growth_pct, 5, 25)


def dividend_discount_value(annual_dividend, growth, discount):
    """Gordon growth model: next year's dividend / (required return - dividend growth)."""
    if not annual_dividend or annual_dividend <= 0 or discount <= growth:
        return None
    return annual_dividend * (1 + growth) / (discount - growth)


def implied_growth(price, fcf, shares, discount, terminal, net_debt, years=10):
    """Reverse DCF: the FCF growth rate that the current price already assumes."""
    if not fcf or fcf <= 0 or not shares or not price:
        return None
    lo, hi = -0.30, 0.80
    f = lambda g: (dcf_value(fcf, shares, g, discount, terminal, net_debt, years) or 0) - price
    if f(lo) > 0 or f(hi) < 0:
        return None
    for _ in range(80):
        mid = (lo + hi) / 2
        if f(mid) > 0:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


def dcf_sensitivity(fcf, shares, growth, discount, terminal, net_debt):
    """Per-share DCF value across a grid of discount rates and growth rates."""
    if not fcf or fcf <= 0 or not shares:
        return None
    growths = [growth + d for d in (-0.04, -0.02, 0.0, 0.02, 0.04)]
    discounts = [discount + d for d in (-0.02, -0.01, 0.0, 0.01, 0.02)]
    return {
        "growth_pct": [pct(g, 1) for g in growths],
        "discount_pct": [pct(d, 1) for d in discounts],
        "values": [[num(dcf_value(fcf, shares, g, d, terminal, net_debt), 2) for g in growths]
                   for d in discounts],
    }


def pe_history(fin_years, close):
    """P/E at each fiscal year-end (price then / EPS that year)."""
    rows = []
    for y in fin_years or []:
        eps = y.get("eps")
        if not eps or eps <= 0 or close is None:
            continue
        d = pd.Timestamp(y["fiscal_year_end"])
        if d < close.index[0]:
            continue
        price = close.loc[:d].iloc[-1]
        rows.append({"fiscal_year_end": y["fiscal_year_end"], "price": num(price, 2),
                     "eps": num(eps, 2), "pe": num(price / eps, 1)})
    return rows


def multiples(fund, fin_years, price):
    mcap = fund.get("market_cap")
    latest = (fin_years or [{}])[-1] if fin_years else {}
    revenue = latest.get("revenue")
    ebitda = latest.get("ebitda")
    debt = fund.get("total_debt") or 0
    cash = fund.get("total_cash") or 0
    ev = mcap + debt - cash if mcap else None
    pe = fund.get("pe")
    fcf = fund.get("free_cash_flow")
    return {
        "enterprise_value": num(ev),
        "pe": pe,
        "forward_pe": fund.get("forward_pe"),
        "pb": fund.get("pb"),
        "ps": num(mcap / revenue, 2) if mcap and revenue else None,
        "ev_ebitda": num(ev / ebitda, 1) if ev and ebitda and ebitda > 0 else None,
        "ev_sales": num(ev / revenue, 2) if ev and revenue else None,
        "peg": fund.get("peg"),
        "earnings_yield_pct": pct(1 / pe) if pe and pe > 0 else None,
        "fcf_yield_pct": pct(fcf / mcap) if fcf and mcap else None,
        "dividend_yield_pct": fund.get("dividend_yield_pct"),
    }


def analyze_valuation(fund: dict, price: float, market: str, hist_cagr_pct=None,
                      fin_years=None, close=None, annual_dividend=None, dividend_growth=None) -> dict:
    a = MARKET_ASSUMPTIONS[market]
    growth_candidates = [
        g for g in (fund.get("profit_cagr_pct"), fund.get("revenue_cagr_pct"),
                    fund.get("earnings_growth_pct"), hist_cagr_pct) if g is not None
    ]
    growth_pct = clamp(statistics.median(growth_candidates), 0, 25) if growth_candidates else 8.0

    net_debt = None
    if fund.get("total_debt") is not None:
        net_debt = fund["total_debt"] - (fund.get("total_cash") or 0)
    fcf, shares, eps = fund.get("free_cash_flow"), fund.get("shares_outstanding"), fund.get("eps")

    methods = []

    def add(name, value, note):
        methods.append({"method": name, "value": num(value, 2), "note": note,
                        "upside_pct": pct(value / price - 1) if value else None})

    add("Graham number", graham_number(eps, fund.get("book_value_per_share")),
        "sqrt(22.5 x EPS x book value) - a conservative value-investor ceiling")
    add("Graham growth formula", graham_growth_value(eps, growth_pct),
        f"EPS x (8.5 + 2 x {growth_pct:.1f}% growth)")
    add("Discounted cash flow",
        dcf_value(fcf, shares, growth_pct / 100, a["discount"], a["terminal"], net_debt),
        f"10y FCF growth fading {growth_pct:.1f}% -> {a['terminal']*100:.1f}%, "
        f"discounted at {a['discount']*100:.0f}%")
    pe = fund.get("pe")
    if eps and eps > 0 and pe:
        fair_pe = clamp(growth_pct * 1.5, 10, 35) if market == "IN" else clamp(growth_pct * 1.3, 10, 30)
        add("Earnings multiple", eps * fair_pe, f"EPS x a growth-justified P/E of {fair_pe:.1f}")
    add("Peter Lynch (PEG = 1)", lynch_value(eps, growth_pct),
        f"EPS x growth rate ({clamp(growth_pct, 5, 25):.1f}) - fair when P/E equals growth")

    pe_hist = pe_history(fin_years, close)
    avg_pe = statistics.mean(r["pe"] for r in pe_hist) if len(pe_hist) >= 2 else None
    if avg_pe and eps and eps > 0:
        add("Historical P/E average", eps * avg_pe,
            f"EPS x the stock's own average P/E of {avg_pe:.1f} over {len(pe_hist)} years")

    d_growth = clamp(dividend_growth if dividend_growth is not None else 0.05, 0, a["discount"] - 0.03)
    # Only meaningful for real dividend payers (1.5%+ yield).
    ddm = dividend_discount_value(annual_dividend, d_growth, a["discount"]) \
        if annual_dividend and annual_dividend / price >= 0.015 else None
    if ddm:
        add("Dividend discount", ddm,
            f"Next dividend / ({a['discount']*100:.0f}% - {d_growth*100:.1f}% dividend growth)")
    analyst = (fund.get("analyst") or {}).get("target_mean")
    add("Analyst consensus", analyst, "Mean 12-month target from covering analysts")

    implied = implied_growth(price, fcf, shares, a["discount"], a["terminal"], net_debt)
    extras = {
        "multiples": multiples(fund, fin_years, price),
        "pe_history": pe_hist,
        "average_pe": num(avg_pe, 1),
        "reverse_dcf": {
            "implied_growth_pct": pct(implied, 1),
            "assumed_growth_pct": num(growth_pct, 1),
            "reading": None if implied is None else (
                "The price assumes faster growth than the company has delivered - expectations are high."
                if implied * 100 > growth_pct + 3 else
                "The price assumes slower growth than the company has delivered - expectations are modest."
                if implied * 100 < growth_pct - 3 else
                "The price assumes roughly the growth the company has been delivering."),
        },
        "dcf_sensitivity": dcf_sensitivity(fcf, shares, growth_pct / 100, a["discount"], a["terminal"], net_debt),
    }

    values = sorted(m["value"] for m in methods if m["value"])
    if values:
        # Drop extreme outliers (>4x apart from the median) so one broken input can't dominate.
        med = statistics.median(values)
        values = [v for v in values if med / 4 <= v <= med * 4]
    if not values:
        return {"methods": methods, "fair_value": None, "verdict": "Insufficient data",
                "growth_assumption_pct": num(growth_pct, 1), **extras}

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
        **extras,
    }
