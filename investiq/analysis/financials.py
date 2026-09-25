"""Multi-year financial breakdown and financial-strength scores.

* Year-by-year income statement, balance sheet and cash-flow lines with
  derived ratios (margins, ROE, ROCE, coverage, cash conversion, growth).
* Piotroski F-Score: nine yes/no tests of profitability, leverage and
  efficiency (8-9 strong, 0-3 weak).
* Altman Z-Score: bankruptcy-risk model for non-financial companies.
"""

from __future__ import annotations

import pandas as pd

from ..data.provider import StockData
from .fundamentals import _row
from .util import date_str, num, pct

LINES = {
    # key: (statement attribute, candidate row names)
    "revenue": ("income", ("Total Revenue", "Operating Revenue")),
    "gross_profit": ("income", ("Gross Profit",)),
    "operating_income": ("income", ("Operating Income",)),
    "ebit": ("income", ("EBIT", "Operating Income")),
    "ebitda": ("income", ("EBITDA", "Normalized EBITDA")),
    "interest_expense": ("income", ("Interest Expense", "Interest Expense Non Operating")),
    "net_income": ("income", ("Net Income", "Net Income Common Stockholders")),
    "eps": ("income", ("Diluted EPS", "Basic EPS")),
    "total_assets": ("balance", ("Total Assets",)),
    "current_assets": ("balance", ("Current Assets",)),
    "current_liabilities": ("balance", ("Current Liabilities",)),
    "total_liabilities": ("balance", ("Total Liabilities Net Minority Interest", "Total Liabilities")),
    "equity": ("balance", ("Stockholders Equity", "Common Stock Equity")),
    "total_debt": ("balance", ("Total Debt",)),
    "long_term_debt": ("balance", ("Long Term Debt", "Long Term Debt And Capital Lease Obligation")),
    "cash": ("balance", ("Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments")),
    "retained_earnings": ("balance", ("Retained Earnings",)),
    "shares": ("balance", ("Ordinary Shares Number", "Share Issued")),
    "operating_cash_flow": ("cashflow", ("Operating Cash Flow", "Cash Flow From Continuing Operating Activities")),
    "capex": ("cashflow", ("Capital Expenditure",)),
    "free_cash_flow": ("cashflow", ("Free Cash Flow",)),
    "dividends_paid": ("cashflow", ("Cash Dividends Paid", "Common Stock Dividend Paid")),
}

FINANCIAL_SECTORS = {"Financial Services", "Financial"}


def _div(a, b):
    if a is None or b is None or b == 0 or pd.isna(a) or pd.isna(b):
        return None
    return a / b


def load_lines(data: StockData) -> pd.DataFrame:
    """DataFrame indexed by fiscal year-end (oldest first), one column per line item."""
    cols = {key: _row(getattr(data, attr), *names) for key, (attr, names) in LINES.items()}
    df = pd.DataFrame(cols)
    if df.empty:
        return df
    # Keep years that at least report revenue or net income.
    df = df[df[["revenue", "net_income"]].notna().any(axis=1)].sort_index()
    return df.astype(float)


def yearly_breakdown(df: pd.DataFrame) -> list[dict]:
    rows = []
    prev = None
    for date, r in df.iterrows():
        get = lambda k: None if pd.isna(r.get(k)) else r.get(k)
        capital_employed = None
        if get("total_assets") is not None and get("current_liabilities") is not None:
            capital_employed = get("total_assets") - get("current_liabilities")
        interest = abs(get("interest_expense")) if get("interest_expense") else None
        row = {
            "fiscal_year_end": date_str(date),
            "revenue": num(get("revenue")),
            "gross_profit": num(get("gross_profit")),
            "ebitda": num(get("ebitda")),
            "operating_income": num(get("operating_income")),
            "net_income": num(get("net_income")),
            "eps": num(get("eps"), 2),
            "operating_cash_flow": num(get("operating_cash_flow")),
            "capex": num(get("capex")),
            "free_cash_flow": num(get("free_cash_flow")),
            "total_assets": num(get("total_assets")),
            "equity": num(get("equity")),
            "total_debt": num(get("total_debt")),
            "cash": num(get("cash")),
            "gross_margin_pct": pct(_div(get("gross_profit"), get("revenue"))),
            "operating_margin_pct": pct(_div(get("operating_income"), get("revenue"))),
            "net_margin_pct": pct(_div(get("net_income"), get("revenue"))),
            "roe_pct": pct(_div(get("net_income"), get("equity"))),
            "roce_pct": pct(_div(get("ebit"), capital_employed)),
            "roa_pct": pct(_div(get("net_income"), get("total_assets"))),
            "debt_to_equity": num(_div(get("total_debt"), get("equity")), 2),
            "current_ratio": num(_div(get("current_assets"), get("current_liabilities")), 2),
            "interest_coverage": num(_div(get("ebit"), interest), 1),
            "cash_conversion": num(_div(get("operating_cash_flow"), get("net_income")), 2),
            "revenue_growth_pct": None,
            "profit_growth_pct": None,
        }
        if prev is not None:
            if prev["revenue"] and row["revenue"]:
                row["revenue_growth_pct"] = pct(row["revenue"] / prev["revenue"] - 1)
            if prev["net_income"] and row["net_income"] and prev["net_income"] > 0:
                row["profit_growth_pct"] = pct(row["net_income"] / prev["net_income"] - 1)
        rows.append(row)
        prev = row
    return rows


def piotroski(df: pd.DataFrame) -> dict | None:
    if len(df) < 2:
        return None
    cur, prev = df.iloc[-1], df.iloc[-2]

    def v(row, key):
        x = row.get(key)
        return None if x is None or pd.isna(x) else float(x)

    def test(name, ok, detail):
        return {"test": name, "passed": ok, "detail": detail}

    roa = lambda r: _div(v(r, "net_income"), v(r, "total_assets"))
    lev = lambda r: _div(v(r, "long_term_debt"), v(r, "total_assets"))
    cr = lambda r: _div(v(r, "current_assets"), v(r, "current_liabilities"))
    gm = lambda r: _div(v(r, "gross_profit"), v(r, "revenue"))
    turn = lambda r: _div(v(r, "revenue"), v(r, "total_assets"))

    def cmp(a, b, better="higher"):
        if a is None or b is None:
            return None
        return a > b if better == "higher" else a < b

    ni, cfo = v(cur, "net_income"), v(cur, "operating_cash_flow")
    tests = [
        test("Profitable", None if ni is None else ni > 0, "Net income is positive"),
        test("Cash-generating", None if cfo is None else cfo > 0, "Operating cash flow is positive"),
        test("Improving ROA", cmp(roa(cur), roa(prev)), "Return on assets rose vs last year"),
        test("Earnings quality", None if ni is None or cfo is None else cfo > ni,
             "Operating cash flow exceeds net income (profits are backed by cash)"),
        test("Less leverage", cmp(lev(cur), lev(prev), "lower"), "Long-term debt / assets fell"),
        test("Better liquidity", cmp(cr(cur), cr(prev)), "Current ratio improved"),
        test("No dilution", cmp(v(cur, "shares"), (v(prev, "shares") or 0) * 1.001, "lower")
             if v(cur, "shares") and v(prev, "shares") else None,
             "Share count did not increase"),
        test("Better gross margin", cmp(gm(cur), gm(prev)), "Gross margin improved"),
        test("Better asset turnover", cmp(turn(cur), turn(prev)), "Revenue per rupee/dollar of assets rose"),
    ]
    evaluated = [t for t in tests if t["passed"] is not None]
    if len(evaluated) < 5:
        return None
    score = sum(t["passed"] for t in evaluated)
    # Scale to 9 when some tests could not be evaluated.
    scaled = round(score * 9 / len(evaluated), 1)
    label = "Strong" if scaled >= 7 else "Average" if scaled >= 4 else "Weak"
    return {"score": score, "out_of": len(evaluated), "scaled_9": scaled, "label": label, "tests": tests}


def altman_z(df: pd.DataFrame, market_cap, sector) -> dict | None:
    if df.empty:
        return None
    if sector in FINANCIAL_SECTORS:
        return {"z": None, "zone": "Not applicable",
                "note": "The Altman Z-Score is not meaningful for banks and other financial companies."}
    r = df.iloc[-1]
    ta = r.get("total_assets")
    tl = r.get("total_liabilities")
    parts = [r.get("current_assets"), r.get("current_liabilities"), r.get("retained_earnings"),
             r.get("ebit"), r.get("revenue")]
    if any(x is None or pd.isna(x) for x in [ta, tl, *parts]) or not market_cap or not ta or not tl:
        return None
    wc = r["current_assets"] - r["current_liabilities"]
    components = {
        "working_capital": 1.2 * wc / ta,
        "retained_earnings": 1.4 * r["retained_earnings"] / ta,
        "ebit": 3.3 * r["ebit"] / ta,
        "market_value": 0.6 * market_cap / tl,
        "sales": 1.0 * r["revenue"] / ta,
    }
    z = sum(components.values())
    zone = "Safe" if z > 2.99 else "Grey zone" if z > 1.81 else "Distress"
    return {
        "z": num(z, 2),
        "zone": zone,
        "components": {k: num(v, 2) for k, v in components.items()},
        "note": "Above 2.99 = safe, 1.81-2.99 = grey zone, below 1.81 = financial distress risk.",
    }


def analyze_financials(data: StockData, market_cap) -> dict:
    df = load_lines(data)
    sector = (data.info or {}).get("sector")
    return {
        "years": yearly_breakdown(df) if not df.empty else [],
        "piotroski": piotroski(df) if not df.empty else None,
        "altman": altman_z(df, market_cap, sector),
        "is_financial_sector": sector in FINANCIAL_SECTORS,
    }
