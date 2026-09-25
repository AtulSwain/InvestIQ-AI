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


MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def monthly_returns(close: pd.Series, years: int = 12) -> list[dict]:
    """Year x month grid of returns (most recent year first)."""
    month_end = close.resample("ME").last()
    rets = month_end.pct_change()
    # First month measures from the first available close.
    rets.iloc[0] = month_end.iloc[0] / close.iloc[0] - 1
    first_year = close.index[-1].year - years + 1
    rows = []
    for year in sorted({d.year for d in rets.index if d.year >= first_year}, reverse=True):
        months = [None] * 12
        for d, v in rets[rets.index.year == year].items():
            months[d.month - 1] = pct(v, 1)
        in_year = close[close.index.year == year]
        prior = close[close.index.year < year]
        start = prior.iloc[-1] if len(prior) else in_year.iloc[0]
        rows.append({"year": int(year), "months": months, "total_pct": pct(in_year.iloc[-1] / start - 1, 1)})
    return rows


def seasonality(close: pd.Series) -> list[dict]:
    """Average return and hit rate for each calendar month across all years."""
    month_end = close.resample("ME").last()
    rets = month_end.pct_change().dropna()
    out = []
    for m in range(1, 13):
        r = rets[rets.index.month == m]
        out.append({
            "month": MONTHS[m - 1],
            "avg_pct": pct(r.mean(), 2) if len(r) else None,
            "median_pct": pct(r.median(), 2) if len(r) else None,
            "positive_pct": pct((r > 0).mean(), 0) if len(r) else None,
            "years": int(len(r)),
        })
    return out


def rolling_returns(close: pd.Series) -> list[dict]:
    """If you bought on any week and held N years: worst / typical / best annual return."""
    weekly = close.resample("W-FRI").last().dropna()
    rows = []
    for years in (1, 3, 5, 10):
        n = 52 * years
        if len(weekly) <= n + 10:
            continue
        cagr_series = (weekly.shift(-n) / weekly) ** (1 / years) - 1
        c = cagr_series.dropna()
        rows.append({
            "years": years,
            "samples": int(len(c)),
            "worst_pct": pct(c.min(), 1),
            "p25_pct": pct(c.quantile(0.25), 1),
            "median_pct": pct(c.median(), 1),
            "p75_pct": pct(c.quantile(0.75), 1),
            "best_pct": pct(c.max(), 1),
            "positive_pct": pct((c > 0).mean(), 0),
            "above_10_pct": pct((c > 0.10).mean(), 0),
        })
    return rows


def dividend_history(dividends: pd.Series, close: pd.Series) -> dict:
    """Dividends per calendar year, growth and streak."""
    if dividends is None or dividends.empty:
        return {"paid": False, "years": [], "ttm": 0.0}
    last_year = close.index[-1].year
    by_year = dividends.groupby(dividends.index.year).sum()
    by_year = by_year[by_year.index >= last_year - 14]
    ttm = dividends.loc[close.index[-1] - pd.DateOffset(years=1):].sum()
    years_list = [{"year": int(y), "dividend": num(v, 2)} for y, v in by_year.items()]
    growth_5y = None
    full = by_year[by_year.index < last_year]  # current year may be incomplete
    if len(full) >= 6 and full.iloc[-6] > 0:
        growth_5y = (full.iloc[-1] / full.iloc[-6]) ** (1 / 5) - 1
    streak = 0
    for y in range(last_year - 1, last_year - 40, -1):
        if y in by_year.index and by_year[y] > 0:
            streak += 1
        else:
            break
    return {
        "paid": True,
        "years": years_list,
        "ttm": num(ttm, 2),
        "yield_pct": pct(ttm / close.iloc[-1]),
        "growth_5y_pct": pct(growth_5y, 1),
        "growth_5y": growth_5y,
        "streak_years": streak,
    }


def analyze_breakdown(close: pd.Series, dividends: pd.Series) -> dict:
    return {
        "monthly": monthly_returns(close),
        "seasonality": seasonality(close),
        "rolling": rolling_returns(close),
        "dividends": dividend_history(dividends, close),
    }
