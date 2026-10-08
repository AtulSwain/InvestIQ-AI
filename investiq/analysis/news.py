"""News intelligence without AI: deterministic categorisation, de-duplication and
price-move linking. AI summaries (What happened / Why it matters / ...) are added
on demand by the AI module and always cite the article they summarise.
"""

from __future__ import annotations

import re

import pandas as pd

# Ordered: first match wins. Patterns are matched against lower-cased title + summary.
CATEGORIES = [
    ("earnings", r"\b(results?|earnings|quarter(ly)?|q[1-4]\b|profit|revenue|eps|guidance|beats?|miss(es)?)\b"),
    ("m&a", r"\b(acqui(re|res|sition)|merger|merge|takeover|buyout|stake sale|divest)"),
    ("regulatory", r"\b(sebi|sec\b|regulator|rbi|penalty|fine[ds]?|notice|probe|investigation|compliance|ban)\b"),
    ("lawsuit", r"\b(lawsuit|sued|sues|court|litigation|tribunal|nclt|verdict)\b"),
    ("insider", r"\b(promoter|insider|director (buys?|sells?)|pledge|stake (hike|increase|cut))\b"),
    ("analyst", r"\b(upgrade[sd]?|downgrade[sd]?|target price|price target|rating|brokerage|initiates? coverage|overweight|underweight)\b"),
    ("product", r"\b(launch(es|ed)?|unveil(s|ed)?|new product|rollout|partnership|order win|contracts?|deal)\b"),
    ("corporate", r"\b(dividend|buyback|split|bonus|ceo|cfo|appoint|resign|board)\b"),
    ("macro", r"\b(inflation|interest rate|repo rate|fed\b|gdp|crude|oil price|rupee|dollar|tariff|recession)\b"),
]
_COMPILED = [(name, re.compile(rx)) for name, rx in CATEGORIES]


def classify(title: str, summary: str | None = None) -> str:
    text = f"{title} {summary or ''}".lower()
    for name, rx in _COMPILED:
        if rx.search(text):
            return name
    return "general"


def _norm(title: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", title.lower())[:80]


def enrich_news(items: list[dict]) -> list[dict]:
    """Add a category, drop near-duplicate headlines, newest first."""
    seen, out = set(), []
    for it in items:
        key = _norm(it.get("title") or "")
        if not key or key in seen:
            continue
        seen.add(key)
        out.append({**it, "category": classify(it.get("title", ""), it.get("summary")),
                    "category_method": "keyword rules"})
    out.sort(key=lambda r: r.get("published_at") or "", reverse=True)
    return out


def link_to_price(news: list[dict], close: pd.Series, threshold_pct: float = 2.0) -> list[dict]:
    """Attach the stock's move on the publication day (or next trading day) to each article.

    ``moved`` marks days whose move exceeded ``threshold_pct`` - a co-occurrence, not proof of cause.
    """
    if close is None or close.empty:
        return news
    rets = close.pct_change() * 100
    out = []
    for n in news:
        rec = dict(n)
        pub = n.get("published_at")
        if pub:
            day = pd.Timestamp(pub[:10])
            after = rets.loc[day:]
            if len(after):
                d, r = after.index[0], after.iloc[0]
                if (d - day).days <= 4 and pd.notna(r):
                    rec["price_move"] = {"date": d.strftime("%Y-%m-%d"), "change_pct": round(float(r), 2),
                                         "moved": abs(float(r)) >= threshold_pct}
        out.append(rec)
    return out


def big_moves_with_news(close: pd.Series, news: list[dict], days: int = 120, threshold_pct: float = 3.0) -> list[dict]:
    """'Why did the stock move?' timeline: large daily moves and the headlines published around them."""
    if close is None or close.empty:
        return []
    rets = (close.pct_change() * 100).dropna()
    recent = rets.loc[close.index[-1] - pd.Timedelta(days=days):]
    events = []
    for d, r in recent[recent.abs() >= threshold_pct].items():
        window = [n for n in news if n.get("published_at") and
                  abs((pd.Timestamp(n["published_at"][:10]) - d).days) <= 2]
        events.append({"date": d.strftime("%Y-%m-%d"), "change_pct": round(float(r), 2),
                       "headlines": [{"title": n["title"], "url": n.get("url"), "publisher": n.get("publisher"),
                                      "category": n.get("category")} for n in window[:4]]})
    events.sort(key=lambda e: e["date"], reverse=True)
    return events[:15]
