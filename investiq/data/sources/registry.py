"""Pick the best configured provider for each job and fall back down the chain on errors."""

from __future__ import annotations

import logging

from ..http import ProviderError
from ..symbols import market_for
from .providers import FMP, Alpaca, AlphaVantage, Finnhub, TwelveData

log = logging.getLogger("investiq.sources")

_SOURCES = {s.id: s for s in (Alpaca(), Finnhub(), TwelveData(), FMP(), AlphaVantage())}

# Preference order per job. Real-time feeds first; Alpha Vantage last because of its 25/day quota.
QUOTE_CHAIN = {"US": ["alpaca", "finnhub", "twelvedata", "fmp", "alphavantage"], "IN": []}
HISTORY_CHAIN = {"US": ["fmp", "twelvedata"], "IN": []}


def all_sources():
    return list(_SOURCES.values())


def get_source(source_id: str):
    return _SOURCES[source_id]


def _chain(job: dict, symbol: str):
    for sid in job.get(market_for(symbol), []):
        src = _SOURCES[sid]
        if src.configured and src.supports(symbol):
            yield src


def live_quote(symbol: str) -> tuple[dict | None, list[str]]:
    """Best available quote from the API-key providers (None for India / no keys configured).

    Returns (quote, errors) so the caller can show why a fallback was used.
    """
    errors = []
    for src in _chain(QUOTE_CHAIN, symbol):
        try:
            q = src.quote(symbol)
        except ProviderError as exc:
            errors.append(str(exc))
            log.info("quote fallback: %s", exc)
            continue
        if q:
            return q, errors
    return None, errors


def us_history_fallback(symbol: str) -> tuple[list[dict] | None, str | None, list[str]]:
    """Daily bars from FMP / Twelve Data when Yahoo is unavailable (US listings only)."""
    errors = []
    for src in _chain(HISTORY_CHAIN, symbol):
        try:
            rows = src.daily_history(symbol)
        except ProviderError as exc:
            errors.append(str(exc))
            continue
        if rows and len(rows) >= 2:
            return rows, src.id, errors
    return None, None, errors


def provider_status() -> list[dict]:
    """Configured / quota / last-error state for /api/health. Never includes key values."""
    return [s.status() for s in _SOURCES.values()]
