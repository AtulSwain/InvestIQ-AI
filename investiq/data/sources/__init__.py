"""API-key data providers. Each one is active only when its key is set in the environment.

| Provider       | Env var(s)                                   | Used for (phase 1)                      |
|----------------|----------------------------------------------|-----------------------------------------|
| Alpaca         | ALPACA_API_KEY_ID + ALPACA_API_SECRET_KEY    | real-time US quotes (IEX)               |
| Finnhub        | FINNHUB_API_KEY                              | real-time US quotes                     |
| Twelve Data    | TWELVEDATA_API_KEY                           | US quotes, US price-history fallback    |
| FMP            | FMP_API_KEY                                  | US quotes, history + profile fallback   |
| Alpha Vantage  | ALPHAVANTAGE_API_KEY                         | last-resort quotes (25 calls/day)       |

Later phases add news, estimates, filings and macro on top of the same classes.
"""

from .base import KeyedSource, normalize_symbol
from .registry import all_sources, get_source, live_quote, provider_status, us_history_fallback

__all__ = [
    "KeyedSource",
    "all_sources",
    "get_source",
    "live_quote",
    "normalize_symbol",
    "provider_status",
    "us_history_fallback",
]
