"""Historical performance: trailing returns, CAGR, calendar years, big moves."""

from __future__ import annotations

import pandas as pd

from .util import cagr, date_str, num, pct, price_on_or_before

PERIODS = [
    ("1W", pd.DateOffset(weeks=1)),
    ("1M", pd.DateOffset(months=1)),
    ("3M", pd.DateOffset(months=3)),
    ("6M", pd.DateOffset(months=6)),
    ("YTD", None),
    ("1Y", pd.DateOffset(years=1)),
    ("3Y", pd.DateOffset(years=3)),
    ("5Y", pd.DateOffset(years=5)),
    ("10Y", pd.DateOffset(years=10)),
    ("15Y", pd.DateOffset(years=15)),
    ("20Y", pd.DateOffset(years=20)),
    ("MAX", "max"),
]


def trailing_returns(close: pd.Series, benchmark: pd.Series | None = None) -> list[dict]:
    end_date = close.index[-1]
    end_price = close.iloc[-1]
    rows = []
    for label, offset in PERIODS:
        if offset is None:
            start_date = pd.Timestamp(end_date.year, 1, 1) - pd.Timedelta(days=1)
            start_price = price_on_or_before(close, start_date)
            if start_price is None:
                start_price, start_date = close.iloc[0], close.index[0]
        elif offset == "max":
            start_date, start_price = close.index[0], close.iloc[0]
        else:
            start_date = end_date - offset
            start_price = price_on_or_before(close, start_date)
        if start_price is None:
            continue
        years = (end_date - start_date).days / 365.25
        total = end_price / start_price - 1
        row = {
            "period": label,
            "start_date": date_str(start_date),
            "start_price": num(start_price, 2),
            "total_return_pct": pct(total),
            "cagr_pct": pct(cagr(start_price, end_price, years)) if years >= 1 else None,
            "benchmark_return_pct": None,
        }
        if benchmark is not None and len(benchmark):
            b_start = price_on_or_before(benchmark, start_date)
            if b_start is not None:
                row["benchmark_return_pct"] = pct(benchmark.iloc[-1] / b_start - 1)
        rows.append(row)
    return rows


def calendar_year_returns(close: pd.Series, benchmark: pd.Series | None = None) -> list[dict]:
    year_end = close.groupby(close.index.year).last()
    year_start_ref = year_end.shift(1)
    first_year = close.index[0].year
    # First (partial) year measures from the first available close.
    year_start_ref.loc[first_year] = close.iloc[0]
    b_end = benchmark.groupby(benchmark.index.year).last() if benchmark is not None and len(benchmark) else None
    rows = []
    for year in year_end.index:
        ret = year_end[year] / year_start_ref[year] - 1
        bench = None
        if b_end is not None and year in b_end.index and (year - 1) in b_end.index:
            bench = pct(b_end[year] / b_end[year - 1] - 1)
        rows.append(
            {
                "year": int(year),
                "return_pct": pct(ret),
                "benchmark_return_pct": bench,
                "partial": bool(year == first_year and close.index[0].month > 1)
                or bool(year == close.index[-1].year),
            }
        )
    return rows


def biggest_moves(close: pd.Series, n: int = 5, lookback_years: int | None = None) -> dict:
    series = close
    if lookback_years:
        series = close.loc[close.index[-1] - pd.DateOffset(years=lookback_years):]
    rets = series.pct_change().dropna()
    fmt = lambda s: [{"date": date_str(d), "change_pct": pct(v)} for d, v in s.items()]
    return {"top_gains": fmt(rets.nlargest(n)), "top_falls": fmt(rets.nsmallest(n))}


def growth_of_investment(close: pd.Series, amount: float = 10_000) -> list[dict]:
    """What a lump sum invested N years ago would be worth today."""
    rows = []
    for years in (1, 3, 5, 10, 15, 20):
        start = price_on_or_before(close, close.index[-1] - pd.DateOffset(years=years))
        if start is None:
            continue
        value = amount * close.iloc[-1] / start
        rows.append({"years": years, "invested": amount, "value": num(value, 0)})
    return rows


def sip_backtest(close: pd.Series, monthly: float = 5_000, years: int = 10) -> dict | None:
    """Invest a fixed amount on the first trading day of every month."""
    start = close.index[-1] - pd.DateOffset(years=years)
    if start < close.index[0]:
        return None
    window = close.loc[start:]
    # First trading day of each of the last ``years * 12`` months.
    buy_days = window.groupby([window.index.year, window.index.month]).head(1).iloc[-years * 12:]
    units = (monthly / buy_days).sum()
    invested = monthly * len(buy_days)
    value = units * close.iloc[-1]
    return {
        "years": years,
        "monthly": monthly,
        "installments": int(len(buy_days)),
        "invested": num(invested, 0),
        "value": num(value, 0),
        "gain_pct": pct(value / invested - 1),
        "xirr_pct": pct(_sip_xirr(buy_days, monthly, value, close.index[-1])),
    }


def _sip_xirr(buy_days: pd.Series, monthly: float, final_value: float, end: pd.Timestamp):
    """Annualised money-weighted return of a SIP (bisection on NPV)."""
    t = [(d - buy_days.index[0]).days / 365.25 for d in buy_days.index]
    t_end = (end - buy_days.index[0]).days / 365.25

    def npv(r):
        return sum(-monthly / (1 + r) ** ti for ti in t) + final_value / (1 + r) ** t_end

    lo, hi = -0.99, 10.0
    if npv(lo) * npv(hi) > 0:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2
        if npv(lo) * npv(mid) <= 0:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


def analyze_performance(close: pd.Series, benchmark: pd.Series | None = None) -> dict:
    return {
        "trailing": trailing_returns(close, benchmark),
        "calendar_years": calendar_year_returns(close, benchmark),
        "biggest_moves_1y": biggest_moves(close, lookback_years=1),
        "biggest_moves_all": biggest_moves(close),
        "growth_of_10k": growth_of_investment(close),
        "sip_backtests": [s for s in (sip_backtest(close, years=y) for y in (1, 3, 5, 10)) if s],
        "all_time_high": {
            "price": num(close.max(), 2),
            "date": date_str(close.idxmax()),
            "pct_below": pct(close.iloc[-1] / close.max() - 1),
        },
        "all_time_low": {"price": num(close.min(), 2), "date": date_str(close.idxmin())},
        "history_start": date_str(close.index[0]),
        "history_years": num((close.index[-1] - close.index[0]).days / 365.25, 1),
    }
