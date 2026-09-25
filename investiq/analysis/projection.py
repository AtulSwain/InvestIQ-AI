"""Forward-looking scenarios built from the stock's own return history.

Prices are modelled as log-normal (geometric Brownian motion). Historical
drift is shrunk halfway toward a long-run market return, because a stock
that 10x'd in the past is not likely to repeat it just because it did.
These are statistical ranges, not predictions.
"""

from __future__ import annotations

from math import erf, sqrt

import numpy as np
import pandas as pd

from .util import TRADING_DAYS, clamp, num, pct

MARKET_LONG_RUN = {"IN": 0.12, "US": 0.09}
Z = {"bear": -1.2816, "base": 0.0, "bull": 1.2816}  # 10th / 50th / 90th percentile


def estimate_params(close: pd.Series, market: str, lookback_years: int = 10) -> dict:
    window = close.loc[close.index[-1] - pd.DateOffset(years=lookback_years):]
    log_ret = np.log(window / window.shift(1)).dropna()
    sigma = float(log_ret.std() * np.sqrt(TRADING_DAYS))
    years = (window.index[-1] - window.index[0]).days / 365.25
    hist_cagr = (window.iloc[-1] / window.iloc[0]) ** (1 / years) - 1 if years > 0 else 0.0
    long_run = MARKET_LONG_RUN[market]
    # Weight own history more when we have more of it (max 50%).
    w = clamp(years / 20, 0.1, 0.5)
    expected = clamp(w * hist_cagr + (1 - w) * long_run, -0.10, 0.30)
    return {
        "historical_cagr": hist_cagr,
        "expected_return": expected,
        "volatility": sigma,
        "lookback_years": years,
        "history_weight": w,
    }


def scenario_price(price: float, expected: float, sigma: float, years: float, z: float) -> float:
    # Median of a log-normal with arithmetic-ish expected CAGR: use log drift = ln(1+expected).
    mu = np.log1p(expected)
    return float(price * np.exp(mu * years + z * sigma * np.sqrt(years)))


def analyze_projection(close: pd.Series, market: str) -> dict:
    price = float(close.iloc[-1])
    p = estimate_params(close, market)
    horizons = []
    for years in (1, 3, 5, 10):
        row = {"years": years}
        for name, z in Z.items():
            value = scenario_price(price, p["expected_return"], p["volatility"], years, z)
            row[name] = {
                "price": num(value, 2),
                "cagr_pct": pct((value / price) ** (1 / years) - 1),
            }
        horizons.append(row)

    # Fan chart: monthly points for 10 years.
    fan = []
    for m in range(0, 121, 3):
        t = m / 12
        fan.append({
            "months": m,
            **{name: num(scenario_price(price, p["expected_return"], p["volatility"], t, z), 2)
               for name, z in Z.items()},
        })

    probability_of_loss = {}
    mu = np.log1p(p["expected_return"])
    for years in (1, 3, 5, 10):
        if p["volatility"] > 0:
            zc = -mu * years / (p["volatility"] * sqrt(years))
            probability_of_loss[f"{years}Y"] = pct(0.5 * (1 + erf(zc / sqrt(2))), 1)

    return {
        "current_price": num(price, 2),
        "assumptions": {
            "historical_cagr_pct": pct(p["historical_cagr"]),
            "expected_return_pct": pct(p["expected_return"]),
            "volatility_pct": pct(p["volatility"]),
            "lookback_years": num(p["lookback_years"], 1),
            "long_run_market_return_pct": pct(MARKET_LONG_RUN[market]),
            "history_weight_pct": pct(p["history_weight"], 0),
        },
        "scenario_rates_pct": {
            name: horizons[-1][name]["cagr_pct"] for name in Z
        },
        "horizons": horizons,
        "fan": fan,
        "probability_of_loss_pct": probability_of_loss,
        "note": "Bear/Base/Bull = 10th/50th/90th percentile outcomes of a log-normal model "
                "fitted to past volatility. Not a forecast.",
    }
