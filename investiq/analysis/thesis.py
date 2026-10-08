"""Investment Thesis Tracker: check a user's thesis against the latest data.

A thesis has measurable assumptions ("revenue CAGR > 10", "debt_to_equity < 1") and
the date it was written. The check reports, for each assumption, whether it still
holds (with the current value and its source), plus new developments since the thesis
date that typically warrant a review: risk-category news, analyst downgrades, insider
selling, earnings misses and big price moves.
"""

from __future__ import annotations

import operator

import pandas as pd

OPS = {">": operator.gt, ">=": operator.ge, "<": operator.lt, "<=": operator.le, "==": operator.eq}
RISK_NEWS = {"regulatory", "lawsuit", "m&a", "insider"}


def evaluate_assumptions(metrics: dict, assumptions: list[dict]) -> list[dict]:
    out = []
    for a in assumptions:
        key, op, target = a.get("metric"), a.get("op"), a.get("value")
        m = metrics.get(key)
        rec = {**a, "label": m["label"] if m else key, "current": m["value"] if m else None,
               "source": m["source"] if m else None, "period": m["period"] if m else None}
        if not m or op not in OPS or target is None:
            rec.update(status="unknown", reason="Unknown metric or rule.")
        elif m["value"] is None:
            rec.update(status="unknown", reason="No current data for this metric.")
        else:
            ok = OPS[op](float(m["value"]), float(target))
            rec.update(status="holds" if ok else "broken",
                       reason=f"Now {m['value']:.2f} vs required {op} {target}" if isinstance(m["value"], (int, float))
                       else f"Now {m['value']}")
        out.append(rec)
    return out


def developments_since(report: dict, since: str | None) -> list[dict]:
    """Events after ``since`` (YYYY-MM-DD) that commonly challenge a thesis."""
    ext = report.get("extended") or {}
    start = pd.Timestamp(since) if since else pd.Timestamp.today() - pd.Timedelta(days=90)
    events = []
    for n in ext.get("news") or []:
        pub = n.get("published_at")
        if pub and pd.Timestamp(pub[:10]) >= start and n.get("category") in RISK_NEWS:
            events.append({"date": pub[:10], "type": f"news:{n['category']}", "detail": n["title"], "url": n.get("url"),
                           "severity": "review"})
    for a in (ext.get("analyst") or {}).get("actions") or []:
        if a.get("date") and pd.Timestamp(a["date"]) >= start and (a.get("action") or "").lower() in ("down", "downgrade"):
            events.append({"date": a["date"], "type": "analyst:downgrade",
                           "detail": f"{a.get('firm')} downgraded to {a.get('to_grade')}", "severity": "review"})
    for t in (ext.get("ownership") or {}).get("insider_transactions") or []:
        text = f"{t.get('transaction') or ''} {t.get('text') or ''}".lower()
        if t.get("date") and pd.Timestamp(t["date"]) >= start and "sale" in text:
            events.append({"date": t["date"], "type": "insider:sale",
                           "detail": f"{t.get('insider')} ({t.get('position') or 'insider'}) sold shares", "severity": "watch"})
    for e in (ext.get("earnings") or {}).get("history") or []:
        if e.get("date") and pd.Timestamp(e["date"]) >= start and (e.get("surprise_pct") or 0) < -5:
            events.append({"date": e["date"], "type": "earnings:miss",
                           "detail": f"EPS missed estimates by {abs(e['surprise_pct']):.1f}%", "severity": "review"})
    for mv in ext.get("moves") or []:
        if pd.Timestamp(mv["date"]) >= start and mv["change_pct"] <= -5:
            events.append({"date": mv["date"], "type": "price:drop", "detail": f"Fell {abs(mv['change_pct']):.1f}% in a day",
                           "severity": "watch"})
    return sorted(events, key=lambda e: e["date"], reverse=True)[:25]


def check_thesis(report: dict, assumptions: list[dict], since: str | None = None) -> dict:
    results = evaluate_assumptions(report["metrics"], assumptions)
    events = developments_since(report, since)
    broken = [r for r in results if r["status"] == "broken"]
    reviews = [e for e in events if e["severity"] == "review"]
    if broken:
        status, headline = "conflict", f"{len(broken)} assumption(s) no longer hold - review the thesis."
    elif reviews:
        status, headline = "review", f"{len(reviews)} new development(s) may challenge the thesis."
    else:
        status, headline = "intact", "All measurable assumptions still hold and no major negative developments were found."
    return {"symbol": report["symbol"], "status": status, "headline": headline, "assumptions": results,
            "developments": events, "checked_at": report.get("generated_at"),
            "method": "Assumptions are compared with InvestIQ's latest metrics; developments are keyword-classified "
                      "news, analyst downgrades, insider sales, earnings misses (>5%) and one-day falls >5% since the thesis date."}
