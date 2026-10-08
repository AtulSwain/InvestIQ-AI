"""Transparent multi-dimension risk scoring.

Each dimension gets a 0-10 risk score (higher = riskier), a label, and the evidence
behind it. Dimensions that free data cannot measure (competitive, geopolitical,
management quality) are marked "not assessed" instead of being guessed.
"""

from __future__ import annotations

from .util import clamp


def _level(score):
    if score is None:
        return "Not assessed"
    if score < 3:
        return "Low"
    if score < 5.5:
        return "Moderate"
    if score < 7.5:
        return "Elevated"
    return "High"


def _scale(value, safe, risky):
    """Map value linearly: safe -> 0, risky -> 10 (either direction)."""
    if value is None:
        return None
    return round(clamp((value - safe) / (risky - safe) * 10, 0, 10), 1)


def _avg(parts):
    vals = [p for p in parts if p is not None]
    return round(sum(vals) / len(vals), 1) if vals else None


def risk_profile(report: dict, extended: dict | None = None) -> dict:
    m = {k: v["value"] for k, v in report["metrics"].items()}
    fin = report["financials"]
    financial_sector = fin.get("is_financial_sector")
    dims = []

    def dim(name, parts, evidence, note=None):
        score = _avg(parts)
        dims.append({"dimension": name, "score": score, "level": _level(score),
                     "evidence": [e for e in evidence if e], "note": note})

    # Financial: leverage, liquidity, coverage, bankruptcy model
    de, cr, ic, z = m.get("debt_to_equity"), m.get("current_ratio"), m.get("interest_coverage"), m.get("altman_z")
    dim("Financial", [None if financial_sector else _scale(de, 0.3, 2.5), _scale(cr, 2.0, 0.8),
                      _scale(ic, 10, 1.5), _scale(z, 3.5, 1.5)],
        [f"Debt/equity {de:.2f}" if de is not None and not financial_sector else None,
         f"Current ratio {cr:.2f}" if cr is not None else None,
         f"Interest coverage {ic:.1f}x" if ic is not None else None,
         f"Altman Z {z}" if z is not None else None],
        "Leverage ratios are not meaningful for banks and insurers." if financial_sector else None)

    # Valuation: how much optimism is priced in
    mos, pe, implied = m.get("margin_of_safety_pct"), m.get("pe"), m.get("implied_growth_pct")
    delivered = (report["valuation"].get("reverse_dcf") or {}).get("assumed_growth_pct")
    dim("Valuation", [_scale(mos, 25, -50), _scale(pe, 12, 60) if pe and pe > 0 else None,
                      _scale((implied or 0) - (delivered or 0), -5, 15) if implied is not None and delivered is not None else None],
        [f"Price vs fair value: {mos:+.0f}%" if mos is not None else None,
         f"P/E {pe:.1f}" if pe else None,
         f"Growth priced in {implied:.1f}% vs {delivered:.1f}% delivered" if implied is not None and delivered is not None else None])

    # Market / price risk
    vol, dd, beta = m.get("volatility_pct"), m.get("max_drawdown_pct"), m.get("beta")
    dim("Market & volatility", [_scale(vol, 15, 55), _scale(dd, -20, -80), _scale(beta, 0.6, 1.8)],
        [f"Volatility {vol:.0f}%/yr" if vol is not None else None,
         f"Worst fall {dd:.0f}%" if dd is not None else None, f"Beta {beta:.2f}" if beta is not None else None])

    # Earnings quality / business stability
    years = fin.get("years") or []
    margins = [y["net_margin_pct"] for y in years if y.get("net_margin_pct") is not None]
    margin_swing = (max(margins) - min(margins)) if len(margins) >= 3 else None
    conv = years[-1].get("cash_conversion") if years else None
    pio = m.get("piotroski")
    dim("Business & earnings quality", [_scale(margin_swing, 2, 15), _scale(conv, 1.2, 0.4),
                                        _scale(pio, 8, 2) if pio is not None else None,
                                        _scale(m.get("revenue_cagr_pct"), 15, -5)],
        [f"Net margin moved {margin_swing:.1f} pts across {len(margins)} years" if margin_swing is not None else None,
         f"Cash conversion {conv:.2f}x" if conv is not None else None,
         f"Piotroski {pio}/9" if pio is not None else None,
         f"Revenue CAGR {m['revenue_cagr_pct']:.1f}%" if m.get("revenue_cagr_pct") is not None else None])

    # Liquidity: average traded value over 20 days (currency units)
    vols = report["chart"]["volume"][-20:]
    closes = report["chart"]["close"][-20:]
    traded = [v * c for v, c in zip(vols, closes) if v and c]
    adv = sum(traded) / len(traded) if traded else None
    big = 1e9 if report["currency"] == "INR" else 5e7   # ₹100 Cr / $50M per day = very liquid
    small = 5e7 if report["currency"] == "INR" else 1e6
    dim("Liquidity", [_scale(adv, big, small) if adv else None],
        [f"Average daily traded value {adv:,.0f} {report['currency']}" if adv else None])

    # Insider / regulatory signals from news and filings
    ext = extended or {}
    news = ext.get("news") or []
    reg = [n for n in news if n.get("category") in ("regulatory", "lawsuit")]
    insiders = (ext.get("ownership") or {}).get("insider_transactions") or []
    def _txt(t, *keys):  # provider fields can be missing, NaN or non-strings
        return " ".join(str(t.get(k)) for k in keys if isinstance(t.get(k), str)).lower()
    sells = sum(1 for t in insiders if "sale" in _txt(t, "transaction", "text"))
    buys = sum(1 for t in insiders if "buy" in _txt(t, "transaction", "text") or "purchase" in _txt(t, "text"))
    dim("Regulatory & legal (news)", [_scale(len(reg), 0, 5) if news else None],
        [f"{len(reg)} regulatory/legal headline(s) in the latest {len(news)} news items" if news else None] +
        [f"“{n['title']}”" for n in reg[:2]])
    dim("Insider activity", [_scale(sells - buys, -2, 6) if insiders else None],
        [f"{buys} insider buy(s) vs {sells} sale(s) in recent filings" if insiders else None])

    for name in ("Competitive", "Geopolitical", "Management quality"):
        dims.append({"dimension": name, "score": None, "level": "Not assessed", "evidence": [],
                     "note": "Needs qualitative research - ask the AI Research assistant, which cites its sources."})

    scored = [d["score"] for d in dims if d["score"] is not None]
    overall = round(sum(scored) / len(scored), 1) if scored else None
    return {"overall": overall, "level": _level(overall), "dimensions": dims,
            "method": "Each measurable dimension averages its indicators mapped onto 0 (low risk) - 10 (high risk). "
                      "Thresholds are fixed rules in investiq/analysis/risk_profile.py."}
