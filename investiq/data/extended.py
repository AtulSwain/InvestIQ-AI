"""Company extras beyond prices/statements: news, earnings, quarterly results, ownership,
insider activity, analyst actions and filings.

Everything comes from Yahoo Finance (free, covers NSE/BSE and US) with optional
Finnhub enrichment for US news. Each part is fetched independently - one failing
part never breaks the rest - and the result is JSON-safe with provenance records.
"""

from __future__ import annotations

import math
import zlib
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from .cache import get_cache
from .provenance import now_iso, source
from .symbols import currency_for, market_for

EXT_TTL = 3 * 3600  # extras change slowly; news is refreshed with the same cadence on the free plan


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) or math.isinf(f) else f


def _date(v):
    if v is None:
        return None
    try:
        ts = pd.Timestamp(v)
    except (ValueError, TypeError):
        return None
    if pd.isna(ts):
        return None
    if ts.tzinfo is not None:
        ts = ts.tz_convert("UTC").tz_localize(None)
    return ts.strftime("%Y-%m-%d")


def _iso(v):
    """Unix seconds / ISO string / Timestamp -> ISO-8601 UTC string."""
    if v is None:
        return None
    try:
        if isinstance(v, (int, float)):
            return datetime.fromtimestamp(v, tz=timezone.utc).replace(microsecond=0).isoformat()
        ts = pd.Timestamp(v)
        if ts.tzinfo is None:
            ts = ts.tz_localize("UTC")
        return ts.tz_convert("UTC").replace(microsecond=0).isoformat()
    except (ValueError, TypeError, OverflowError):
        return None


def _safe(fn, default=None):
    try:
        out = fn()
        return default if out is None else out
    except Exception:
        return default


# ---------------------------------------------------------------- parsers (Yahoo shapes)

def parse_news(items) -> list[dict]:
    """Yahoo news items: new shape {'content': {...}} or legacy flat {'title', 'link', ...}."""
    out = []
    for it in items or []:
        c = it.get("content") if isinstance(it.get("content"), dict) else it
        title = c.get("title")
        if not title:
            continue
        url = ((c.get("canonicalUrl") or {}).get("url") or (c.get("clickThroughUrl") or {}).get("url")
               or c.get("link"))
        publisher = (c.get("provider") or {}).get("displayName") or c.get("publisher")
        published = _iso(c.get("pubDate") or c.get("displayTime") or c.get("providerPublishTime"))
        out.append({
            "title": title.strip(),
            "summary": (c.get("summary") or c.get("description") or "").strip()[:600] or None,
            "publisher": publisher,
            "url": url,
            "published_at": published,
            "provider": "yahoo",
        })
    return out


def parse_earnings_dates(df) -> tuple[list[dict], list[dict]]:
    """yfinance earnings_dates -> (past results with surprise, upcoming dates)."""
    past, upcoming = [], []
    if df is None or len(df) == 0:
        return past, upcoming
    now = pd.Timestamp.now(tz="UTC")
    for idx, row in df.iterrows():
        when = pd.Timestamp(idx)
        when_utc = when.tz_convert("UTC") if when.tzinfo else when.tz_localize("UTC")
        rec = {
            "date": _date(idx),
            "eps_estimate": _num(row.get("EPS Estimate")),
            "eps_actual": _num(row.get("Reported EPS")),
            "surprise_pct": _num(row.get("Surprise(%)")),
        }
        if when_utc > now or rec["eps_actual"] is None:
            if when_utc > now:
                upcoming.append(rec)
        else:
            past.append(rec)
    past.sort(key=lambda r: r["date"], reverse=True)
    upcoming.sort(key=lambda r: r["date"])
    return past[:12], upcoming[:2]


def parse_quarterly(income: pd.DataFrame, cashflow: pd.DataFrame) -> list[dict]:
    if income is None or income.empty:
        return []

    def row(df, *names):
        if df is None or df.empty:
            return {}
        for n in names:
            if n in df.index:
                return {pd.Timestamp(k): _num(v) for k, v in df.loc[n].items()}
        return {}

    rev = row(income, "Total Revenue", "Operating Revenue")
    ni = row(income, "Net Income", "Net Income Common Stockholders")
    op = row(income, "Operating Income", "EBIT")
    eps = row(income, "Diluted EPS", "Basic EPS")
    fcf = row(cashflow, "Free Cash Flow")
    out = []
    for d in sorted(set(rev) | set(ni)):
        r, n = rev.get(d), ni.get(d)
        out.append({
            "period_end": d.strftime("%Y-%m-%d"),
            "revenue": r, "net_income": n, "operating_income": op.get(d), "eps": eps.get(d),
            "free_cash_flow": fcf.get(d),
            "net_margin_pct": round(n / r * 100, 2) if r and n is not None else None,
            "operating_margin_pct": round(op[d] / r * 100, 2) if r and op.get(d) is not None else None,
        })
    # Year-on-year growth (same quarter last year = 4 periods back)
    for i, q in enumerate(out):
        if i >= 4:
            prev = out[i - 4]
            for key in ("revenue", "net_income"):
                a, b = q[key], prev[key]
                q[f"{key}_yoy_pct"] = round((a / b - 1) * 100, 2) if a is not None and b and b > 0 else None
    return out[-8:]


def _records(df, mapping: dict, limit: int = 15) -> list[dict]:
    if df is None or len(df) == 0:
        return []
    out = []
    for _, r in df.head(limit).iterrows():
        rec = {}
        for key, (col, kind) in mapping.items():
            v = r.get(col)
            rec[key] = _date(v) if kind == "date" else _num(v) if kind == "num" else (
                None if v is None or (isinstance(v, float) and math.isnan(v)) else str(v))
        out.append(rec)
    return out


def parse_major_holders(df) -> dict:
    if df is None or len(df) == 0:
        return {}
    try:
        values = df.iloc[:, 0].to_dict()
    except Exception:
        return {}
    return {
        "insiders_pct": _pct(values.get("insidersPercentHeld")),
        "institutions_pct": _pct(values.get("institutionsPercentHeld")),
        "institutions_float_pct": _pct(values.get("institutionsFloatPercentHeld")),
        "institutions_count": _num(values.get("institutionsCount")),
    }


def _pct(v):
    f = _num(v)
    return round(f * 100, 2) if f is not None else None


def parse_upgrades(df, limit=15) -> list[dict]:
    if df is None or len(df) == 0:
        return []
    df = df.sort_index(ascending=False).head(limit)
    return [{"date": _date(idx), "firm": r.get("Firm"), "to_grade": r.get("ToGrade"),
             "from_grade": r.get("FromGrade") or None, "action": r.get("Action"),
             "price_target": _num(r.get("currentPriceTarget"))} for idx, r in df.iterrows()]


def parse_recommendations(df) -> list[dict]:
    if df is None or len(df) == 0:
        return []
    out = []
    for _, r in df.iterrows():
        out.append({"period": r.get("period"), **{k: int(_num(r.get(k)) or 0)
                                                  for k in ("strongBuy", "buy", "hold", "sell", "strongSell")}})
    return out


def parse_estimates(df) -> list[dict]:
    """earnings_estimate / revenue_estimate: rows 0q, +1q, 0y, +1y."""
    if df is None or len(df) == 0:
        return []
    labels = {"0q": "Current quarter", "+1q": "Next quarter", "0y": "Current year", "+1y": "Next year"}
    return [{"period": labels.get(str(idx), str(idx)), "avg": _num(r.get("avg")), "low": _num(r.get("low")),
             "high": _num(r.get("high")), "year_ago": _num(r.get("yearAgoEps") if "yearAgoEps" in r else r.get("yearAgoRevenue")),
             "analysts": _num(r.get("numberOfAnalysts")), "growth_pct": _pct(r.get("growth"))}
            for idx, r in df.iterrows()]


def parse_sec_filings(items, limit=25) -> list[dict]:
    out = []
    for f in (items or [])[:limit]:
        out.append({"date": f.get("date") or _date(f.get("epochDate")), "type": f.get("type"),
                    "title": f.get("title"), "url": f.get("edgarUrl"),
                    "exhibits": [{"name": k, "url": v} for k, v in (f.get("exhibits") or {}).items()][:5]})
    return out


def exchange_links(symbol: str) -> list[dict]:
    """Official filing / announcement pages for Indian listings (no free API exists for these)."""
    base = symbol.upper().rsplit(".", 1)[0]
    return [
        {"label": "NSE corporate announcements",
         "url": f"https://www.nseindia.com/get-quotes/equity?symbol={base}"},
        {"label": "BSE corporate filings", "url": f"https://www.bseindia.com/stock-share-price/{base.lower()}/"},
        {"label": "Annual reports (NSE)", "url": f"https://www.nseindia.com/companies-listing/corporate-filings-annual-reports?symbol={base}"},
    ]


# ---------------------------------------------------------------- Yahoo fetcher

def fetch_yahoo_extended(symbol: str) -> dict:
    import yfinance as yf

    t = yf.Ticker(symbol)
    fetched = now_iso()
    currency = currency_for(symbol)
    out = {"symbol": symbol.upper(), "fetched_at": fetched, "sources": []}

    news = parse_news(_safe(lambda: t.get_news(count=20), []))
    out["news"] = news
    if news:
        out["sources"].append(source("news", "yahoo", fetched_at=fetched, methodology="Yahoo Finance news stream"))

    past, upcoming = parse_earnings_dates(_safe(lambda: t.get_earnings_dates(limit=16)))
    cal = _safe(lambda: t.calendar, {}) or {}
    next_dates = [_date(d) for d in (cal.get("Earnings Date") or [])] if isinstance(cal, dict) else []
    out["earnings"] = {
        "history": past,
        "upcoming": upcoming or [{"date": d, "eps_estimate": _num(cal.get("Earnings Average")),
                                  "eps_actual": None, "surprise_pct": None} for d in next_dates if d],
        "revenue_estimate_next": _num(cal.get("Revenue Average")) if isinstance(cal, dict) else None,
        "eps_estimates": parse_estimates(_safe(lambda: t.earnings_estimate)),
        "revenue_estimates": parse_estimates(_safe(lambda: t.revenue_estimate)),
        "ex_dividend_date": _date(cal.get("Ex-Dividend Date")) if isinstance(cal, dict) else None,
    }
    if past or out["earnings"]["eps_estimates"]:
        out["sources"].append(source("earnings", "yahoo", fetched_at=fetched, currency=currency, status="estimate",
                                     methodology="Reported EPS vs consensus estimates; forward estimates are analyst consensus"))

    out["quarterly"] = parse_quarterly(_safe(lambda: t.quarterly_income_stmt, pd.DataFrame()),
                                       _safe(lambda: t.quarterly_cashflow, pd.DataFrame()))
    if out["quarterly"]:
        out["sources"].append(source("quarterly_statements", "yahoo", fetched_at=fetched, currency=currency,
                                     as_of=out["quarterly"][-1]["period_end"], period="Quarterly, last 8 quarters",
                                     methodology="Company-reported quarterly results"))

    out["ownership"] = {
        "major": parse_major_holders(_safe(lambda: t.major_holders)),
        "institutions": _records(_safe(lambda: t.institutional_holders), {
            "holder": ("Holder", "str"), "pct_held": ("pctHeld", "num"), "shares": ("Shares", "num"),
            "value": ("Value", "num"), "pct_change": ("pctChange", "num"), "date": ("Date Reported", "date")}, 10),
        "funds": _records(_safe(lambda: t.mutualfund_holders), {
            "holder": ("Holder", "str"), "pct_held": ("pctHeld", "num"), "shares": ("Shares", "num"),
            "value": ("Value", "num"), "pct_change": ("pctChange", "num"), "date": ("Date Reported", "date")}, 10),
        "insider_transactions": _records(_safe(lambda: t.insider_transactions), {
            "insider": ("Insider", "str"), "position": ("Position", "str"), "transaction": ("Transaction", "str"),
            "text": ("Text", "str"), "shares": ("Shares", "num"), "value": ("Value", "num"),
            "date": ("Start Date", "date"), "ownership": ("Ownership", "str")}, 20),
    }
    if any(out["ownership"].values()):
        out["sources"].append(source("ownership", "yahoo", fetched_at=fetched,
                                     methodology="Latest holder filings; insider transactions as reported to regulators"))

    out["analyst"] = {
        "actions": parse_upgrades(_safe(lambda: t.upgrades_downgrades)),
        "trend": parse_recommendations(_safe(lambda: t.recommendations)),
        "targets": {k: _num(v) for k, v in (_safe(lambda: t.analyst_price_targets, {}) or {}).items()},
    }
    if out["analyst"]["actions"] or out["analyst"]["trend"]:
        out["sources"].append(source("analyst", "yahoo", fetched_at=fetched, status="estimate",
                                     methodology="Broker rating changes and consensus recommendation counts"))

    if market_for(symbol) == "US":
        out["filings"] = {"items": parse_sec_filings(_safe(lambda: t.sec_filings, [])), "links": [
            {"label": "SEC EDGAR filing index",
             "url": f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={symbol}&type=&dateb=&owner=include&count=40"}]}
        if out["filings"]["items"]:
            out["sources"].append(source("filings", "yahoo", fetched_at=fetched,
                                         methodology="SEC EDGAR filing index via Yahoo Finance"))
    else:
        out["filings"] = {"items": [], "links": exchange_links(symbol),
                          "note": "NSE/BSE do not offer a free filings API - official pages are linked instead."}
    return out


def _finnhub_news(symbol: str) -> list[dict]:
    from .http import ProviderError
    from .sources import get_source

    fh = get_source("finnhub")
    if not fh.configured or market_for(symbol) != "US":
        return []
    today = datetime.now(timezone.utc).date()
    try:
        rows = fh.fetch(f"{fh.BASE}/company-news", kind="news",
                        params={"symbol": symbol.upper().replace("-", "."), "from": str(today - timedelta(days=14)),
                                "to": str(today), "token": fh.keys()[0]})
    except ProviderError:
        return []
    return [{"title": r.get("headline"), "summary": (r.get("summary") or "")[:600] or None,
             "publisher": r.get("source"), "url": r.get("url"), "published_at": _iso(r.get("datetime")),
             "provider": "finnhub"} for r in rows or [] if r.get("headline")][:30]


def get_extended(symbol: str, demo: bool = False) -> dict:
    """Cached extras for one stock (JSON-safe), with keyword-classified news."""
    from ..analysis.news import enrich_news

    key = f"extended:{'demo' if demo else 'live'}:{symbol.upper()}"
    cache = get_cache()
    hit = cache.get(key)
    if hit is not None:
        return hit
    data = demo_extended(symbol) if demo else fetch_yahoo_extended(symbol)
    if not demo:
        extra = _finnhub_news(symbol)
        if extra:
            data["news"] = extra + data["news"]
            data["sources"].append(source("news_finnhub", "finnhub", methodology="Finnhub company news, last 14 days"))
    data["news"] = enrich_news(data["news"])
    cache.set(key, data, EXT_TTL)
    return data


# ---------------------------------------------------------------- demo (offline, clearly synthetic)

_DEMO_HEADLINES = [
    ("{name} reports quarterly results ahead of estimates", "earnings"),
    ("{name} announces new product line for domestic market", "product"),
    ("Brokerage upgrades {name} to buy, raises target price", "analyst"),
    ("{name} board approves dividend and share buyback", "corporate"),
    ("Regulator issues notice to {name} over disclosure lapse", "regulatory"),
    ("{name} in talks to acquire smaller rival", "m&a"),
    ("Promoter group increases stake in {name}", "insider"),
    ("Rising interest rates weigh on {name} sector peers", "macro"),
]


def demo_extended(symbol: str) -> dict:
    rng = np.random.default_rng(zlib.crc32(("ext" + symbol.upper()).encode()))
    name = symbol.split(".")[0].title()
    today = pd.Timestamp.today().normalize()
    news = []
    for i, (title, _cat) in enumerate(_DEMO_HEADLINES):
        news.append({"title": "[Demo] " + title.format(name=name), "summary": "Synthetic headline for demo mode.",
                     "publisher": "InvestIQ Demo Wire", "url": None,
                     "published_at": (today - pd.Timedelta(days=i * 3 + int(rng.integers(0, 3)))).isoformat() + "Z",
                     "provider": "demo"})
    hist = []
    for q in range(8):
        est = round(float(rng.uniform(8, 30)), 2)
        act = round(est * float(rng.uniform(0.9, 1.12)), 2)
        hist.append({"date": (today - pd.DateOffset(months=3 * q + 1)).strftime("%Y-%m-%d"), "eps_estimate": est,
                     "eps_actual": act, "surprise_pct": round((act / est - 1) * 100, 2)})
    quarters = []
    rev = float(rng.uniform(5e10, 5e11))
    for q in range(8, 0, -1):
        r = rev * (1 + 0.025) ** (8 - q)
        n = r * float(rng.uniform(0.08, 0.16))
        quarters.append({"period_end": (today - pd.DateOffset(months=3 * q)).strftime("%Y-%m-%d"), "revenue": r,
                         "net_income": n, "operating_income": n * 1.4, "eps": n / 1e9, "free_cash_flow": n * 0.8,
                         "net_margin_pct": round(n / r * 100, 2), "operating_margin_pct": round(n * 1.4 / r * 100, 2)})
    for i, q in enumerate(quarters):
        if i >= 4:
            q["revenue_yoy_pct"] = round((q["revenue"] / quarters[i - 4]["revenue"] - 1) * 100, 2)
            q["net_income_yoy_pct"] = round((q["net_income"] / quarters[i - 4]["net_income"] - 1) * 100, 2)
    tag = [source(k, "demo", methodology="Synthetic demo data") for k in
           ("news", "earnings", "quarterly_statements", "ownership", "analyst")]
    return {
        "symbol": symbol.upper(), "fetched_at": now_iso(), "sources": tag, "news": news,
        "earnings": {"history": hist, "upcoming": [{"date": (today + pd.Timedelta(days=int(rng.integers(5, 60)))).strftime("%Y-%m-%d"),
                                                   "eps_estimate": hist[0]["eps_estimate"], "eps_actual": None, "surprise_pct": None}],
                     "revenue_estimate_next": quarters[-1]["revenue"] * 1.03, "eps_estimates": [], "revenue_estimates": [],
                     "ex_dividend_date": None},
        "quarterly": quarters,
        "ownership": {"major": {"insiders_pct": round(float(rng.uniform(5, 60)), 2),
                                "institutions_pct": round(float(rng.uniform(10, 50)), 2),
                                "institutions_float_pct": None, "institutions_count": float(rng.integers(100, 900))},
                      "institutions": [{"holder": f"Demo Fund {i + 1}", "pct_held": round(float(rng.uniform(0.5, 4)), 2),
                                        "shares": float(rng.integers(1e6, 5e7)), "value": None,
                                        "pct_change": round(float(rng.uniform(-10, 10)), 2), "date": today.strftime("%Y-%m-%d")}
                                       for i in range(5)],
                      "funds": [],
                      "insider_transactions": [{"insider": f"Demo Director {i + 1}", "position": "Director",
                                                "transaction": "Buy" if i % 2 == 0 else "Sale",
                                                "text": "Synthetic transaction", "shares": float(rng.integers(1e3, 1e5)),
                                                "value": None, "date": (today - pd.Timedelta(days=20 * i)).strftime("%Y-%m-%d"),
                                                "ownership": "D"} for i in range(4)]},
        "analyst": {"actions": [{"date": (today - pd.Timedelta(days=15 * i)).strftime("%Y-%m-%d"),
                                 "firm": f"Demo Securities {i + 1}", "to_grade": ["Buy", "Hold", "Outperform"][i % 3],
                                 "from_grade": None, "action": ["up", "main", "init"][i % 3], "price_target": None}
                                for i in range(4)],
                    "trend": [{"period": "0m", "strongBuy": 5, "buy": 10, "hold": 6, "sell": 1, "strongSell": 0}],
                    "targets": {}},
        "filings": {"items": [], "links": exchange_links(symbol) if market_for(symbol) == "IN" else [],
                    "note": "Demo mode - no filings."},
    }


# ---------------------------------------------------------------- lightweight universe-wide helpers

def next_earnings(symbol: str, demo: bool = False) -> dict | None:
    """Only the next earnings date (one Yahoo call, cached 12 h) - for the dashboard calendar."""
    cache = get_cache()
    key = f"next_earnings:{'demo' if demo else 'live'}:{symbol.upper()}"
    hit = cache.get(key)
    if hit is not None:
        return hit or None
    if demo:
        rng = np.random.default_rng(zlib.crc32(("ne" + symbol.upper()).encode()))
        d = (pd.Timestamp.today().normalize() + pd.Timedelta(days=int(rng.integers(1, 70)))).strftime("%Y-%m-%d")
        out = {"symbol": symbol.upper(), "date": d, "eps_estimate": round(float(rng.uniform(5, 40)), 2)}
    else:
        import yfinance as yf

        cal = _safe(lambda: yf.Ticker(symbol).calendar, {}) or {}
        dates = [_date(x) for x in (cal.get("Earnings Date") or [])] if isinstance(cal, dict) else []
        dates = [d for d in dates if d]
        out = {"symbol": symbol.upper(), "date": dates[0], "eps_estimate": _num(cal.get("Earnings Average"))} if dates else {}
    cache.set(key, out, 12 * 3600)
    return out or None


def symbol_news(symbol: str, demo: bool = False, count: int = 10) -> list[dict]:
    """Headlines only (one Yahoo call, cached via the 'news' TTL)."""
    from ..analysis.news import enrich_news
    from .cache import TTL

    cache = get_cache()
    key = f"news:{'demo' if demo else 'live'}:{symbol.upper()}"
    hit = cache.get(key)
    if hit is not None:
        return hit
    if demo:
        items = demo_extended(symbol)["news"][:count]
    else:
        import yfinance as yf

        items = parse_news(_safe(lambda: yf.Ticker(symbol).get_news(count=count), []))
    items = [{**n, "symbol": symbol.upper()} for n in enrich_news(items)]
    cache.set(key, items, TTL["news"])
    return items
