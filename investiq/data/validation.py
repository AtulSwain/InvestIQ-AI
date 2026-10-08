"""Sanity checks on downloaded data. Problems become warnings on the report, never silent."""

from __future__ import annotations

import pandas as pd

from .provider import StockData


def _w(level: str, area: str, message: str) -> dict:
    return {"level": level, "area": area, "message": message}


def validate_history(hist: pd.DataFrame, today: pd.Timestamp | None = None) -> list[dict]:
    out = []
    if hist is None or hist.empty:
        return [_w("error", "prices", "No price history.")]
    close = hist["Close"]
    if (close <= 0).any():
        out.append(_w("error", "prices", f"{int((close <= 0).sum())} non-positive closing prices were found."))
    if not hist.index.is_monotonic_increasing:
        out.append(_w("warning", "prices", "Price dates were out of order."))
    if hist.index.has_duplicates:
        out.append(_w("warning", "prices", "Duplicate price dates were found."))
    # Single-day moves above 60% are usually unadjusted splits or bad ticks.
    jumps = close.pct_change().abs()
    big = jumps[jumps > 0.6]
    if len(big):
        days = ", ".join(d.strftime("%Y-%m-%d") for d in big.index[:3])
        out.append(_w("warning", "prices", f"{len(big)} one-day move(s) above 60% ({days}) - possibly an "
                                           "unadjusted split or a bad print; long-term returns may be off."))
    # Gaps longer than ~3 weeks inside the series.
    gaps = hist.index.to_series().diff().dt.days
    long_gaps = gaps[gaps > 21]
    if len(long_gaps):
        out.append(_w("info", "prices", f"{len(long_gaps)} gap(s) of more than 3 weeks with no trading data."))
    today = today or pd.Timestamp.today().normalize()
    stale_days = (today - hist.index[-1]).days
    if stale_days > 7:
        out.append(_w("warning", "prices", f"Latest price is {stale_days} days old - the stock may be suspended "
                                           "or delisted, or the data source is lagging."))
    return out


def validate_fundamentals(data: StockData, today: pd.Timestamp | None = None) -> list[dict]:
    out = []
    info = data.info or {}
    if not info:
        out.append(_w("info", "fundamentals", "Company profile and ratios were not available from the data source."))
    pe = info.get("trailingPE")
    if pe is not None and (pe <= 0 or pe > 1000):
        out.append(_w("info", "fundamentals", f"Reported P/E of {pe:.1f} is unusual (losses or tiny earnings)."))
    if data.income is None or data.income.empty:
        out.append(_w("info", "statements", "Financial statements were not available - valuation and quality "
                                            "scores use fewer inputs."))
    else:
        latest = pd.to_datetime(data.income.columns).max()
        today = today or pd.Timestamp.today().normalize()
        months = (today - latest).days / 30.4
        if months > 18:
            out.append(_w("warning", "statements", f"Latest annual statement is from {latest:%b %Y} "
                                                   f"({months:.0f} months ago)."))
    return out


def validate_stock(data: StockData, today: pd.Timestamp | None = None) -> list[dict]:
    return validate_history(data.history, today) + validate_fundamentals(data, today)
