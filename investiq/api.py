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

from concurrent.futures import ThreadPoolExecutor

from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from . import ai
from .analysis.market import macro_dashboard, market_overview, movers_and_sectors, upcoming_earnings
from .analysis.peers import peer_analysis, summary_row
from .analysis.portfolio import analyze_portfolio
from .analysis.report import build_comparison, build_report
from .analysis.thesis import check_thesis
from .data.cache import get_cache
from .data.extended import get_extended, next_earnings, symbol_news
from .data.provenance import now_iso, source
from .data.provider import DataUnavailableError, get_provider
from .data.sources import live_quote, provider_status
from .data.symbols import resolve_candidates, universe

WEB_DIR = Path(__file__).resolve().parent.parent / "web"
DEFAULT_ORIGINS = "https://atulswain.github.io,http://localhost:8000,http://127.0.0.1:8000"

app = FastAPI(title="InvestIQ", version=__version__)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("INVESTIQ_ALLOWED_ORIGINS", DEFAULT_ORIGINS).split(",") if o.strip()],
    allow_methods=["GET", "POST"],
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
# AI calls cost money: a much tighter per-client budget (per hour).
ai_limiter = RateLimiter(int(os.environ.get("INVESTIQ_AI_RATE_LIMIT", "20")), window=3600.0)


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
        if request.url.path.startswith("/api/ai/") and not ai_limiter.allow(client):
            return JSONResponse({"detail": "AI research limit reached for this hour - please try again later."},
                                status_code=429, headers={"Retry-After": "600"})
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
        "ai": {"configured": ai.configured(), "model": os.environ.get("INVESTIQ_AI_MODEL", ai.DEFAULT_MODEL)
               if ai.configured() else None},
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


# ---------------------------------------------------------------- markets

@app.get("/api/market/overview")
def market():
    return market_overview(get_provider())


@app.get("/api/market/movers")
def movers():
    return movers_and_sectors(get_provider())


@app.get("/api/market/macro")
def macro():
    return macro_dashboard(get_provider())


@app.get("/api/market/earnings")
def earnings_calendar(days: int = Query(45, ge=1, le=120)):
    provider = get_provider()
    with ThreadPoolExecutor(max_workers=8) as pool:
        rows = list(pool.map(lambda s: next_earnings(s, demo=provider.is_demo), universe()))
    ext = {r["symbol"]: {"earnings": {"upcoming": [r]}} for r in rows if r}
    return {"generated_at": now_iso(), "items": upcoming_earnings(ext, days)}


@app.get("/api/market/news")
def market_news(symbols: str | None = Query(None, description="Comma-separated; default: largest tracked stocks")):
    provider = get_provider()
    syms = [s.strip().upper() for s in symbols.split(",")][:15] if symbols else universe()[:12] + universe()[-4:]
    with ThreadPoolExecutor(max_workers=8) as pool:
        lists = list(pool.map(lambda s: symbol_news(s, demo=provider.is_demo), syms))
    items = sorted([n for lst in lists for n in lst], key=lambda n: n.get("published_at") or "", reverse=True)
    return {"generated_at": now_iso(), "items": items[:80],
            "source": source("news", "demo" if provider.is_demo else "yahoo", methodology="Per-stock news streams, merged")}


# ---------------------------------------------------------------- research

def _report_or_404(query: str, **kwargs):
    try:
        return build_report(get_provider(), query, **kwargs)
    except DataUnavailableError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/extended/{query}")
def extended(query: str):
    report = _report_or_404(query)
    return report["extended"] or {}


@app.get("/api/peers/{query}")
def peers(query: str):
    report = _report_or_404(query)
    return peer_analysis(get_provider(), report["symbol"], report)


@app.get("/api/screener")
def screener():
    """Summary rows (every registry metric) for the tracked universe, cached 6 h."""
    provider = get_provider()
    cache = get_cache()
    key = f"screener:{provider.name}"
    hit = cache.get(key)
    if hit is not None:
        return hit

    def row(sym):
        try:
            return summary_row(build_report(provider, sym, live_quotes=False, with_extended=False))
        except Exception:
            return None

    with ThreadPoolExecutor(max_workers=6) as pool:
        rows = [r for r in pool.map(row, universe()) if r]
    out = {"generated_at": now_iso(), "stocks": rows}
    cache.set(key, out, 6 * 3600)
    return out


@app.post("/api/portfolio")
def portfolio(payload: dict = Body(...)):
    holdings = payload.get("holdings") or []
    if not isinstance(holdings, list):
        raise HTTPException(status_code=400, detail="holdings must be a list")
    base = payload.get("base") if payload.get("base") in ("INR", "USD") else "INR"
    return analyze_portfolio(get_provider(), holdings, base)


@app.post("/api/thesis/check")
def thesis_check(payload: dict = Body(...)):
    symbol = payload.get("symbol")
    if not symbol:
        raise HTTPException(status_code=400, detail="symbol is required")
    report = _report_or_404(symbol)
    return check_thesis(report, payload.get("assumptions") or [], payload.get("since"))


# ---------------------------------------------------------------- AI research

@app.post("/api/ai/ask")
def ai_ask(payload: dict = Body(...)):
    question = (payload.get("question") or "").strip()
    symbols = [s for s in (payload.get("symbols") or []) if isinstance(s, str)][:4]
    if not question or len(question) > 2000:
        raise HTTPException(status_code=400, detail="Ask a question (up to 2000 characters).")
    if not ai.configured():
        raise HTTPException(status_code=503, detail="AI research is not configured on this server (ANTHROPIC_API_KEY).")
    reports = [_report_or_404(s) for s in symbols]
    try:
        return ai.cached_run(question, reports, web_search=payload.get("web_search"))
    except ai.AIUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/ai/summary/{query}")
def ai_summary(query: str):
    if not ai.configured():
        raise HTTPException(status_code=503, detail="AI research is not configured on this server (ANTHROPIC_API_KEY).")
    return ai.summary(_report_or_404(query))


@app.exception_handler(Exception)
async def unexpected_error(request: Request, exc: Exception):
    # Never leak stack traces or provider URLs (which can contain keys) to clients.
    return JSONResponse({"detail": "Something went wrong while fetching data. Please try again."}, status_code=500)


if WEB_DIR.exists():
    app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(WEB_DIR / "index.html")
