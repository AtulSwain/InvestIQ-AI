"""Build a static copy of InvestIQ for GitHub Pages.

    python -m investiq.build_static [--out site] [--symbols RELIANCE.NS,TCS.NS] [--demo]

Writes the dashboard plus one pre-computed JSON report per stock:

    site/index.html
    site/static/...              dashboard assets (config.js switched to static mode)
    site/data/index.json         list of stocks with headline numbers
    site/data/reports/<SYM>.json full report per stock

GitHub Pages cannot run Python, so the scheduled workflow in
.github/workflows/pages.yml runs this after market close and deploys ``site/``.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from .analysis.report import build_report
from .data.provider import DataProvider, DemoProvider, YahooProvider
from .data.symbols import POPULAR_INDIA, POPULAR_US

WEB_DIR = Path(__file__).resolve().parent.parent / "web"


def default_universe() -> list[str]:
    return [s + ".NS" for s in POPULAR_INDIA] + list(POPULAR_US)


def report_filename(symbol: str) -> str:
    """Filesystem/URL-safe name. Must match fileName() in web/data.js."""
    return re.sub(r"[^A-Z0-9.\-]", "_", symbol.upper())


def _index_row(report: dict) -> dict:
    one_year = next((t for t in report["performance"]["trailing"] if t["period"] == "1Y"), {})
    return {
        "symbol": report["symbol"],
        "name": report["name"],
        "exchange": report["fundamentals"].get("exchange") or report["market"],
        "currency": report["currency"],
        "price": report["quote"]["price"],
        "change_pct": report["quote"]["change_pct"],
        "return_1y_pct": one_year.get("total_return_pct"),
        "valuation_verdict": report["valuation"]["verdict"],
        "score": report["scorecard"]["overall"],
        "rating": report["scorecard"]["rating"],
        "as_of": report["as_of"],
    }


def build_site(provider: DataProvider, symbols: list[str], out: Path, pause: float = 0.0) -> dict:
    if out.exists():
        shutil.rmtree(out)
    (out / "data" / "reports").mkdir(parents=True)
    shutil.copytree(WEB_DIR, out / "static", ignore=shutil.ignore_patterns("index.html"))
    shutil.copy(WEB_DIR / "index.html", out / "index.html")
    (out / "static" / "config.js").write_text("window.INVESTIQ_CONFIG = { static: true };\n")
    (out / ".nojekyll").write_text("")

    rows, failures = [], []
    for i, symbol in enumerate(symbols, 1):
        try:
            report = build_report(provider, symbol)
        except Exception as exc:  # one bad ticker must not stop the build
            failures.append({"symbol": symbol, "error": str(exc)[:200]})
            print(f"[{i}/{len(symbols)}] {symbol}: FAILED {exc}", file=sys.stderr)
            continue
        path = out / "data" / "reports" / f"{report_filename(report['symbol'])}.json"
        path.write_text(json.dumps(report, separators=(",", ":"), allow_nan=False))
        rows.append(_index_row(report))
        print(f"[{i}/{len(symbols)}] {report['symbol']}: ok")
        if pause:
            time.sleep(pause)

    rows.sort(key=lambda r: (r["currency"] != "INR", r["symbol"]))
    index = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "demo": provider.is_demo,
        "stocks": rows,
        "failed": failures,
    }
    (out / "data" / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    return index


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default="site")
    parser.add_argument("--symbols", help="comma-separated tickers (default: built-in list)")
    parser.add_argument("--demo", action="store_true", help="synthetic data, no network")
    parser.add_argument("--pause", type=float, default=0.5, help="seconds between stocks (be kind to Yahoo)")
    args = parser.parse_args()

    symbols = [s.strip().upper() for s in args.symbols.split(",")] if args.symbols else default_universe()
    provider = DemoProvider() if args.demo else YahooProvider()
    index = build_site(provider, symbols, Path(args.out), pause=0 if args.demo else args.pause)
    print(f"Built {len(index['stocks'])} reports, {len(index['failed'])} failed -> {args.out}/")
    # Fail the workflow (and keep the previous deployment) if most downloads broke.
    if len(index["stocks"]) < max(1, len(symbols) // 2):
        sys.exit("Too many failures; not publishing")


if __name__ == "__main__":
    main()
