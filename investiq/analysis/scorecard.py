"""Turns the analysis into 0-10 scores, strengths/risks and a plain-English summary."""

from __future__ import annotations

from .util import clamp


def _lerp_score(value, bad, good):
    """Map value linearly so ``bad`` -> 0 and ``good`` -> 10 (works for either direction)."""
    if value is None:
        return None
    return round(clamp((value - bad) / (good - bad) * 10, 0, 10), 1)


def _avg(*scores):
    vals = [s for s in scores if s is not None]
    return round(sum(vals) / len(vals), 1) if vals else None


def _trailing(perf, period, key="cagr_pct"):
    for row in perf["trailing"]:
        if row["period"] == period:
            return row.get(key)
    return None


def build_scorecard(perf: dict, risk: dict, tech: dict, fund: dict, val: dict) -> dict:
    cagr5 = _trailing(perf, "5Y")
    cagr10 = _trailing(perf, "10Y")
    ret1 = _trailing(perf, "1Y", "total_return_pct")
    bench5 = _trailing(perf, "5Y", "benchmark_return_pct")
    stock5 = _trailing(perf, "5Y", "total_return_pct")

    performance = _avg(
        _lerp_score(cagr5, 0, 25),
        _lerp_score(cagr10, 0, 22),
        _lerp_score((stock5 - bench5) if stock5 is not None and bench5 is not None else None, -50, 100),
    )

    mos = val.get("margin_of_safety_pct")
    pe = fund.get("pe")
    valuation = _avg(_lerp_score(mos, -50, 30), _lerp_score(pe, 60, 12) if pe and pe > 0 else None)

    de = fund.get("debt_to_equity")
    quality = _avg(
        _lerp_score(fund.get("roe_pct"), 0, 25),
        _lerp_score(fund.get("profit_margin_pct"), 0, 20),
        _lerp_score(de, 2.0, 0.1) if de is not None else None,
        _lerp_score(fund.get("revenue_cagr_pct"), -5, 20),
    )

    rsi = tech.get("rsi")
    rsi_score = None if rsi is None else round(10 - abs(rsi - 55) / 4.5, 1)
    momentum = _avg(
        _lerp_score(tech["bullish_signals"] - tech["bearish_signals"], -4, 4),
        _lerp_score(ret1, -20, 40),
        clamp(rsi_score, 0, 10) if rsi_score is not None else None,
    )

    one_y = risk["windows"].get("1Y") or risk["windows"]["MAX"]
    safety = _avg(
        _lerp_score(one_y.get("volatility_pct"), 55, 15),
        _lerp_score(risk["windows"]["MAX"].get("max_drawdown_pct"), -80, -20),
        _lerp_score(one_y.get("sharpe"), -0.5, 1.5),
    )

    weights = {"performance": 0.25, "valuation": 0.2, "quality": 0.25, "momentum": 0.1, "safety": 0.2}
    parts = {"performance": performance, "valuation": valuation, "quality": quality,
             "momentum": momentum, "safety": safety}
    used = {k: v for k, v in parts.items() if v is not None}
    total_w = sum(weights[k] for k in used)
    overall = round(sum(v * weights[k] for k, v in used.items()) / total_w, 1) if total_w else None

    if overall is None:
        rating = "Not enough data"
    elif overall >= 7.5:
        rating = "Strong"
    elif overall >= 6:
        rating = "Good"
    elif overall >= 4.5:
        rating = "Average"
    elif overall >= 3:
        rating = "Weak"
    else:
        rating = "Poor"

    strengths, risks = [], []
    if cagr10 is not None and cagr10 >= 15:
        strengths.append(f"Compounded {cagr10:.1f}% a year over 10 years")
    if stock5 is not None and bench5 is not None:
        if stock5 > bench5 + 10:
            strengths.append(f"Beat the index by {stock5 - bench5:.0f} pts over 5 years")
        elif stock5 < bench5 - 10:
            risks.append(f"Lagged the index by {bench5 - stock5:.0f} pts over 5 years")
    if (fund.get("roe_pct") or 0) >= 18:
        strengths.append(f"High return on equity ({fund['roe_pct']:.1f}%)")
    elif fund.get("roe_pct") is not None and fund["roe_pct"] < 8:
        risks.append(f"Low return on equity ({fund['roe_pct']:.1f}%)")
    if de is not None and de > 1.5:
        risks.append(f"High debt: debt/equity {de:.2f}")
    elif de is not None and de < 0.3:
        strengths.append(f"Low debt: debt/equity {de:.2f}")
    if val.get("verdict", "").startswith("Undervalued") or val.get("verdict") == "Slightly undervalued":
        strengths.append(f"Trades below estimated fair value ({val['verdict'].lower()})")
    elif "overvalued" in val.get("verdict", "").lower():
        risks.append(f"Trades above estimated fair value ({val['verdict'].lower()})")
    if one_y.get("volatility_pct") and one_y["volatility_pct"] > 40:
        risks.append(f"Very volatile: {one_y['volatility_pct']:.0f}% annualised swings")
    cur_dd = risk.get("current_drawdown_pct")
    if cur_dd is not None and cur_dd < -25:
        risks.append(f"Still {abs(cur_dd):.0f}% below its all-time high")
    if tech["trend"] == "Uptrend":
        strengths.append("Price is in a technical uptrend")
    elif tech["trend"] == "Downtrend":
        risks.append("Price is in a technical downtrend")
    if (fund.get("revenue_cagr_pct") or 0) >= 12:
        strengths.append(f"Revenue growing {fund['revenue_cagr_pct']:.1f}% a year")
    if fund.get("profit_margin_pct") is not None and fund["profit_margin_pct"] < 0:
        risks.append("Company is currently loss-making")

    return {
        "overall": overall,
        "rating": rating,
        "scores": parts,
        "weights": weights,
        "strengths": strengths,
        "risks": risks,
    }


def build_summary(name, currency, price, perf, risk, tech, val, proj, score) -> str:
    symbol = {"INR": "₹", "USD": "$", "EUR": "€", "GBP": "£"}.get(currency, f"{currency} ")

    def money(v):
        return f"{symbol}{v:,.2f}" if v is not None else "n/a"

    ret1 = _trailing(perf, "1Y", "total_return_pct")
    cagr10 = _trailing(perf, "10Y")
    cagr5 = _trailing(perf, "5Y")
    parts = [f"{name} trades at {money(price)}."]
    if ret1 is not None:
        parts.append(f"It is {'up' if ret1 >= 0 else 'down'} {abs(ret1):.1f}% over the past year")
        if cagr10 is not None:
            parts[-1] += f" and has compounded {cagr10:.1f}% a year over 10 years."
        elif cagr5 is not None:
            parts[-1] += f" and has compounded {cagr5:.1f}% a year over 5 years."
        else:
            parts[-1] += "."
    worst = (risk.get("drawdown_episodes") or [None])[0]
    if worst:
        rec = f"recovered by {worst['recovery_date']}" if worst["recovered"] else "has not fully recovered yet"
        parts.append(f"Its deepest fall was {abs(worst['depth_pct']):.0f}% (from {worst['peak_date']} "
                     f"to {worst['trough_date']}) and it {rec}.")
    parts.append(f"Risk level: {risk['risk_level'].lower()}. Technical trend: {tech['trend'].lower()}.")
    fv = val.get("fair_value")
    if fv:
        parts.append(f"Rough fair value {money(fv['low'])} to {money(fv['high'])} (mid {money(fv['mid'])}), "
                     f"so it looks {val['verdict'].lower()}.")
    base5 = next((h for h in proj["horizons"] if h["years"] == 5), None)
    if base5:
        parts.append(f"A statistical 5-year range is {money(base5['bear']['price'])} (bear) to "
                     f"{money(base5['bull']['price'])} (bull), base {money(base5['base']['price'])}.")
    if score.get("overall") is not None:
        parts.append(f"Overall InvestIQ score: {score['overall']}/10 ({score['rating']}).")
    return " ".join(parts)
