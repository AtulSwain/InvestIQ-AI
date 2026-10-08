"""Peers and competitive landscape.

Peers = same-sector stocks from InvestIQ's universe (plus Finnhub's peer list for US
stocks when configured). Positioning ranks the company against that peer group on
size, growth, profitability, balance sheet and valuation. "Share of peer revenue" is
the share of the *tracked peer group's* combined revenue - not true market share.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from ..data.http import ProviderError
from ..data.provider import DataProvider
from ..data.sources import get_source
from ..data.symbols import market_for, sector_for, universe

SUMMARY_KEYS = ["price", "change_pct", "market_cap", "pe", "pb", "ps", "ev_ebitda", "dividend_yield_pct", "roe_pct",
                "roce_pct", "net_margin_pct", "revenue_cagr_pct", "profit_cagr_pct", "debt_to_equity",
                "return_1y_pct", "cagr_5y_pct", "volatility_pct", "max_drawdown_pct", "margin_of_safety_pct",
                "score", "checklist_passed", "piotroski", "fcf_yield_pct", "beta"]

# For ranking: True when higher is better.
RANK_DIRECTION = {"market_cap": True, "revenue": True, "revenue_cagr_pct": True, "profit_cagr_pct": True,
                  "net_margin_pct": True, "roe_pct": True, "roce_pct": True, "debt_to_equity": False,
                  "pe": False, "ev_ebitda": False, "return_1y_pct": True, "score": True}


def summary_row(report: dict) -> dict:
    """Compact, screener-ready row for one stock (values from the metric registry)."""
    m = report["metrics"]
    years = report["financials"].get("years") or []
    return {
        "symbol": report["symbol"], "name": report["name"], "currency": report["currency"],
        "market": report["market"], "exchange": report["fundamentals"].get("exchange") or report["market"],
        # InvestIQ's own sector map first, so sectors match across screener, peers and dashboard.
        "sector": sector_for(report["symbol"]) or report["fundamentals"].get("sector") or "Other",
        "revenue": years[-1].get("revenue") if years else None,
        "rating": report["scorecard"]["rating"], "valuation_verdict": report["valuation"]["verdict"],
        "checklist_total": report["checklist"]["evaluated"], "risk_level": report["risk_profile"]["level"],
        "as_of": report["as_of"],
        **{k: m[k]["value"] for k in SUMMARY_KEYS},
        "signals": {k: m[k]["signal"] for k in SUMMARY_KEYS if m[k].get("signal")},
    }


def peer_symbols(symbol: str, limit: int = 6) -> list[str]:
    symbol = symbol.upper()
    sector = sector_for(symbol)
    same_market = [s for s in universe() if market_for(s) == market_for(symbol) and s != symbol]
    peers = [s for s in same_market if sector and sector_for(s) == sector]
    fh = get_source("finnhub")
    if market_for(symbol) == "US" and fh.configured:
        try:
            extra = fh.fetch(f"{fh.BASE}/stock/peers", kind="profile",
                             params={"symbol": symbol.replace("-", "."), "token": fh.keys()[0]})
            peers += [p.replace(".", "-") for p in extra or [] if p.replace(".", "-") not in peers and p != symbol]
        except ProviderError:
            pass
    return peers[:limit]


def positioning(target: dict, peers: list[dict]) -> dict:
    """Rank the target within (target + peers) on each metric; 1 = best."""
    group = [target] + peers
    ranks = {}
    for key, higher_better in RANK_DIRECTION.items():
        vals = [(r["symbol"], r.get(key)) for r in group if r.get(key) is not None
                and not (key in ("pe", "ev_ebitda") and r.get(key) <= 0)]
        if len(vals) < 2 or target.get(key) is None:
            continue
        ordered = sorted(vals, key=lambda x: x[1], reverse=higher_better)
        pos = next((i for i, (s, _) in enumerate(ordered) if s == target["symbol"]), None)
        if pos is None:
            continue
        median = sorted(v for _, v in vals)[len(vals) // 2]
        ranks[key] = {"rank": pos + 1, "of": len(vals), "value": target.get(key), "peer_median": median}
    revenues = [r["revenue"] for r in group if r.get("revenue")]
    share = round(target["revenue"] / sum(revenues) * 100, 1) if target.get("revenue") and revenues else None
    return {"ranks": ranks, "share_of_peer_revenue_pct": share,
            "note": "Share of the tracked peer group's revenue - not total market share. R&D spend and product-level "
                    "data are not available from free sources."}


def peer_analysis(provider: DataProvider, symbol: str, target_report: dict, limit: int = 6) -> dict:
    from .report import build_report

    syms = peer_symbols(symbol, limit)

    def one(sym):
        try:
            return summary_row(build_report(provider, sym, live_quotes=False, with_extended=False))
        except Exception:
            return None

    with ThreadPoolExecutor(max_workers=4) as pool:
        rows = [r for r in pool.map(one, syms) if r]
    target = summary_row(target_report)
    return {"target": target, "peers": rows, "positioning": positioning(target, rows),
            "method": "Peers are same-sector stocks InvestIQ tracks" +
                      (" plus Finnhub's peer list." if market_for(symbol) == "US" and get_source("finnhub").configured else ".")}
