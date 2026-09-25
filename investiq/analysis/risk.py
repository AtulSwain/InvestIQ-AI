"""Risk: volatility, drawdowns (the big falls and recoveries), beta, Sharpe."""

from __future__ import annotations

import numpy as np
import pandas as pd

from .util import TRADING_DAYS, date_str, downsample, num, pct


def drawdown_series(close: pd.Series) -> pd.Series:
    return close / close.cummax() - 1


def drawdown_episodes(close: pd.Series, n: int = 5, min_depth: float = 0.10) -> list[dict]:
    """Largest peak-to-trough falls, each with its recovery date (if recovered)."""
    dd = drawdown_series(close)
    episodes = []
    in_dd = False
    peak_date = close.index[0]
    for date, value in dd.items():
        if value == 0:
            if in_dd:
                episodes[-1]["recovery"] = date
                in_dd = False
            peak_date = date
        elif not in_dd:
            in_dd = True
            episodes.append({"peak": peak_date, "trough": date, "depth": value, "recovery": None})
        elif value < episodes[-1]["depth"]:
            episodes[-1]["trough"] = date
            episodes[-1]["depth"] = value
    episodes = [e for e in episodes if e["depth"] <= -min_depth]
    episodes.sort(key=lambda e: e["depth"])
    out = []
    for e in episodes[:n]:
        end = e["recovery"] or close.index[-1]
        out.append(
            {
                "peak_date": date_str(e["peak"]),
                "peak_price": num(close[e["peak"]], 2),
                "trough_date": date_str(e["trough"]),
                "trough_price": num(close[e["trough"]], 2),
                "depth_pct": pct(e["depth"]),
                "recovery_date": date_str(e["recovery"]),
                "recovered": e["recovery"] is not None,
                "days_to_bottom": int((e["trough"] - e["peak"]).days),
                "days_underwater": int((end - e["peak"]).days),
            }
        )
    return out


def beta_vs(close: pd.Series, benchmark: pd.Series, years: int) -> dict:
    start = close.index[-1] - pd.DateOffset(years=years)
    joined = pd.concat([close.loc[start:], benchmark.loc[start:]], axis=1, join="inner").dropna()
    if len(joined) < 60:
        return {"beta": None, "correlation": None}
    rets = joined.pct_change().dropna()
    cov = np.cov(rets.iloc[:, 0], rets.iloc[:, 1])
    beta = cov[0, 1] / cov[1, 1] if cov[1, 1] else None
    return {"beta": num(beta, 2), "correlation": num(rets.corr().iloc[0, 1], 2)}


def _window(close: pd.Series, years: int | None) -> pd.Series:
    if years is None:
        return close
    return close.loc[close.index[-1] - pd.DateOffset(years=years):]


def ratio_stats(close: pd.Series, risk_free: float, years: int | None) -> dict:
    series = _window(close, years)
    rets = series.pct_change().dropna()
    if len(rets) < 30:
        return {}
    vol = rets.std() * np.sqrt(TRADING_DAYS)
    span = (series.index[-1] - series.index[0]).days / 365.25
    ann_ret = (series.iloc[-1] / series.iloc[0]) ** (1 / span) - 1 if span > 0 else None
    downside = rets[rets < 0].std() * np.sqrt(TRADING_DAYS)
    sharpe = (ann_ret - risk_free) / vol if ann_ret is not None and vol else None
    sortino = (ann_ret - risk_free) / downside if ann_ret is not None and downside else None
    max_dd = drawdown_series(series).min()
    return {
        "annual_return_pct": pct(ann_ret),
        "volatility_pct": pct(vol),
        "sharpe": num(sharpe, 2),
        "sortino": num(sortino, 2),
        "max_drawdown_pct": pct(max_dd),
        "var_95_daily_pct": pct(np.percentile(rets, 5)),
        "positive_days_pct": pct((rets > 0).mean(), 1),
    }


def risk_level(vol_pct: float | None, max_dd_pct: float | None) -> str:
    if vol_pct is None:
        return "Unknown"
    score = vol_pct + abs(max_dd_pct or 0) / 3
    if score < 28:
        return "Low"
    if score < 42:
        return "Moderate"
    if score < 60:
        return "High"
    return "Very High"


def analyze_risk(close: pd.Series, benchmark: pd.Series | None, risk_free: float) -> dict:
    windows = {label: ratio_stats(close, risk_free, y) for label, y in (("1Y", 1), ("3Y", 3), ("5Y", 5), ("10Y", 10))}
    windows = {k: v for k, v in windows.items() if v}
    windows["MAX"] = ratio_stats(close, risk_free, None)
    dd = drawdown_series(close)
    last_year = close.iloc[-TRADING_DAYS:]
    one_y = windows.get("1Y") or windows["MAX"]
    betas = {}
    if benchmark is not None and len(benchmark):
        betas = {f"{y}Y": beta_vs(close, benchmark, y) for y in (1, 3, 5)}
    dd_chart = downsample(dd)
    return {
        "risk_free_rate_pct": pct(risk_free),
        "windows": windows,
        "beta": betas,
        "current_drawdown_pct": pct(dd.iloc[-1]),
        "max_drawdown": {
            "depth_pct": pct(dd.min()),
            "date": date_str(dd.idxmin()),
        },
        "drawdown_episodes": drawdown_episodes(close),
        "week52": {
            "high": num(last_year.max(), 2),
            "low": num(last_year.min(), 2),
            "pct_from_high": pct(close.iloc[-1] / last_year.max() - 1),
            "pct_from_low": pct(close.iloc[-1] / last_year.min() - 1),
        },
        "risk_level": risk_level(one_y.get("volatility_pct"), windows["MAX"].get("max_drawdown_pct")),
        "drawdown_chart": {
            "dates": [date_str(d) for d in dd_chart.index],
            "values": [pct(v) for v in dd_chart.values],
        },
    }
