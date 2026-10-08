"""Builds the complete research report for one stock."""

from __future__ import annotations

import pandas as pd

from ..data.provenance import now_iso, source
from ..data.provider import DataProvider, DataUnavailableError
from ..data.sources import live_quote
from ..data.validation import validate_stock
from ..data.symbols import benchmark_for, currency_for, market_for, resolve_candidates
from .decision import buy_checklist, trade_plan
from .financials import analyze_financials
from .fundamentals import analyze_fundamentals
from .performance import analyze_breakdown, analyze_performance
from .projection import analyze_projection
from .risk import analyze_risk
from .scorecard import build_scorecard, build_summary
from .technicals import analyze_technicals
from .util import date_str, num, pct
from .valuation import analyze_valuation

RISK_FREE = {"IN": 0.065, "US": 0.04}

DISCLAIMER = (
    "InvestIQ is a research tool, not investment advice. Estimates and projections are "
    "model outputs based on past data and can be wrong. Do your own due diligence."
)


def load_stock(provider: DataProvider, query: str):
    """Resolve a user query ("reliance", "TCS", "AAPL", "INFY.NS") to data."""
    errors = []
    for symbol in resolve_candidates(query):
        try:
            data = provider.get_stock(symbol)
            if len(data.history) >= 2:
                return data
        except DataUnavailableError as exc:
            errors.append(str(exc))
    raise DataUnavailableError(errors[-1] if errors else f"Could not find a stock matching '{query}'")


def _benchmark_close(provider: DataProvider, symbol: str):
    try:
        return provider.get_history(benchmark_for(symbol))["Close"]
    except Exception:
        return None


def _price_chart(hist: pd.DataFrame, sma50: pd.Series, sma200: pd.Series) -> dict:
    return {
        "dates": [date_str(d) for d in hist.index],
        "close": [num(v, 2) for v in hist["Close"]],
        "volume": [num(v, 0) for v in hist["Volume"]],
        "sma50": [num(v, 2) for v in sma50],
        "sma200": [num(v, 2) for v in sma200],
    }


# Which provenance records back each report section (ids from data/provenance.py).
SECTION_SOURCES = {
    "quote": ["live_quote", "price_history"],
    "chart": ["price_history", "benchmark_history"],
    "performance": ["price_history", "benchmark_history", "method_returns"],
    "risk": ["price_history", "benchmark_history", "method_risk"],
    "technicals": ["price_history", "method_technicals"],
    "fundamentals": ["company_profile", "financial_statements"],
    "financials": ["financial_statements", "method_financials"],
    "valuation": ["company_profile", "financial_statements", "price_history", "method_valuation"],
    "projection": ["price_history", "method_projection"],
    "scorecard": ["method_scorecard"],
    "checklist": ["method_scorecard"],
    "trade_plan": ["price_history", "method_valuation"],
}

METHODS = [
    ("method_returns", "derived", "Total return, CAGR and XIRR from adjusted closes; SIP buys on the first "
                                  "trading day of each month."),
    ("method_risk", "derived", "Volatility = stdev of daily returns x sqrt(252); Sharpe/Sortino vs the "
                               "market risk-free rate; beta from daily returns vs the benchmark index."),
    ("method_technicals", "derived", "SMA 50/200, Wilder RSI(14), MACD(12,26,9), Bollinger(20,2), ATR(14)."),
    ("method_financials", "derived", "Ratios computed from reported statements; Piotroski F-Score (9 tests); "
                                     "Altman Z-Score (original manufacturing model)."),
    ("method_valuation", "estimate", "Median of Graham, DCF, earnings-multiple, Lynch, historical-P/E, "
                                     "dividend-discount and analyst-target values, outliers >4x removed."),
    ("method_projection", "estimate", "Log-normal scenarios from 10-year volatility; drift blends the stock's "
                                      "CAGR with a long-run market return. Not a forecast."),
    ("method_scorecard", "derived", "Rule-based 0-10 scores and 15-point checklist from the sections above."),
]


def build_report(provider: DataProvider, query: str, live_quotes: bool | None = None) -> dict:
    data = load_stock(provider, query)
    symbol = data.symbol
    market = market_for(symbol)
    hist = data.history
    close = hist["Close"]
    price = float(close.iloc[-1])
    prev = float(close.iloc[-2])
    bench = _benchmark_close(provider, symbol)
    currency = (data.info or {}).get("currency") or currency_for(symbol)

    perf = analyze_performance(close, bench)
    risk = analyze_risk(close, bench, RISK_FREE[market])
    tech = analyze_technicals(hist)
    series = tech.pop("series")
    fund = analyze_fundamentals(data, price)
    cagr5 = next((r["cagr_pct"] for r in perf["trailing"] if r["period"] == "5Y"), None)
    fin = analyze_financials(data, fund["market_cap"])
    breakdown = analyze_breakdown(close, data.dividends)
    divs = breakdown["dividends"]
    val = analyze_valuation(fund, price, market, cagr5, fin["years"], close,
                            annual_dividend=divs.get("ttm"), dividend_growth=divs.pop("growth_5y", None))
    proj = analyze_projection(close, market)
    score = build_scorecard(perf, risk, tech, fund, val)
    checklist = buy_checklist(fund, fin, val, tech, perf["trailing"], risk)
    plan = trade_plan(price, tech, val, fund, proj)
    summary = build_summary(fund["name"], currency, price, perf, risk, tech, val, proj, score)

    # ---------- provenance, live quote, data quality ----------
    sources = list(data.sources)
    if bench is not None and len(bench):
        sources.append(source("benchmark_history", "demo" if provider.is_demo else "yahoo",
                              as_of=date_str(bench.index[-1]), period="Daily",
                              methodology=f"{benchmark_for(symbol)} index closes"))
    sources += [source(mid, "investiq", status=status, methodology=text) for mid, status, text in METHODS]

    quote = {
        "price": num(price, 2),
        "change": num(price - prev, 2),
        "change_pct": pct(price / prev - 1),
        "day_high": num(hist["High"].iloc[-1], 2),
        "day_low": num(hist["Low"].iloc[-1], 2),
        "volume": num(hist["Volume"].iloc[-1], 0),
        "source": "price_history",
        "realtime": False,
        "timestamp": date_str(close.index[-1]),
    }
    quality = validate_stock(data) + [{"level": "info", "area": "source", "message": n} for n in data.notes]
    if live_quotes is None:
        live_quotes = not provider.is_demo
    if live_quotes:
        lq, errors = live_quote(symbol)
        if lq:
            quote.update({
                "price": num(lq["price"], 2), "change": num(lq["change"], 2), "change_pct": num(lq["change_pct"], 2),
                "day_high": num(lq["high"], 2) or quote["day_high"], "day_low": num(lq["low"], 2) or quote["day_low"],
                "volume": num(lq["volume"], 0) or quote["volume"], "source": "live_quote",
                "realtime": lq["realtime"], "timestamp": lq["timestamp"],
            })
            sources.append(source("live_quote", lq["provider"], as_of=lq["timestamp"], currency=currency,
                                  realtime=lq["realtime"], delayed=lq["delayed"],
                                  methodology="Latest trade price; analysis sections use the last daily close"))
        elif errors:
            quality.append({"level": "info", "area": "quote",
                            "message": "Live quote unavailable, showing the last close. " + "; ".join(errors[:2])})

    return {
        "symbol": symbol,
        "name": fund["name"],
        "market": market,
        "currency": currency,
        "benchmark": benchmark_for(symbol),
        "is_demo": data.is_demo,
        "as_of": date_str(close.index[-1]),
        "quote": quote,
        "generated_at": now_iso(),
        "sources": sources,
        "section_sources": SECTION_SOURCES,
        "data_quality": quality,
        "summary": summary,
        "scorecard": score,
        "fundamentals": fund,
        "performance": perf,
        "risk": risk,
        "technicals": tech,
        "valuation": val,
        "projection": proj,
        "financials": fin,
        "breakdown": breakdown,
        "checklist": checklist,
        "trade_plan": plan,
        "chart": _price_chart(hist, series["sma50"], series["sma200"]),
        "benchmark_chart": _benchmark_chart(bench),
        "disclaimer": DISCLAIMER,
    }


def _benchmark_chart(bench):
    if bench is None or not len(bench):
        return None
    return {"dates": [date_str(d) for d in bench.index], "close": [num(v, 2) for v in bench]}


def build_comparison(provider: DataProvider, queries: list[str]) -> dict:
    """Side-by-side key metrics and rebased price history for several stocks."""
    stocks = []
    for q in queries:
        try:
            r = build_report(provider, q)
        except DataUnavailableError as exc:
            stocks.append({"query": q, "error": str(exc)})
            continue
        trailing = {row["period"]: row for row in r["performance"]["trailing"]}
        one_y = r["risk"]["windows"].get("1Y", {})
        stocks.append({
            "query": q,
            "symbol": r["symbol"],
            "name": r["name"],
            "currency": r["currency"],
            "price": r["quote"]["price"],
            "market_cap": r["fundamentals"]["market_cap"],
            "pe": r["fundamentals"]["pe"],
            "pb": r["fundamentals"]["pb"],
            "roe_pct": r["fundamentals"]["roe_pct"],
            "debt_to_equity": r["fundamentals"]["debt_to_equity"],
            "dividend_yield_pct": r["fundamentals"]["dividend_yield_pct"],
            "return_1y_pct": trailing.get("1Y", {}).get("total_return_pct"),
            "cagr_5y_pct": trailing.get("5Y", {}).get("cagr_pct"),
            "cagr_10y_pct": trailing.get("10Y", {}).get("cagr_pct"),
            "volatility_1y_pct": one_y.get("volatility_pct"),
            "max_drawdown_pct": r["risk"]["windows"]["MAX"].get("max_drawdown_pct"),
            "fair_value_mid": (r["valuation"].get("fair_value") or {}).get("mid"),
            "valuation_verdict": r["valuation"]["verdict"],
            "score": r["scorecard"]["overall"],
            "rating": r["scorecard"]["rating"],
            "chart": {"dates": r["chart"]["dates"], "close": r["chart"]["close"]},
            "is_demo": r["is_demo"],
        })
    return {"stocks": stocks, "disclaimer": DISCLAIMER}
