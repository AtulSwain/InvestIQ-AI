"""Buying aids: a pass/fail checklist and a rule-based trade plan.

Everything here is derived from the other analysis modules and is meant to
structure your own decision, not to make it for you.
"""

from __future__ import annotations

from .util import num, pct


def _item(category, label, passed, detail):
    return {"category": category, "check": label, "passed": passed, "detail": detail}


def _fmt(v, suffix="", digits=1):
    return "n/a" if v is None else f"{v:.{digits}f}{suffix}"


def buy_checklist(fund, fin, val, tech, perf_trailing, risk) -> dict:
    t = {r["period"]: r for r in perf_trailing}
    latest = (fin.get("years") or [{}])[-1] if fin.get("years") else {}
    financial = fin.get("is_financial_sector")
    items = []

    # --- Business quality
    margin = fund.get("profit_margin_pct") if fund.get("profit_margin_pct") is not None else latest.get("net_margin_pct")
    items.append(_item("Business", "Profitable", None if margin is None else margin > 0,
                       f"Net profit margin {_fmt(margin, '%')}"))
    roe = fund.get("roe_pct")
    items.append(_item("Business", "High return on equity (15%+)", None if roe is None else roe >= 15,
                       f"ROE {_fmt(roe, '%')} - how much profit each rupee of shareholder money earns"))
    rev_cagr = fund.get("revenue_cagr_pct")
    items.append(_item("Business", "Sales growing (8%+ a year)", None if rev_cagr is None else rev_cagr >= 8,
                       f"Revenue CAGR {_fmt(rev_cagr, '%')}"))
    prof_cagr = fund.get("profit_cagr_pct")
    items.append(_item("Business", "Profits growing (8%+ a year)", None if prof_cagr is None else prof_cagr >= 8,
                       f"Net profit CAGR {_fmt(prof_cagr, '%')}"))
    fcf = fund.get("free_cash_flow")
    items.append(_item("Business", "Generates free cash", None if fcf is None or financial else fcf > 0,
                       "Free cash flow is positive" if fcf and fcf > 0 else "Free cash flow is negative or unavailable"))

    # --- Financial strength
    de = fund.get("debt_to_equity")
    items.append(_item("Strength", "Manageable debt (D/E below 1)", None if de is None or financial else de < 1,
                       f"Debt/equity {_fmt(de, '', 2)}" + (" (not meaningful for lenders)" if financial else "")))
    pio = fin.get("piotroski")
    items.append(_item("Strength", "Piotroski F-Score 6+", None if not pio else pio["scaled_9"] >= 6,
                       f"F-Score {pio['score']}/{pio['out_of']}" if pio else "Not enough statement data"))
    alt = fin.get("altman")
    z = alt.get("z") if alt else None
    items.append(_item("Strength", "Low bankruptcy risk (Altman Z)", None if z is None else z > 1.81,
                       f"Z-Score {z} ({alt['zone']})" if z is not None else "Not available"))

    # --- Valuation
    mos = val.get("margin_of_safety_pct")
    items.append(_item("Valuation", "Below estimated fair value", None if mos is None else mos > 0,
                       f"Fair value mid is {_fmt(mos, '%')} vs price"))
    pe, avg_pe = fund.get("pe"), val.get("average_pe")
    items.append(_item("Valuation", "P/E below its own history", None if not pe or not avg_pe else pe <= avg_pe,
                       f"P/E {_fmt(pe)} vs {_fmt(avg_pe)} historical average"))
    rd = val.get("reverse_dcf") or {}
    implied, assumed = rd.get("implied_growth_pct"), rd.get("assumed_growth_pct")
    items.append(_item("Valuation", "Price doesn't assume heroic growth",
                       None if implied is None or assumed is None else implied <= assumed + 3,
                       f"Price implies {_fmt(implied, '%')} growth vs {_fmt(assumed, '%')} delivered"))

    # --- Price & momentum
    price_above = None
    if tech.get("sma200"):
        price_above = next((s["stance"] == "bullish" for s in tech["signals"] if s["indicator"] == "SMA 200"), None)
    items.append(_item("Price", "Above 200-day average (long-term uptrend)", price_above,
                       f"200-day average {_fmt(tech.get('sma200'), '', 2)}"))
    rsi = tech.get("rsi")
    items.append(_item("Price", "Not overbought (RSI below 70)", None if rsi is None else rsi < 70,
                       f"RSI {_fmt(rsi)}"))
    s5, b5 = t.get("5Y", {}).get("total_return_pct"), t.get("5Y", {}).get("benchmark_return_pct")
    items.append(_item("Price", "Beat the index over 5 years", None if s5 is None or b5 is None else s5 > b5,
                       f"{_fmt(s5, '%')} vs index {_fmt(b5, '%')}"))
    six = t.get("6M", {}).get("total_return_pct")
    items.append(_item("Price", "Not a falling knife (6M > -20%)", None if six is None else six > -20,
                       f"6-month return {_fmt(six, '%')}"))

    evaluated = [i for i in items if i["passed"] is not None]
    passed = sum(i["passed"] for i in evaluated)
    ratio = passed / len(evaluated) if evaluated else 0
    if ratio >= 0.75:
        verdict, tone = "Looks attractive - most checks pass", "good"
    elif ratio >= 0.5:
        verdict, tone = "Mixed - research the failing checks before buying", "mixed"
    else:
        verdict, tone = "Caution - most checks fail", "bad"
    return {"items": items, "passed": passed, "evaluated": len(evaluated),
            "score_pct": pct(ratio, 0), "verdict": verdict, "tone": tone}


def trade_plan(price, tech, val, fund, proj) -> dict:
    """Entry zone, stop-loss and targets from support levels, ATR and fair value."""
    atr = tech.get("atr") or price * 0.02
    levels = tech.get("levels", {})
    support = levels.get("support_3m") or price - 2 * atr
    fv = val.get("fair_value") or {}
    fair_mid = fv.get("mid")

    # Entry: at or below the current price, no higher than fair value, anchored on support.
    entry_high = min(price, fair_mid) if fair_mid else price
    waiting = entry_high < price * 0.98
    anchor = support if support < entry_high else entry_high - 2 * atr
    entry_low = max(anchor, entry_high - 2 * atr)
    if entry_low >= entry_high:
        entry_low = entry_high - atr

    # Just under support or 1.5 ATR below the entry zone, whichever is lower,
    # but never risking more than 15% from the top of the entry zone.
    stop = min(anchor * 0.98, entry_low - 1.5 * atr)
    stop = max(stop, entry_high * 0.85)

    # Fair value far below the price: a mechanical plan would be meaningless.
    far_above = entry_high < price * 0.75
    ref = entry_high  # targets and risk are measured from the planned entry
    candidates = []
    if fair_mid and fair_mid > ref * 1.01:
        candidates.append(("Fair value (mid)", fair_mid))
    if levels.get("resistance_6m") and levels["resistance_6m"] > ref * 1.02:
        candidates.append(("6-month high", levels["resistance_6m"]))
    analyst = (fund.get("analyst") or {}).get("target_mean")
    if analyst and analyst > ref:
        candidates.append(("Analyst target", analyst))
    base1 = next((h["base"]["price"] for h in proj["horizons"] if h["years"] == 1), None)
    if base1 and base1 > ref:
        candidates.append(("1-year base case", base1))
    if fv.get("high") and fv["high"] > ref:
        candidates.append(("Fair value (high)", fv["high"]))
    candidates.sort(key=lambda c: c[1])
    unique = []
    for label, value in candidates:  # drop targets within 1% of the previous one
        if not unique or value > unique[-1][1] * 1.01:
            unique.append((label, value))
    targets = [] if far_above else [
        {"label": l, "price": num(v, 2), "upside_pct": pct(v / ref - 1)} for l, v in unique[:3]]

    risk_per_share = ref - stop
    first = targets[0]["price"] if targets else None
    rr = (first - ref) / risk_per_share if first and risk_per_share > 0 else None
    return {
        "price": num(price, 2),
        "entry_low": num(entry_low, 2),
        "entry_high": num(entry_high, 2),
        "wait_for_pullback": waiting,
        "far_above_fair_value": far_above,
        "stop_loss": num(stop, 2),
        "stop_loss_pct": pct(stop / ref - 1),
        "targets": targets,
        "risk_reward": num(rr, 2),
        "atr": num(atr, 2),
        "note": "Entry is capped at fair value and anchored on recent support; the stop sits just under "
                "3-month support or 1.5x the average daily range (ATR) below entry, capped at a 15% loss. Percentages are measured from the top of the entry zone. Levels are mechanical guides.",
    }
