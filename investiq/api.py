"""FastAPI app: JSON endpoints plus the single-page dashboard in ``web/``.

Hosting notes (see render.yaml / README):
* API keys come only from environment variables and are never returned by any endpoint.
* Browsers may call the API only from origins in ``INVESTIQ_ALLOWED_ORIGINS``
  (comma-separated; defaults to the GitHub Pages site and localhost).
* A small per-client rate limit protects the free-tier provider quotas.
"""

from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .analysis.report import build_comparison, build_report
from .data.provenance import now_iso, source
from .data.provider import DataUnavailableError, get_provider
from .data.sources import live_quote, provider_status
from .data.symbols import resolve_candidates

WEB_DIR = Path(__file__).resolve().parent.parent / "web"
DEFAULT_ORIGINS = "https://atulswain.github.io,http://localhost:8000,http://127.0.0.1:8000"

app = FastAPI(title="InvestIQ", version=__version__)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("INVESTIQ_ALLOWED_ORIGINS", DEFAULT_ORIGINS).split(",") if o.strip()],
    allow_methods=["GET"],
    allow_headers=["*"],
    max_age=3600,
)


class RateLimiter:
    """Sliding-window limit per client IP (in-memory; fine for a single small instance)."""

    def __init__(self, limit: int, window: float = 60.0):
        self.limit, self.window = limit, window
        self.hits: dict[str, deque] = defaultdict(deque)
        self.lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self.lock:
            q = self.hits[key]
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.limit:
                return False
            q.append(now)
            return True


limiter = RateLimiter(int(os.environ.get("INVESTIQ_RATE_LIMIT", "60")))


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    if request.url.path.startswith("/api/") and request.url.path != "/api/health":
        # Behind one trusted proxy (Render) the real client IP is the LAST X-Forwarded-For entry;
        # earlier entries are supplied by the client and can be spoofed.
        forwarded = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
        client = forwarded[-1] if forwarded else (request.client.host if request.client else "unknown")
        if not limiter.allow(client):
            return JSONResponse({"detail": "Too many requests - please wait a minute."}, status_code=429,
                                headers={"Retry-After": "60"})
    return await call_next(request)


@app.get("/api/health")
def health():
    provider = get_provider()
    return {
        "status": "ok",
        "version": __version__,
        "time": now_iso(),
        "data_source": provider.name,
        "demo": provider.is_demo,
        "providers": provider_status(),
        "ai": {"configured": bool(os.environ.get("ANTHROPIC_API_KEY"))},
    }


@app.get("/api/search")
def search(q: str = Query(..., min_length=1, max_length=60)):
    return {"results": get_provider().search(q)}


@app.get("/api/quote/{query}")
def quote(query: str):
    """Fastest available quote: real-time/near-real-time from API-key providers (US), else last close."""
    provider = get_provider()
    candidates = resolve_candidates(query)
    if not candidates:
        raise HTTPException(status_code=404, detail="Unknown symbol")
    symbol = candidates[0]
    if not provider.is_demo:
        q, errors = live_quote(symbol)
        if q:
            return {**q, "source": source("live_quote", q["provider"], as_of=q["timestamp"],
                                          realtime=q["realtime"], delayed=q["delayed"])}
    try:
        for sym in candidates:
            try:
                hist = provider.get_history(sym)
                break
            except DataUnavailableError:
                continue
        else:
            raise DataUnavailableError(f"No data for {query}")
    except DataUnavailableError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    close = hist["Close"]
    price, prev = float(close.iloc[-1]), float(close.iloc[-2])
    return {
        "symbol": sym, "price": round(price, 2), "change": round(price - prev, 2),
        "change_pct": round((price / prev - 1) * 100, 2), "prev_close": round(prev, 2),
        "timestamp": close.index[-1].strftime("%Y-%m-%d"), "provider": provider.name, "realtime": False,
        "source": source("price_history", "demo" if provider.is_demo else "yahoo",
                         as_of=close.index[-1].strftime("%Y-%m-%d"), delayed="Last daily close"),
    }


@app.get("/api/report/{query}")
def report(query: str):
    try:
        return build_report(get_provider(), query)
    except DataUnavailableError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/compare")
def compare(symbols: str = Query(..., description="Comma-separated, e.g. RELIANCE,TCS,INFY")):
    queries = [s.strip() for s in symbols.split(",") if s.strip()]
    if not 2 <= len(queries) <= 5:
        raise HTTPException(status_code=400, detail="Compare between 2 and 5 stocks")
    return build_comparison(get_provider(), queries)


@app.exception_handler(Exception)
async def unexpected_error(request: Request, exc: Exception):
    # Never leak stack traces or provider URLs (which can contain keys) to clients.
    return JSONResponse({"detail": "Something went wrong while fetching data. Please try again."}, status_code=500)


if WEB_DIR.exists():
    app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(WEB_DIR / "index.html")
