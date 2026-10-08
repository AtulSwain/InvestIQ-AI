"""Where every number came from.

Each report carries a list of ``source`` records, one per dataset (price
history, live quote, company profile, financial statements, ...). Report
sections reference them by ``id`` so the UI can show source, last-updated
time, reporting period, currency, actual/estimate status and methodology.
"""

from __future__ import annotations

from datetime import datetime, timezone

PROVIDERS = {
    "yahoo": {"label": "Yahoo Finance (via yfinance)", "url": "https://finance.yahoo.com"},
    "fmp": {"label": "Financial Modeling Prep", "url": "https://financialmodelingprep.com"},
    "finnhub": {"label": "Finnhub", "url": "https://finnhub.io"},
    "alphavantage": {"label": "Alpha Vantage", "url": "https://www.alphavantage.co"},
    "twelvedata": {"label": "Twelve Data", "url": "https://twelvedata.com"},
    "alpaca": {"label": "Alpaca Markets (IEX feed)", "url": "https://alpaca.markets"},
    "investiq": {"label": "InvestIQ calculation", "url": None},
    "demo": {"label": "InvestIQ demo data (synthetic)", "url": None},
}

STATUSES = ("actual", "estimate", "derived")


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def source(dataset: str, provider: str, *, fetched_at: str | None = None, as_of: str | None = None,
           period: str | None = None, currency: str | None = None, status: str = "actual",
           realtime: bool = False, delayed: str | None = None, methodology: str | None = None) -> dict:
    """Build one provenance record. ``dataset`` doubles as its id within a report."""
    if status not in STATUSES:
        raise ValueError(f"status must be one of {STATUSES}")
    info = PROVIDERS.get(provider, {"label": provider, "url": None})
    return {
        "id": dataset,
        "dataset": dataset,
        "provider": provider,
        "provider_label": info["label"],
        "provider_url": info["url"],
        "fetched_at": fetched_at or now_iso(),
        "as_of": as_of,
        "period": period,
        "currency": currency,
        "status": status,
        "realtime": realtime,
        "delayed": delayed,
        "methodology": methodology,
    }
