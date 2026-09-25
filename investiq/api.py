"""FastAPI app: JSON endpoints plus the single-page dashboard in ``web/``."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .analysis.report import build_comparison, build_report
from .data.provider import DataUnavailableError, get_provider

WEB_DIR = Path(__file__).resolve().parent.parent / "web"

app = FastAPI(title="InvestIQ", version=__version__)


@app.get("/api/health")
def health():
    provider = get_provider()
    return {"status": "ok", "version": __version__, "data_source": provider.name, "demo": provider.is_demo}


@app.get("/api/search")
def search(q: str = Query(..., min_length=1, max_length=60)):
    return {"results": get_provider().search(q)}


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


if WEB_DIR.exists():
    app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(WEB_DIR / "index.html")
