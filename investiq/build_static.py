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
import os
import re
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from .analysis.market import macro_dashboard, market_overview, movers_and_sectors, upcoming_earnings
from .analysis.peers import positioning, summary_row
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
    """Screener / dashboard row: every registry metric plus identity fields (see peers.summary_row)."""
    return summary_row(report)


def _attach_peers(reports: dict[str, dict], rows: dict[str, dict], limit: int = 6) -> None:
    """Snapshot peers: same-sector, same-market stocks from this build, with positioning ranks."""
    for sym, report in reports.items():
        target = rows[sym]
        peers = [r for s, r in rows.items() if s != sym and r["sector"] == target["sector"]
                 and r["market"] == target["market"]][:limit]
        report["peers"] = {"target": target, "peers": peers, "positioning": positioning(target, peers),
                           "method": "Peers are same-sector stocks in today's InvestIQ snapshot."}


def _market_files(provider: DataProvider, reports: dict[str, dict], out: Path) -> None:
    """Dashboard data: indices, macro markets, movers, sectors, earnings calendar and a merged news feed."""
    extended = {s: r.get("extended") or {} for s, r in reports.items()}
    news = [{**n, "symbol": s} for s, e in extended.items() for n in (e.get("news") or [])[:6]]
    news.sort(key=lambda n: n.get("published_at") or "", reverse=True)
    market = {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "overview": market_overview(provider),
        "movers": movers_and_sectors(provider, list(reports)),
        "macro": macro_dashboard(provider),
        "earnings": upcoming_earnings(extended, days=60),
        "news": news[:100],
    }
    (out / "data" / "market.json").write_text(json.dumps(market, separators=(",", ":"), allow_nan=False))


def site_config(api_base: str | None) -> str:
    """config.js for the Pages build. ``api_base`` (the hosted FastAPI URL) enables live data."""
    cfg = {"static": True}
    if api_base:
        api_base = api_base.strip().rstrip("/")
        if not re.match(r"^https://[A-Za-z0-9.-]+(:\d+)?(/[\w./-]*)?$", api_base):
            raise ValueError(f"--api-base must be an https:// URL, got {api_base!r}")
        cfg["apiBase"] = api_base
    return f"window.INVESTIQ_CONFIG = {json.dumps(cfg)};\n"


def build_site(provider: DataProvider, symbols: list[str], out: Path, pause: float = 0.0,
               api_base: str | None = None) -> dict:
    if out.exists():
        shutil.rmtree(out)
    (out / "data" / "reports").mkdir(parents=True)
    shutil.copytree(WEB_DIR, out / "static", ignore=shutil.ignore_patterns("index.html"))
    shutil.copy(WEB_DIR / "index.html", out / "index.html")
    (out / "static" / "config.js").write_text(site_config(api_base))
    (out / ".nojekyll").write_text("")

    reports, row_map, failures = {}, {}, []
    for i, symbol in enumerate(symbols, 1):
        try:
            # Snapshots are read hours later, so never bake in a "real-time" quote.
            report = build_report(provider, symbol, live_quotes=False)
        except Exception as exc:  # one bad ticker must not stop the build
            failures.append({"symbol": symbol, "error": str(exc)[:200]})
            print(f"[{i}/{len(symbols)}] {symbol}: FAILED {exc}", file=sys.stderr)
            continue
        reports[report["symbol"]] = report
        row_map[report["symbol"]] = _index_row(report)
        print(f"[{i}/{len(symbols)}] {report['symbol']}: ok")
        if pause:
            time.sleep(pause)

    _attach_peers(reports, row_map)
    for sym, report in reports.items():
        path = out / "data" / "reports" / f"{report_filename(sym)}.json"
        path.write_text(json.dumps(report, separators=(",", ":"), allow_nan=False))
    if reports:
        try:
            _market_files(provider, reports, out)
        except Exception as exc:  # the dashboard degrades to empty states rather than failing the build
            print(f"market data FAILED: {exc}", file=sys.stderr)

    rows = sorted(row_map.values(), key=lambda r: (r["currency"] != "INR", r["symbol"]))
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
    parser.add_argument("--api-base", default=os.environ.get("INVESTIQ_API_URL"),
                        help="https URL of the hosted InvestIQ API (enables live data on the site)")
    args = parser.parse_args()

    symbols = [s.strip().upper() for s in args.symbols.split(",")] if args.symbols else default_universe()
    provider = DemoProvider() if args.demo else YahooProvider()
    index = build_site(provider, symbols, Path(args.out), pause=0 if args.demo else args.pause,
                       api_base=args.api_base)
    print(f"Built {len(index['stocks'])} reports, {len(index['failed'])} failed -> {args.out}/")
    # Fail the workflow (and keep the previous deployment) if most downloads broke.
    if len(index["stocks"]) < max(1, len(symbols) // 2):
        sys.exit("Too many failures; not publishing")


if __name__ == "__main__":
    main()
