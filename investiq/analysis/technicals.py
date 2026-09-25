"""Technical indicators and a plain-language trend read-out."""

from __future__ import annotations

import pandas as pd

from .util import date_str, num, pct


def sma(close: pd.Series, n: int) -> pd.Series:
    return close.rolling(n).mean()


def ema(close: pd.Series, n: int) -> pd.Series:
    return close.ewm(span=n, adjust=False).mean()


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    rs = gain / loss
    out = 100 - 100 / (1 + rs)
    return out.where(loss != 0, 100.0)


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9):
    line = ema(close, fast) - ema(close, slow)
    sig = ema(line, signal)
    return line, sig, line - sig


def _last_cross(fast: pd.Series, slow: pd.Series):
    diff = (fast - slow).dropna()
    if len(diff) < 2:
        return None, None
    sign = diff > 0
    changes = sign.ne(sign.shift()).iloc[1:]
    changes = changes[changes]
    if changes.empty:
        return None, None
    d = changes.index[-1]
    return ("golden_cross" if sign[d] else "death_cross"), d


def analyze_technicals(hist: pd.DataFrame) -> dict:
    close = hist["Close"]
    price = close.iloc[-1]
    s20, s50, s200 = sma(close, 20), sma(close, 50), sma(close, 200)
    r = rsi(close)
    m_line, m_sig, m_hist = macd(close)
    bb_mid = s20
    bb_std = close.rolling(20).std()

    signals = []

    def add(name, value, stance, note):
        signals.append({"indicator": name, "value": value, "stance": stance, "note": note})

    for label, series in (("SMA 50", s50), ("SMA 200", s200)):
        v = series.iloc[-1]
        if pd.notna(v):
            above = price > v
            add(label, num(v, 2), "bullish" if above else "bearish",
                f"Price is {'above' if above else 'below'} the {label} ({pct(price / v - 1)}%)")

    cross, cross_date = _last_cross(s50, s200)
    if cross:
        add("50/200 cross", date_str(cross_date), "bullish" if cross == "golden_cross" else "bearish",
            f"Last {'golden' if cross == 'golden_cross' else 'death'} cross on {date_str(cross_date)}")

    rv = r.iloc[-1]
    if pd.notna(rv):
        if rv >= 70:
            add("RSI (14)", num(rv, 1), "bearish", "Overbought - rally may be stretched")
        elif rv <= 30:
            add("RSI (14)", num(rv, 1), "bullish", "Oversold - selling may be overdone")
        else:
            add("RSI (14)", num(rv, 1), "neutral", "Neutral momentum")

    if pd.notna(m_hist.iloc[-1]):
        up = m_hist.iloc[-1] > 0
        add("MACD", num(m_line.iloc[-1], 2), "bullish" if up else "bearish",
            f"MACD is {'above' if up else 'below'} its signal line")

    upper = bb_mid.iloc[-1] + 2 * bb_std.iloc[-1]
    lower = bb_mid.iloc[-1] - 2 * bb_std.iloc[-1]
    if pd.notna(upper):
        if price > upper:
            add("Bollinger", num(upper, 2), "bearish", "Trading above the upper band")
        elif price < lower:
            add("Bollinger", num(lower, 2), "bullish", "Trading below the lower band")
        else:
            add("Bollinger", num(bb_mid.iloc[-1], 2), "neutral", "Inside the bands")

    bull = sum(s["stance"] == "bullish" for s in signals)
    bear = sum(s["stance"] == "bearish" for s in signals)
    if bull - bear >= 2:
        trend = "Uptrend"
    elif bear - bull >= 2:
        trend = "Downtrend"
    else:
        trend = "Sideways / mixed"

    recent = hist.iloc[-126:]  # ~6 months
    last = hist.iloc[-1]
    pivot = (last["High"] + last["Low"] + last["Close"]) / 3
    levels = {
        "support_3m": num(hist["Low"].iloc[-63:].min(), 2),
        "resistance_3m": num(hist["High"].iloc[-63:].max(), 2),
        "support_6m": num(recent["Low"].min(), 2),
        "resistance_6m": num(recent["High"].max(), 2),
        "pivot": num(pivot, 2),
        "r1": num(2 * pivot - last["Low"], 2),
        "s1": num(2 * pivot - last["High"], 2),
    }

    avg_vol_20 = hist["Volume"].iloc[-20:].mean()
    avg_vol_90 = hist["Volume"].iloc[-90:].mean()

    return {
        "trend": trend,
        "bullish_signals": bull,
        "bearish_signals": bear,
        "signals": signals,
        "levels": levels,
        "rsi": num(rv, 1),
        "volume_trend_pct": pct(avg_vol_20 / avg_vol_90 - 1) if avg_vol_90 else None,
        "series": {"sma50": s50, "sma200": s200},
    }
