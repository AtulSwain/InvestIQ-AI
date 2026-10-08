"""Market-level intelligence: indices, macro markets, movers, sectors, upcoming earnings, macro.

Works from price histories (Yahoo or demo), so it needs no API keys. US macro series
come from Alpha Vantage when ALPHAVANTAGE_API_KEY is set (cached 24 h: 6 calls/day).
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor

import pandas as pd

from ..data.cache import get_cache
from ..data.provenance import now_iso, source
from ..data.provider import DataProvider, DataUnavailableError
from ..data.symbols import INDICES, MACRO_MARKETS, POPULAR_INDIA, POPULAR_US, sector_for, universe
from .util import date_str, downsample, num, pct, price_on_or_before

log = logging.getLogger("investiq.market")
MARKET_TTL = 15 * 60


def _histories(provider: DataProvider, symbols: list[str], workers: int = 8) -> dict[str, pd.DataFrame]:
    def one(sym):
        try:
            return sym, provider.get_history(sym)
        except (DataUnavailableError, Exception) as exc:  # one bad ticker never breaks the dashboard
            log.info("history unavailable for %s: %s", sym, exc)
            return sym, None

    with ThreadPoolExecutor(max_workers=workers) as pool:
        return {s: h for s, h in pool.map(one, symbols) if h is not None and len(h) > 2}


def instrument_stats(hist: pd.DataFrame, spark_points: int = 60) -> dict:
    close = hist["Close"]
    last, prev = float(close.iloc[-1]), float(close.iloc[-2])
    end = close.index[-1]

    def ret(offset):
        start = price_on_or_before(close, end - offset)
        return pct(last / start - 1) if start else None

    ytd_start = price_on_or_before(close, pd.Timestamp(end.year, 1, 1) - pd.Timedelta(days=1))
    vol = hist["Volume"] if "Volume" in hist else None
    avg_vol = float(vol.iloc[-21:-1].mean()) if vol is not None and len(vol) > 21 else None
    spark = close.iloc[-spark_points:]
    return {
        "last": num(last, 4 if last < 10 else 2),
        "change": num(last - prev, 4 if last < 10 else 2),
        "change_pct": pct(last / prev - 1),
        "week_pct": ret(pd.DateOffset(weeks=1)),
        "month_pct": ret(pd.DateOffset(months=1)),
        "ytd_pct": pct(last / ytd_start - 1) if ytd_start else None,
        "year_pct": ret(pd.DateOffset(years=1)),
        "high_52w": num(close.iloc[-252:].max(), 2),
        "low_52w": num(close.iloc[-252:].min(), 2),
        "volume": num(vol.iloc[-1], 0) if vol is not None else None,
        "volume_vs_avg": num(float(vol.iloc[-1]) / avg_vol, 2) if avg_vol else None,
        "as_of": date_str(end),
        "spark": [num(v, 2) for v in spark.values],
    }


def market_overview(provider: DataProvider) -> dict:
    """Indices + macro markets, cached 15 minutes."""
    cache = get_cache()
    key = f"market:overview:{provider.name}"
    hit = cache.get(key)
    if hit is not None:
        return hit
    instruments = INDICES + MACRO_MARKETS
    hists = _histories(provider, [s for s, *_ in instruments])
    rows = []
    for sym, name, group, region in instruments:
        if sym in hists:
            rows.append({"symbol": sym, "name": name, "group": group, "region": region, **instrument_stats(hists[sym])})
    out = {"generated_at": now_iso(), "instruments": rows,
           "source": source("market_overview", provider.name, delayed="End-of-day / ~15 min delayed",
                            methodology="Index, futures and FX closes; changes vs the previous close")}
    cache.set(key, out, MARKET_TTL)
    return out


def movers_and_sectors(provider: DataProvider, symbols: list[str] | None = None) -> dict:
    """Top gainers/losers/volume spikes and sector performance across the stock universe."""
    cache = get_cache()
    symbols = symbols or universe()
    key = f"market:movers:{provider.name}:{len(symbols)}"
    hit = cache.get(key)
    if hit is not None:
        return hit
    hists = _histories(provider, symbols)
    rows = []
    for sym, h in hists.items():
        base = sym.split(".")[0] if sym.endswith((".NS", ".BO")) else sym
        name = POPULAR_INDIA.get(base) or POPULAR_US.get(base) or sym
        rows.append({"symbol": sym, "name": name, "sector": sector_for(sym) or "Other",
                     "market": "IN" if sym.endswith((".NS", ".BO")) else "US", **instrument_stats(h, 30)})
    by_market = {}
    for mkt in ("IN", "US"):
        m = [r for r in rows if r["market"] == mkt and r["change_pct"] is not None]
        by_market[mkt] = {
            "gainers": sorted(m, key=lambda r: r["change_pct"], reverse=True)[:6],
            "losers": sorted(m, key=lambda r: r["change_pct"])[:6],
            "volume": sorted([r for r in m if r["volume_vs_avg"]], key=lambda r: r["volume_vs_avg"], reverse=True)[:6],
            "advancers": sum(1 for r in m if r["change_pct"] > 0),
            "decliners": sum(1 for r in m if r["change_pct"] < 0),
        }
    sectors = {}
    for r in rows:
        sectors.setdefault((r["market"], r["sector"]), []).append(r)
    sector_rows = []
    for (mkt, sec), members in sectors.items():
        def avg(k):
            vals = [m[k] for m in members if m[k] is not None]
            return round(sum(vals) / len(vals), 2) if vals else None
        best = max(members, key=lambda m: m["change_pct"] if m["change_pct"] is not None else -1e9)
        worst = min(members, key=lambda m: m["change_pct"] if m["change_pct"] is not None else 1e9)
        sector_rows.append({"market": mkt, "sector": sec, "count": len(members), "change_pct": avg("change_pct"),
                            "week_pct": avg("week_pct"), "month_pct": avg("month_pct"), "ytd_pct": avg("ytd_pct"),
                            "year_pct": avg("year_pct"), "best": best["symbol"], "worst": worst["symbol"],
                            "members": [m["symbol"] for m in members]})
    sector_rows.sort(key=lambda s: (s["market"], -(s["change_pct"] or 0)))
    out = {"generated_at": now_iso(), "stocks": rows, "movers": by_market, "sectors": sector_rows,
           "method": "Equal-weighted averages of InvestIQ's tracked stocks in each sector (not official sector indices).",
           "source": source("movers", provider.name, delayed="End-of-day", methodology="Daily closes of tracked stocks")}
    cache.set(key, out, MARKET_TTL)
    return out


def upcoming_earnings(extended_by_symbol: dict[str, dict], days: int = 45) -> list[dict]:
    """Next earnings dates across the universe from each stock's extended data."""
    today = pd.Timestamp.today().normalize()
    out = []
    for sym, ext in extended_by_symbol.items():
        for u in (ext.get("earnings") or {}).get("upcoming") or []:
            if not u.get("date"):
                continue
            d = pd.Timestamp(u["date"])
            if today <= d <= today + pd.Timedelta(days=days):
                out.append({"symbol": sym, "date": u["date"], "eps_estimate": u.get("eps_estimate"),
                            "days_away": int((d - today).days)})
    return sorted(out, key=lambda r: r["date"])


# ---------------------------------------------------------------- macro

AV_MACRO = [
    # (function, extra params, label, unit, frequency note)
    ("FEDERAL_FUNDS_RATE", {"interval": "monthly"}, "US Fed funds rate", "%", "monthly"),
    ("CPI", {"interval": "monthly"}, "US CPI (index)", "index", "monthly"),
    ("INFLATION", {}, "US inflation (annual)", "%", "annual"),
    ("UNEMPLOYMENT", {}, "US unemployment rate", "%", "monthly"),
    ("TREASURY_YIELD", {"interval": "monthly", "maturity": "10year"}, "US 10Y Treasury (monthly avg)", "%", "monthly"),
    ("REAL_GDP", {"interval": "quarterly"}, "US real GDP", "bn USD", "quarterly"),
]

# General, well-documented relationships - explanations, not predictions.
MACRO_SENSITIVITY = [
    {"driver": "Interest rates rising", "helps": ["Financials (wider lending margins, for banks)"],
     "hurts": ["High-P/E growth stocks (future profits discounted more)", "Real estate", "Utilities (bond-like)"],
     "why": "Higher rates raise the discount rate in valuations and the cost of borrowing."},
    {"driver": "Crude oil rising", "helps": ["Upstream energy producers (e.g. ONGC)"],
     "hurts": ["Oil marketing companies", "Airlines", "Paints and chemicals (oil-based inputs)", "India's trade deficit"],
     "why": "Oil is a major input cost; India imports most of its crude."},
    {"driver": "Rupee weakening vs USD", "helps": ["IT services and pharma exporters (earn in dollars)"],
     "hurts": ["Importers", "Companies with dollar debt"],
     "why": "Dollar revenues convert into more rupees; dollar costs and debt get more expensive."},
    {"driver": "Volatility (VIX) spiking", "helps": ["Defensive sectors: Consumer Staples, Health Care"],
     "hurts": ["High-beta stocks", "Small caps"],
     "why": "Investors move toward steadier earnings when uncertainty rises."},
    {"driver": "Gold rising", "helps": ["Gold financiers and jewellers' inventory value"],
     "hurts": ["Often a sign of risk-off sentiment"],
     "why": "Gold tends to rise with fear, falling real rates or a weaker dollar."},
]


def us_macro() -> dict:
    """Latest US macro readings from Alpha Vantage (when configured)."""
    from ..data.http import ProviderError
    from ..data.sources import get_source

    av = get_source("alphavantage")
    if not av.configured:
        return {"available": False, "series": [],
                "note": "Add ALPHAVANTAGE_API_KEY on the server for US macro series (rates, CPI, unemployment, GDP)."}
    series, errors = [], []
    for fn, extra, label, unit, freq in AV_MACRO:
        try:
            d = av.fetch(av.BASE, params={"function": fn, **extra, "apikey": av.keys()[0]}, kind="macro",
                         cache_key=f"macro:{fn}:{sorted(extra.items())}")
        except ProviderError as exc:
            errors.append(str(exc))
            continue
        pts = [p for p in (d.get("data") or []) if p.get("value") not in (None, ".", "")]
        if not pts:
            continue
        latest, prev = pts[0], pts[1] if len(pts) > 1 else None
        series.append({"id": fn, "label": label, "unit": unit, "frequency": freq, "date": latest.get("date"),
                       "value": num(latest.get("value"), 2), "previous": num(prev.get("value"), 2) if prev else None,
                       "history": [{"date": p["date"], "value": num(p["value"], 2)} for p in pts[:36]][::-1]})
    return {"available": True, "series": series, "errors": errors[:3],
            "source": source("us_macro", "alphavantage", methodology="Alpha Vantage economic indicators (FRED-based)")}


def macro_dashboard(provider: DataProvider) -> dict:
    overview = market_overview(provider)
    proxies = [i for i in overview["instruments"] if i["group"] in ("rates", "fx", "commodity", "volatility")]
    return {
        "generated_at": now_iso(),
        "market_indicators": proxies,
        "us_macro": us_macro(),
        "india_macro": {"available": False,
                        "note": "No free API publishes RBI policy rates, Indian CPI or GDP; see rbi.org.in and mospi.gov.in. "
                                "Market-implied indicators (USD/INR, India VIX) are shown instead."},
        "sensitivity": MACRO_SENSITIVITY,
        "economic_calendar": {"available": False,
                              "note": "Economic-event calendars need a paid data plan (e.g. Finnhub premium). "
                                      "This section stays empty rather than showing unverified dates."},
    }
