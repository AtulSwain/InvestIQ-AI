"""Flat metric registry: every headline number with its label, unit, period, currency,
actual/estimate status and the provenance record it came from.

The UI uses it for transparency tooltips, the screener, alerts and the thesis tracker,
so a metric is defined (and computed) once, in Python.
"""

from __future__ import annotations

# key: (label, unit, source id, status, period description)
# unit: pct | ratio | x | money | big | number | score
DEFS = {
    "price": ("Price", "money", "price_history", "actual", "Latest close or live quote"),
    "change_pct": ("1-day change", "pct", "price_history", "actual", "Since previous close"),
    "market_cap": ("Market cap", "big", "company_profile", "actual", "Latest"),
    "pe": ("P/E", "x", "company_profile", "actual", "Trailing twelve months"),
    "forward_pe": ("Forward P/E", "x", "company_profile", "estimate", "Next 12 months (consensus EPS)"),
    "pb": ("P/B", "x", "company_profile", "actual", "Latest book value"),
    "ps": ("P/S", "x", "method_valuation", "derived", "Latest fiscal year sales"),
    "peg": ("PEG", "ratio", "company_profile", "estimate", "P/E ÷ expected growth"),
    "ev_ebitda": ("EV / EBITDA", "x", "method_valuation", "derived", "Latest fiscal year"),
    "ev_sales": ("EV / Sales", "x", "method_valuation", "derived", "Latest fiscal year"),
    "fcf_yield_pct": ("FCF yield", "pct", "method_valuation", "derived", "Latest fiscal year FCF ÷ market cap"),
    "earnings_yield_pct": ("Earnings yield", "pct", "method_valuation", "derived", "1 ÷ trailing P/E"),
    "dividend_yield_pct": ("Dividend yield", "pct", "price_history", "actual", "Dividends paid in the last 12 months"),
    "eps": ("EPS", "money", "company_profile", "actual", "Trailing twelve months"),
    "roe_pct": ("ROE", "pct", "company_profile", "actual", "Trailing twelve months"),
    "roce_pct": ("ROCE", "pct", "method_financials", "derived", "Latest fiscal year"),
    "roic_pct": ("ROIC (approx.)", "pct", "method_financials", "derived", "Latest fiscal year: NOPAT ÷ (debt + equity − cash)"),
    "net_margin_pct": ("Net margin", "pct", "company_profile", "actual", "Trailing twelve months"),
    "operating_margin_pct": ("Operating margin", "pct", "company_profile", "actual", "Trailing twelve months"),
    "gross_margin_pct": ("Gross margin", "pct", "method_financials", "derived", "Latest fiscal year"),
    "revenue_cagr_pct": ("Revenue CAGR", "pct", "financial_statements", "derived", "Across available fiscal years"),
    "profit_cagr_pct": ("Profit CAGR", "pct", "financial_statements", "derived", "Across available fiscal years"),
    "revenue_growth_pct": ("Revenue growth (latest)", "pct", "company_profile", "actual", "Latest quarter, year on year"),
    "debt_to_equity": ("Debt / equity", "ratio", "company_profile", "actual", "Latest balance sheet"),
    "current_ratio": ("Current ratio", "ratio", "company_profile", "actual", "Latest balance sheet"),
    "interest_coverage": ("Interest coverage", "x", "method_financials", "derived", "Latest fiscal year EBIT ÷ interest"),
    "free_cash_flow": ("Free cash flow", "big", "financial_statements", "actual", "Latest fiscal year"),
    "piotroski": ("Piotroski F-Score", "score", "method_financials", "derived", "Latest vs previous fiscal year"),
    "altman_z": ("Altman Z-Score", "number", "method_financials", "derived", "Latest fiscal year"),
    "return_1y_pct": ("1-year return", "pct", "price_history", "actual", "Last 12 months"),
    "cagr_5y_pct": ("5-year CAGR", "pct", "price_history", "derived", "Last 5 years"),
    "cagr_10y_pct": ("10-year CAGR", "pct", "price_history", "derived", "Last 10 years"),
    "volatility_pct": ("Volatility", "pct", "method_risk", "derived", "Last 12 months, annualised"),
    "max_drawdown_pct": ("Max drawdown", "pct", "method_risk", "derived", "Full history"),
    "beta": ("Beta", "ratio", "method_risk", "derived", "3 years vs benchmark index"),
    "rsi": ("RSI (14)", "number", "method_technicals", "derived", "Last 14 trading days"),
    "above_sma200": ("Above 200-day average", "bool", "method_technicals", "derived", "Latest close"),
    "fair_value": ("Fair value (mid)", "money", "method_valuation", "estimate", "Median of valuation models"),
    "margin_of_safety_pct": ("Upside to fair value", "pct", "method_valuation", "estimate", "Fair value mid vs price"),
    "implied_growth_pct": ("Growth priced in", "pct", "method_valuation", "estimate", "Reverse DCF"),
    "score": ("InvestIQ score", "score", "method_scorecard", "derived", "Composite 0-10"),
    "checklist_passed": ("Checklist passed", "number", "method_scorecard", "derived", "Of the evaluated checks"),
    "insiders_pct": ("Insider holding", "pct", "company_profile", "actual", "Latest filing"),
    "institutions_pct": ("Institutional holding", "pct", "company_profile", "actual", "Latest filing"),
}


# Signal thresholds: (good_if, ok_if) as (op, value). Same spirit as scorecard.py / decision.py:
# >= good -> "good", >= ok -> "ok", else "weak" (reversed for "lower is better" metrics).
SIGNALS = {
    "pe": ("<=", 20, "<=", 35), "forward_pe": ("<=", 18, "<=", 30), "pb": ("<=", 3, "<=", 6),
    "ev_ebitda": ("<=", 12, "<=", 20), "ps": ("<=", 3, "<=", 8), "peg": ("<=", 1, "<=", 2),
    "fcf_yield_pct": (">=", 5, ">=", 2), "earnings_yield_pct": (">=", 6, ">=", 3),
    "roe_pct": (">=", 15, ">=", 8), "roce_pct": (">=", 15, ">=", 8), "roic_pct": (">=", 12, ">=", 6),
    "net_margin_pct": (">=", 12, ">=", 5), "operating_margin_pct": (">=", 15, ">=", 8), "gross_margin_pct": (">=", 40, ">=", 20),
    "revenue_cagr_pct": (">=", 10, ">=", 3), "profit_cagr_pct": (">=", 10, ">=", 3), "revenue_growth_pct": (">=", 10, ">=", 0),
    "debt_to_equity": ("<=", 0.5, "<=", 1.5), "current_ratio": (">=", 1.5, ">=", 1.0), "interest_coverage": (">=", 6, ">=", 2.5),
    "piotroski": (">=", 7, ">=", 4), "altman_z": (">=", 2.99, ">=", 1.81),
    "return_1y_pct": (">=", 15, ">=", 0), "cagr_5y_pct": (">=", 12, ">=", 5), "cagr_10y_pct": (">=", 12, ">=", 5),
    "volatility_pct": ("<=", 25, "<=", 40), "max_drawdown_pct": (">=", -35, ">=", -55), "beta": ("<=", 1.0, "<=", 1.4),
    "margin_of_safety_pct": (">=", 10, ">=", -15), "score": (">=", 7.5, ">=", 4.5),
    "dividend_yield_pct": (">=", 2, ">=", 0.5),
}
FINANCIAL_SECTOR_SKIP = {"debt_to_equity", "current_ratio", "interest_coverage", "altman_z", "fcf_yield_pct", "ev_ebitda"}


def signal(key: str, value, financial_sector: bool = False):
    """"good" / "ok" / "weak" / None for one metric value."""
    rule = SIGNALS.get(key)
    if rule is None or value is None or isinstance(value, bool) or (financial_sector and key in FINANCIAL_SECTOR_SKIP):
        return None
    if key in ("pe", "forward_pe", "ev_ebitda", "ps", "peg", "pb") and value <= 0:
        return "weak"  # losses: a negative multiple is not "cheap"
    gop, gv, oop, ov = rule
    cmp = (lambda a, b: a >= b) if gop == ">=" else (lambda a, b: a <= b)
    if cmp(value, gv):
        return "good"
    cmp = (lambda a, b: a >= b) if oop == ">=" else (lambda a, b: a <= b)
    return "ok" if cmp(value, ov) else "weak"


def roic(fin_years: list[dict], tax_rate: float = 0.25):
    """Approximate ROIC: EBIT x (1 - tax) / (debt + equity - cash), latest year."""
    if not fin_years:
        return None
    y = fin_years[-1]
    ebit, debt, equity, cash = y.get("operating_income"), y.get("total_debt"), y.get("equity"), y.get("cash")
    if ebit is None or equity is None:
        return None
    invested = (debt or 0) + equity - (cash or 0)
    if invested <= 0:
        return None
    return round(ebit * (1 - tax_rate) / invested * 100, 2)


def build_metrics(report: dict) -> dict:
    """Collect values from the finished report sections into the registry shape."""
    f = report["fundamentals"]
    v = report["valuation"]
    m = v.get("multiples") or {}
    fin = report["financials"]
    years = fin.get("years") or []
    latest = years[-1] if years else {}
    t = {r["period"]: r for r in report["performance"]["trailing"]}
    one_y = report["risk"]["windows"].get("1Y") or {}
    beta = (report["risk"].get("beta") or {}).get("3Y") or {}
    sma = next((s for s in report["technicals"]["signals"] if s["indicator"] == "SMA 200"), None)
    values = {
        "price": report["quote"]["price"], "change_pct": report["quote"]["change_pct"],
        "market_cap": f.get("market_cap"), "pe": f.get("pe"), "forward_pe": f.get("forward_pe"), "pb": f.get("pb"),
        "ps": m.get("ps"), "peg": f.get("peg"), "ev_ebitda": m.get("ev_ebitda"), "ev_sales": m.get("ev_sales"),
        "fcf_yield_pct": m.get("fcf_yield_pct"), "earnings_yield_pct": m.get("earnings_yield_pct"),
        "dividend_yield_pct": f.get("dividend_yield_pct"), "eps": f.get("eps"), "roe_pct": f.get("roe_pct"),
        "roce_pct": latest.get("roce_pct"), "roic_pct": roic(years),
        "net_margin_pct": f.get("profit_margin_pct"), "operating_margin_pct": f.get("operating_margin_pct"),
        "gross_margin_pct": latest.get("gross_margin_pct"), "revenue_cagr_pct": f.get("revenue_cagr_pct"),
        "profit_cagr_pct": f.get("profit_cagr_pct"), "revenue_growth_pct": f.get("revenue_growth_pct"),
        "debt_to_equity": f.get("debt_to_equity"), "current_ratio": f.get("current_ratio"),
        "interest_coverage": latest.get("interest_coverage"), "free_cash_flow": f.get("free_cash_flow"),
        "piotroski": (fin.get("piotroski") or {}).get("score"), "altman_z": (fin.get("altman") or {}).get("z"),
        "return_1y_pct": t.get("1Y", {}).get("total_return_pct"), "cagr_5y_pct": t.get("5Y", {}).get("cagr_pct"),
        "cagr_10y_pct": t.get("10Y", {}).get("cagr_pct"), "volatility_pct": one_y.get("volatility_pct"),
        "max_drawdown_pct": report["risk"]["windows"].get("MAX", {}).get("max_drawdown_pct"),
        "beta": beta.get("beta"), "rsi": report["technicals"].get("rsi"),
        "above_sma200": (sma["stance"] == "bullish") if sma else None,
        "fair_value": (v.get("fair_value") or {}).get("mid"), "margin_of_safety_pct": v.get("margin_of_safety_pct"),
        "implied_growth_pct": (v.get("reverse_dcf") or {}).get("implied_growth_pct"),
        "score": report["scorecard"].get("overall"), "checklist_passed": report["checklist"].get("passed"),
        "insiders_pct": f.get("insiders_pct"), "institutions_pct": f.get("institutions_pct"),
    }
    out = {}
    for key, (label, unit, src, status, period) in DEFS.items():
        value = values.get(key)
        # Price fields follow whichever quote the report used (live quote or last close).
        src_id = report["quote"].get("source", "price_history") if key in ("price", "change_pct") else src
        out[key] = {"label": label, "value": value, "unit": unit, "period": period, "status": status,
                    "source": src_id, "currency": report["currency"] if unit in ("money", "big") else None,
                    "signal": signal(key, value, bool(fin.get("is_financial_sector")))}
    return out
