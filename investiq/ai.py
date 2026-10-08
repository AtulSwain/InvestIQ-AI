"""AI research with source citations (Claude via the official Anthropic SDK).

How grounding works:
* InvestIQ's own data for each stock (metrics, statements, quarterly results, earnings,
  valuation, risk, price-move timeline and every news article) is sent as separate
  ``document`` blocks with citations enabled. Claude's answer comes back split into text
  blocks, each carrying citations that point at the exact document (and so at the
  provider, URL and date it came from).
* The web search server tool lets Claude find information we don't have (recent events,
  competitors, management); those claims cite the web page they came from.
* The system prompt requires every factual claim to be cited and unsupported points to be
  labelled as such. The UI shows the numbered sources under each answer.

Configuration: ``ANTHROPIC_API_KEY`` (required), ``INVESTIQ_AI_MODEL`` (default claude-opus-5-5),
``INVESTIQ_AI_WEB_SEARCH`` (default on).
"""

from __future__ import annotations

import hashlib
import json
import logging
import os

from .data.cache import get_cache
from .data.provenance import now_iso

log = logging.getLogger("investiq.ai")

DEFAULT_MODEL = "claude-opus-5-5"
AI_CACHE_TTL = 6 * 3600

SYSTEM = """You are InvestIQ's equity research analyst. Answer investors' questions about listed companies.

Evidence rules (strict):
- Base every factual statement on the provided documents or on web search results, and cite it.
- Numbers must come from the documents or cited web pages. Never invent figures, dates, estimates or quotes.
- If the available sources do not answer something, say "Not found in the available data" for that point.
- Mention the period or date of the data you cite (e.g. "FY2025", "as of 7 Oct 2026").
- Distinguish reported figures from estimates and from InvestIQ's model outputs (fair value, scores, scenarios).
- When news coincides with a price move, call it a possible link, not a proven cause.

Style:
- Be concise and structured: short markdown headings (##) and bullet points, no filler or preamble.
- Lead with the direct answer, then the evidence, then risks/uncertainties.
- This is research, not personal financial advice: do not tell the user to buy or sell; you may say what the evidence suggests."""

SUMMARY_PROMPT = """Write an investment research summary for {name} ({symbol}) with these sections:
## Executive summary
## Business overview
## Growth drivers
## Competitive advantages
## Bull case
## Bear case
## Key risks
## Catalysts to watch
## Key questions for further research
Use the provided InvestIQ data first; use web search for recent developments, competition and management. Keep each section to 2-5 bullets."""


class AIUnavailable(Exception):
    pass


def configured() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


_client = None


def get_client():
    global _client
    if _client is None:
        if not configured():
            raise AIUnavailable("AI research needs ANTHROPIC_API_KEY on the server.")
        import anthropic

        _client = anthropic.Anthropic(max_retries=2, timeout=180.0)
    return _client


def set_client(c) -> None:
    """Tests inject a fake client."""
    global _client
    _client = c


# ---------------------------------------------------------------- documents from InvestIQ data

def _fmt(v, unit=None):
    if v is None:
        return "n/a"
    if isinstance(v, bool):
        return "yes" if v else "no"
    if isinstance(v, (int, float)):
        if unit == "pct":
            return f"{v:.2f}%"
        if abs(v) >= 1e7:
            return f"{v:,.0f}"
        return f"{v:,.2f}"
    return str(v)


def documents_for(report: dict) -> list[tuple[dict, dict]]:
    """[(document block, metadata)] for one stock report. Metadata feeds the citation list."""
    sym, name, cur = report["symbol"], report["name"], report["currency"]
    src = {s["id"]: s for s in report.get("sources", [])}
    docs = []

    def add(title, text, provider_label, as_of=None, url=None, kind="investiq"):
        block = {"type": "document", "source": {"type": "text", "media_type": "text/plain", "data": text},
                 "title": title[:500], "citations": {"enabled": True}}
        meta = {"title": title, "provider": provider_label, "as_of": as_of, "url": url, "kind": kind, "symbol": sym}
        if url or as_of:
            block["context"] = " | ".join(x for x in (provider_label, as_of, url) if x)
        docs.append((block, meta))

    lines = [f"{name} ({sym}). Currency {cur}. Sector: {report['fundamentals'].get('sector') or 'n/a'}. "
             f"Price as of {report['quote'].get('timestamp') or report['as_of']}."]
    for key, m in report.get("metrics", {}).items():
        s = src.get(m["source"], {})
        lines.append(f"{m['label']}: {_fmt(m['value'], m['unit'])} ({m['period']}; {m['status']}; "
                     f"source {s.get('provider_label', m['source'])})")
    add(f"{sym} key metrics", "\n".join(lines), "InvestIQ metric registry", report.get("generated_at"))

    desc = report["fundamentals"].get("description")
    if desc:
        add(f"{sym} company description", desc, src.get("company_profile", {}).get("provider_label", "company profile"))

    years = report["financials"].get("years") or []
    if years:
        rows = [f"FY ending {y['fiscal_year_end']}: revenue {_fmt(y['revenue'])}, net income {_fmt(y['net_income'])}, "
                f"operating margin {_fmt(y['operating_margin_pct'], 'pct')}, net margin {_fmt(y['net_margin_pct'], 'pct')}, "
                f"ROE {_fmt(y['roe_pct'], 'pct')}, ROCE {_fmt(y['roce_pct'], 'pct')}, debt/equity {_fmt(y['debt_to_equity'])}, "
                f"free cash flow {_fmt(y['free_cash_flow'])}" for y in years]
        st = src.get("financial_statements", {})
        add(f"{sym} annual financial statements ({cur})", "\n".join(rows), st.get("provider_label", "statements"), st.get("as_of"))

    ext = report.get("extended") or {}
    q = ext.get("quarterly") or []
    if q:
        rows = [f"Quarter ending {r['period_end']}: revenue {_fmt(r['revenue'])}, net income {_fmt(r['net_income'])}, "
                f"EPS {_fmt(r['eps'])}, net margin {_fmt(r['net_margin_pct'], 'pct')}, revenue YoY "
                f"{_fmt(r.get('revenue_yoy_pct'), 'pct')}" for r in q]
        add(f"{sym} quarterly results ({cur})", "\n".join(rows), "Yahoo Finance", q[-1]["period_end"])
    e = ext.get("earnings") or {}
    if e.get("history") or e.get("upcoming"):
        rows = [f"Reported {h['date']}: EPS {_fmt(h['eps_actual'])} vs estimate {_fmt(h['eps_estimate'])} "
                f"(surprise {_fmt(h['surprise_pct'], 'pct')})" for h in e.get("history", [])]
        rows += [f"Next earnings date {u['date']} (EPS estimate {_fmt(u.get('eps_estimate'))})" for u in e.get("upcoming", [])]
        add(f"{sym} earnings history and calendar", "\n".join(rows), "Yahoo Finance (estimates are analyst consensus)")

    v = report["valuation"]
    rows = [f"{m['method']}: {_fmt(m['value'])} {cur} ({_fmt(m['upside_pct'], 'pct')} vs price) - {m['note']}" for m in v["methods"]]
    if v.get("fair_value"):
        rows.append(f"Blended fair value range {v['fair_value']['low']} - {v['fair_value']['high']} (mid {v['fair_value']['mid']}); "
                    f"verdict: {v['verdict']}")
    rd = v.get("reverse_dcf") or {}
    if rd.get("implied_growth_pct") is not None:
        rows.append(f"Reverse DCF: price implies {rd['implied_growth_pct']}% FCF growth vs {rd['assumed_growth_pct']}% delivered.")
    add(f"{sym} InvestIQ valuation models (estimates)", "\n".join(rows), "InvestIQ model output", report.get("generated_at"))

    rp = report.get("risk_profile") or {}
    rows = [f"{d['dimension']}: {d['level']}" + (f" ({d['score']}/10)" if d["score"] is not None else "") +
            (" - " + "; ".join(d["evidence"]) if d["evidence"] else "") for d in rp.get("dimensions", [])]
    add(f"{sym} InvestIQ risk profile", "\n".join(rows), "InvestIQ model output", report.get("generated_at"))

    t = {r["period"]: r for r in report["performance"]["trailing"]}
    perf = [f"{p}: {t[p]['total_return_pct']}% (index {t[p].get('benchmark_return_pct')}%)" for p in ("1M", "6M", "1Y", "5Y", "10Y") if p in t]
    moves = [f"{mv['date']}: {mv['change_pct']:+.1f}% - headlines that day: " +
             ("; ".join(h["title"] for h in mv["headlines"]) or "none found") for mv in ext.get("moves") or []]
    add(f"{sym} price performance and large moves", "\n".join(perf + moves), "InvestIQ (from daily closes)", report["as_of"])

    for n in (ext.get("news") or [])[:15]:
        add(n["title"], (n.get("summary") or n["title"]), n.get("publisher") or n.get("provider", "news"),
            (n.get("published_at") or "")[:10] or None, n.get("url"), kind="news")
    return docs


# ---------------------------------------------------------------- calling Claude

def _get(obj, name, default=None):
    return obj.get(name, default) if isinstance(obj, dict) else getattr(obj, name, default)


def parse_response(content, metas: list[dict]) -> tuple[list[dict], list[dict]]:
    """Turn response content blocks into [{text, cites:[n]}] plus a numbered source list."""
    sources, index = [], {}

    def number(key, meta):
        if key not in index:
            index[key] = len(sources) + 1
            sources.append({"n": index[key], **meta})
        return index[key]

    blocks = []
    for block in content:
        if _get(block, "type") != "text":
            continue
        cites = []
        for c in _get(block, "citations") or []:
            ctype = _get(c, "type")
            if ctype == "web_search_result_location":
                url = _get(c, "url")
                n = number(f"web:{url}", {"title": _get(c, "title") or url, "provider": "Web search", "url": url,
                                          "as_of": None, "kind": "web", "symbol": None})
            else:
                di = _get(c, "document_index")
                if di is None or di >= len(metas):
                    continue
                n = number(f"doc:{di}", metas[di])
            sources[n - 1].setdefault("quotes", [])
            quote = (_get(c, "cited_text") or "").strip()
            if quote and quote not in sources[n - 1]["quotes"] and len(sources[n - 1]["quotes"]) < 3:
                sources[n - 1]["quotes"].append(quote[:300])
            if n not in cites:
                cites.append(n)
        text = _get(block, "text") or ""
        if blocks and not cites and not _get(block, "citations"):
            blocks[-1]["text"] += text  # merge uncited fragments into the previous block
        else:
            blocks.append({"text": text, "cites": cites})
    return blocks, sources


def run(question: str, reports: list[dict], web_search: bool | None = None, effort: str = "medium") -> dict:
    if web_search is None:
        web_search = os.environ.get("INVESTIQ_AI_WEB_SEARCH", "1") != "0"
    docs = [d for r in reports for d in documents_for(r)]
    blocks = [d[0] for d in docs]
    metas = [d[1] for d in docs]
    if blocks:
        blocks[-1] = {**blocks[-1], "cache_control": {"type": "ephemeral"}}  # same stock -> cached documents
    messages = [{"role": "user", "content": blocks + [{"type": "text", "text": question}]}]
    tools = [{"type": "web_search_20260209", "name": "web_search", "max_uses": 4}] if web_search else []
    model = os.environ.get("INVESTIQ_AI_MODEL", DEFAULT_MODEL)
    client = get_client()

    content, resp = [], None
    for _ in range(4):  # resume server-tool turns that pause (pause_turn)
        kwargs = dict(model=model, max_tokens=16000, system=SYSTEM, messages=messages,
                      output_config={"effort": effort},
                      betas=["server-side-fallback-2026-07-01"], fallbacks="default")
        if tools:
            kwargs["tools"] = tools
        resp = client.beta.messages.create(**kwargs)
        content += list(_get(resp, "content") or [])
        if _get(resp, "stop_reason") != "pause_turn":
            break
        messages = messages + [{"role": "assistant", "content": _get(resp, "content")}]

    if _get(resp, "stop_reason") == "refusal":
        return {"blocks": [{"text": "The AI model declined to answer this question.", "cites": []}], "sources": [],
                "model": _get(resp, "model"), "generated_at": now_iso(), "refused": True}
    answer, sources = parse_response(content, metas)
    usage = _get(resp, "usage")
    return {"blocks": answer, "sources": sources, "model": _get(resp, "model") or model, "generated_at": now_iso(),
            "truncated": _get(resp, "stop_reason") == "max_tokens",
            "usage": {"input_tokens": _get(usage, "input_tokens"), "output_tokens": _get(usage, "output_tokens")} if usage else None,
            "web_search": bool(tools), "symbols": [r["symbol"] for r in reports]}


def cached_run(question: str, reports: list[dict], **kwargs) -> dict:
    key_src = json.dumps({"q": question.strip().lower(), "s": sorted(r["symbol"] for r in reports),
                          "d": [r["as_of"] for r in reports], "k": kwargs}, sort_keys=True)
    key = "ai:" + hashlib.sha256(key_src.encode()).hexdigest()
    cache = get_cache()
    hit = cache.get(key)
    if hit is not None:
        return {**hit, "cached": True}
    out = run(question, reports, **kwargs)
    if not out.get("refused"):
        cache.set(key, out, AI_CACHE_TTL)
    return out


def summary(report: dict) -> dict:
    return cached_run(SUMMARY_PROMPT.format(name=report["name"], symbol=report["symbol"]), [report], effort="high")
