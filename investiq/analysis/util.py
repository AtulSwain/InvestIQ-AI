from __future__ import annotations

import math

import numpy as np
import pandas as pd

TRADING_DAYS = 252


def num(x, digits: int | None = None):
    """Coerce to a JSON-safe float (None for missing/NaN/inf)."""
    if x is None:
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(v) or math.isinf(v):
        return None
    return round(v, digits) if digits is not None else v


def pct(x, digits: int = 2):
    """Fraction -> percent, JSON-safe."""
    v = num(x)
    return None if v is None else round(v * 100, digits)


def date_str(ts) -> str | None:
    if ts is None or (isinstance(ts, float) and math.isnan(ts)):
        return None
    return pd.Timestamp(ts).strftime("%Y-%m-%d")


def price_on_or_before(close: pd.Series, when: pd.Timestamp):
    """Last close at or before ``when``; None if the series starts later."""
    if when < close.index[0]:
        return None
    return close.loc[:when].iloc[-1]


def cagr(start: float, end: float, years: float):
    if not start or start <= 0 or end is None or end <= 0 or years <= 0:
        return None
    return (end / start) ** (1 / years) - 1


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def daily_returns(close: pd.Series) -> pd.Series:
    return close.pct_change().dropna()


def log_returns(close: pd.Series) -> pd.Series:
    return np.log(close / close.shift(1)).dropna()


def downsample(series: pd.Series, max_points: int = 1500) -> pd.Series:
    """Thin a long daily series for charting while keeping the last point."""
    if len(series) <= max_points:
        return series
    step = math.ceil(len(series) / max_points)
    thinned = series.iloc[::step]
    if thinned.index[-1] != series.index[-1]:
        thinned = pd.concat([thinned, series.iloc[-1:]])
    return thinned
