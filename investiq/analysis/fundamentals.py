"""Company fundamentals: size, valuation ratios, profitability, balance sheet, growth."""

from __future__ import annotations

import pandas as pd

from ..data.provider import StockData
from .util import cagr, date_str, num, pct


def _row(df: pd.DataFrame, *names: str) -> pd.Series:
    """First matching statement line, oldest -> newest, NaNs dropped."""
    if df is None or df.empty:
        return pd.Series(dtype=float)
    for name in names:
        if name in df.index:
            s = pd.to_numeric(df.loc[name], errors="coerce").dropna()
            s.index = pd.to_datetime(s.index)
            return s.sort_index()
    return pd.Series(dtype=float)


def _statement_cagr(s: pd.Series):
    if len(s) < 2:
        return None
    years = (s.index[-1] - s.index[0]).days / 365.25
    return cagr(s.iloc[0], s.iloc[-1], years)


def trailing_dividend_yield(data: StockData, price: float):
    divs = data.dividends
    if divs is None or divs.empty:
        return 0.0
    last_year = divs.loc[data.history.index[-1] - pd.DateOffset(years=1):]
    return float(last_year.sum() / price) if price else None


def analyze_fundamentals(data: StockData, price: float) -> dict:
    info = data.info or {}
    revenue = _row(data.income, "Total Revenue", "Operating Revenue")
    net_income = _row(data.income, "Net Income", "Net Income Common Stockholders")
    eps_hist = _row(data.income, "Diluted EPS", "Basic EPS")
    equity = _row(data.balance, "Stockholders Equity", "Common Stock Equity")
    debt = _row(data.balance, "Total Debt")
    cash = _row(data.balance, "Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments")
    fcf = _row(data.cashflow, "Free Cash Flow")

    shares = info.get("sharesOutstanding") or info.get("impliedSharesOutstanding")
    eps = info.get("trailingEps")
    if eps is None and len(eps_hist):
        eps = eps_hist.iloc[-1]
    book_value = info.get("bookValue")
    if book_value is None and len(equity) and shares:
        book_value = equity.iloc[-1] / shares

    roe = info.get("returnOnEquity")
    if roe is None and len(net_income) and len(equity) and equity.iloc[-1] > 0:
        roe = net_income.iloc[-1] / equity.iloc[-1]

    d_e = info.get("debtToEquity")
    d_e = d_e / 100 if d_e is not None else (
        debt.iloc[-1] / equity.iloc[-1] if len(debt) and len(equity) and equity.iloc[-1] > 0 else None
    )

    pe = info.get("trailingPE") or (price / eps if eps and eps > 0 else None)
    pb = info.get("priceToBook") or (price / book_value if book_value and book_value > 0 else None)
    market_cap = info.get("marketCap") or (price * shares if shares else None)

    statements = []
    for d in revenue.index.union(net_income.index):
        statements.append(
            {
                "fiscal_year_end": date_str(d),
                "revenue": num(revenue.get(d)),
                "net_income": num(net_income.get(d)),
                "free_cash_flow": num(fcf.get(d)),
                "net_margin_pct": pct(net_income.get(d) / revenue.get(d))
                if d in revenue.index and d in net_income.index and revenue.get(d)
                else None,
            }
        )

    return {
        "name": info.get("longName") or info.get("shortName") or data.symbol,
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "exchange": info.get("exchange"),
        "currency": info.get("currency"),
        "website": info.get("website"),
        "employees": info.get("fullTimeEmployees"),
        "description": info.get("longBusinessSummary"),
        "market_cap": num(market_cap),
        "market_cap_category": _cap_category(market_cap, info.get("currency")),
        "shares_outstanding": num(shares),
        "pe": num(pe, 2),
        "forward_pe": num(info.get("forwardPE"), 2),
        "pb": num(pb, 2),
        "peg": num(info.get("trailingPegRatio") or info.get("pegRatio"), 2),
        "eps": num(eps, 2),
        "forward_eps": num(info.get("forwardEps"), 2),
        "book_value_per_share": num(book_value, 2),
        "dividend_yield_pct": pct(trailing_dividend_yield(data, price)),
        "roe_pct": pct(roe),
        "roa_pct": pct(info.get("returnOnAssets")),
        "profit_margin_pct": pct(info.get("profitMargins")),
        "operating_margin_pct": pct(info.get("operatingMargins")),
        "debt_to_equity": num(d_e, 2),
        "current_ratio": num(info.get("currentRatio"), 2),
        "total_debt": num(debt.iloc[-1]) if len(debt) else num(info.get("totalDebt")),
        "total_cash": num(cash.iloc[-1]) if len(cash) else num(info.get("totalCash")),
        "free_cash_flow": num(fcf.iloc[-1]) if len(fcf) else num(info.get("freeCashflow")),
        "revenue_growth_pct": pct(info.get("revenueGrowth")),
        "earnings_growth_pct": pct(info.get("earningsGrowth")),
        "revenue_cagr_pct": pct(_statement_cagr(revenue)),
        "profit_cagr_pct": pct(_statement_cagr(net_income[net_income > 0])),
        "statements": statements,
        "analyst": {
            "target_mean": num(info.get("targetMeanPrice"), 2),
            "target_high": num(info.get("targetHighPrice"), 2),
            "target_low": num(info.get("targetLowPrice"), 2),
            "analysts": info.get("numberOfAnalystOpinions"),
            "recommendation": info.get("recommendationKey"),
        },
    }


def _cap_category(market_cap, currency):
    if not market_cap:
        return None
    if currency == "INR":
        # SEBI-style buckets (approximate crore thresholds).
        crore = market_cap / 1e7
        if crore >= 100_000:
            return "Large cap"
        if crore >= 33_000:
            return "Mid cap"
        return "Small cap"
    if market_cap >= 200e9:
        return "Mega cap"
    if market_cap >= 10e9:
        return "Large cap"
    if market_cap >= 2e9:
        return "Mid cap"
    return "Small cap"
