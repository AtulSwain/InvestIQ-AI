"""Common behaviour for API-key providers: key lookup, caching, quotas, error tracking."""

from __future__ import annotations

import os
import threading

from ..cache import TTL, get_cache
from ..http import ProviderError, RateLimitError, get_json
from ..provenance import now_iso


def normalize_symbol(provider: str, symbol: str) -> str:
    """Yahoo-style ticker -> the provider's spelling (class shares use '.' at most US APIs)."""
    s = symbol.upper()
    if provider in ("finnhub", "alpaca", "twelvedata") and "-" in s and not s.endswith((".NS", ".BO")):
        return s.replace("-", ".")
    return s


class KeyedSource:
    id = "base"
    env_vars: tuple[str, ...] = ()
    daily_limit: int | None = None     # hard daily quota (we stop calling once reached)
    realtime_us = False                # quotes are real-time for US stocks on the free plan

    def __init__(self):
        self._lock = threading.Lock()
        self.last_error: str | None = None
        self.last_error_at: str | None = None
        self.last_ok_at: str | None = None

    # ---------- configuration ----------
    def keys(self) -> list[str | None]:
        return [os.environ.get(v) or None for v in self.env_vars]

    @property
    def configured(self) -> bool:
        return bool(self.env_vars) and all(self.keys())

    def supports(self, symbol: str) -> bool:
        """Default: US listings only (no .NS/.BO suffix, no indices)."""
        s = symbol.upper()
        return not s.endswith((".NS", ".BO")) and not s.startswith("^")

    # ---------- HTTP with cache + quota ----------
    def fetch(self, url: str, *, params: dict | None = None, headers: dict | None = None,
              kind: str = "quote", cache_key: str | None = None):
        cache = get_cache()
        key = f"{self.id}:{cache_key or self._cache_key(url, params)}"
        hit = cache.get(key)
        if hit is not None:
            return hit
        if self.daily_limit is not None and cache.calls_today(self.id) >= self.daily_limit:
            raise RateLimitError(self.id, f"daily quota of {self.daily_limit} calls used up")
        cache.count_call(self.id)
        try:
            data = get_json(self.id, url, params=params, headers=headers)
            data = self.check_payload(data)
        except ProviderError as exc:
            self._fail(exc)
            raise
        self.last_ok_at = now_iso()
        cache.set(key, data, TTL[kind])
        return data

    @staticmethod
    def _cache_key(url: str, params: dict | None) -> str:
        # Never let credentials end up in the on-disk cache.
        safe = sorted((k, str(v)) for k, v in (params or {}).items()
                      if k.lower() not in ("apikey", "api_key", "token", "key"))
        return f"{url}?{safe}"

    def check_payload(self, data):
        """Hook for providers that report errors inside a 200 response."""
        return data

    def _fail(self, exc: ProviderError):
        with self._lock:
            self.last_error = str(exc)
            self.last_error_at = now_iso()

    # ---------- capabilities (overridden per provider) ----------
    def quote(self, symbol: str) -> dict | None:
        """Normalised quote dict or None. See ``registry.live_quote`` for the shape."""
        return None

    def daily_history(self, symbol: str) -> list[dict] | None:
        """[{date, open, high, low, close, volume}, ...] oldest first, or None."""
        return None

    def status(self) -> dict:
        cache = get_cache()
        return {
            "id": self.id,
            "configured": self.configured,
            "env_vars": list(self.env_vars),
            "calls_today": cache.calls_today(self.id),
            "daily_limit": self.daily_limit,
            "last_ok_at": self.last_ok_at,
            "last_error": self.last_error,
            "last_error_at": self.last_error_at,
        }


def to_float(v):
    if v is None or v == "":
        return None
    try:
        if isinstance(v, str):
            v = v.strip().rstrip("%")
        return float(v)
    except (TypeError, ValueError):
        return None
