import pytest

from investiq import api
from investiq.data import cache as cache_mod
from investiq.data import http as http_mod
from investiq.data.sources import all_sources

PROVIDER_ENV = ["FMP_API_KEY", "FINNHUB_API_KEY", "ALPHAVANTAGE_API_KEY", "TWELVEDATA_API_KEY",
                "ALPACA_API_KEY_ID", "ALPACA_API_SECRET_KEY", "ANTHROPIC_API_KEY"]


@pytest.fixture(autouse=True)
def isolated_environment(monkeypatch):
    """No real keys, a fresh in-memory cache, no shared HTTP client and a relaxed rate limit per test."""
    for var in PROVIDER_ENV:
        monkeypatch.delenv(var, raising=False)
    cache_mod.set_cache(cache_mod.Cache(":memory:"))
    http_mod.set_client(None)
    monkeypatch.setattr(api, "limiter", api.RateLimiter(10_000))
    for src in all_sources():
        src.last_error = src.last_error_at = src.last_ok_at = None
    yield
    http_mod.set_client(None)
    cache_mod.set_cache(None)
