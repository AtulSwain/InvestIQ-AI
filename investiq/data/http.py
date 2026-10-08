"""Shared HTTP client for the API-key data providers.

* One pooled ``httpx.Client`` with sane timeouts.
* Retries with exponential backoff on 429 / 5xx and network errors.
* Typed errors so callers can fall back to the next provider.
* API keys never appear in exceptions or logs (``redact``).
"""

from __future__ import annotations

import logging
import re
import time

import httpx

log = logging.getLogger("investiq.http")

# Query-string / header names that carry credentials.
_SECRET_PARAMS = re.compile(r"(?i)((?:api_?key|apikey|token|secret|key_id)=)[^&\s]+")


class ProviderError(Exception):
    """A provider call failed. ``retryable`` tells the caller whether trying later may help."""

    def __init__(self, provider: str, message: str, status: int | None = None, retryable: bool = False):
        super().__init__(f"{provider}: {redact(message)}")
        self.provider = provider
        self.status = status
        self.retryable = retryable


class AuthError(ProviderError):
    """Missing, invalid or under-privileged API key (401/403, or the provider's equivalent)."""


class RateLimitError(ProviderError):
    """Provider rate limit or daily quota exhausted."""


class NotFoundError(ProviderError):
    """Symbol or resource not found."""


def redact(text: str) -> str:
    return _SECRET_PARAMS.sub(r"\1***", str(text))


_client: httpx.Client | None = None


def client() -> httpx.Client:
    global _client
    if _client is None:
        _client = httpx.Client(
            timeout=httpx.Timeout(12.0, connect=5.0),
            headers={"User-Agent": "InvestIQ/1.0 (+https://github.com/AtulSwain/InvestIQ-AI)"},
            follow_redirects=True,
        )
    return _client


def set_client(c: httpx.Client | None) -> None:
    """Swap the client (tests inject an ``httpx.MockTransport``)."""
    global _client
    _client = c


def get_json(provider: str, url: str, *, params: dict | None = None, headers: dict | None = None,
             retries: int = 2, backoff: float = 0.8):
    """GET ``url`` and return parsed JSON, raising a typed ``ProviderError`` on failure."""
    last: ProviderError | None = None
    for attempt in range(retries + 1):
        try:
            resp = client().get(url, params=params, headers=headers)
        except httpx.HTTPError as exc:
            last = ProviderError(provider, f"network error: {type(exc).__name__}", retryable=True)
        else:
            if resp.status_code in (401, 403):
                raise AuthError(provider, f"HTTP {resp.status_code} - check the API key or plan", resp.status_code)
            if resp.status_code == 404:
                raise NotFoundError(provider, "not found", 404)
            if resp.status_code == 429:
                last = RateLimitError(provider, "rate limited (HTTP 429)", 429, retryable=True)
            elif resp.status_code >= 500:
                last = ProviderError(provider, f"server error HTTP {resp.status_code}", resp.status_code, retryable=True)
            elif resp.status_code >= 400:
                raise ProviderError(provider, f"HTTP {resp.status_code}", resp.status_code)
            else:
                try:
                    return resp.json()
                except ValueError as exc:
                    raise ProviderError(provider, "response was not JSON") from exc
        if attempt < retries:
            wait = backoff * (2 ** attempt)
            log.info("%s; retrying in %.1fs", last, wait)
            time.sleep(wait)
    raise last
