"""Portfolio intelligence: P&L, allocation, concentration, dividends, beta, correlation, volatility.

Holdings are supplied by the client (the browser keeps them; there are no user accounts).
Mixed-currency portfolios are converted to the base currency with the latest USD/INR close.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd

from ..data.provider import DataProvider, DataUnavailableError
from ..data.symbols import benchmark_for, currency_for, market_for, resolve_candidates, sector_for
from .util import TRADING_DAYS, num, pct


def _load(provider: DataProvider, query: str):
    for sym in resolve_candidates(query):
        try:
            data = provider.get_stock(sym, with_fundamentals=True)
            if len(data.history) > 2:
                return data
        except DataUnavailableError:
            continue
    return None


def analyze_portfolio(provider: DataProvider, holdings: list[dict], base: str = "INR") -> dict:
    holdings = [h for h in holdings if h.get("symbol") and (h.get("quantity") or 0) > 0][:50]
    if not holdings:
        return {"holdings": [], "totals": None, "errors": ["Add at least one holding."]}

    with ThreadPoolExecutor(max_workers=6) as pool:
        loaded = list(pool.map(lambda h: _load(provider, h["symbol"]), holdings))

    fx = {"INR": 1.0, "USD": 1.0}
    try:
        usdinr = float(provider.get_history("INR=X")["Close"].iloc[-1])
        fx = {"INR": 1.0, "USD": usdinr} if base == "INR" else {"INR": 1 / usdinr, "USD": 1.0}
    except Exception:
        usdinr = None

    rows, errors, series = [], [], {}
    for h, data in zip(holdings, loaded):
        if data is None:
            errors.append(f"No data for {h['symbol']}")
            continue
        close = data.history["Close"]
        cur = (data.info or {}).get("currency") or currency_for(data.symbol)
        rate = fx.get(cur, 1.0)
        qty, cost = float(h["quantity"]), float(h.get("avg_cost") or 0)
        price, prev = float(close.iloc[-1]), float(close.iloc[-2])
        divs = data.dividends.loc[close.index[-1] - pd.DateOffset(years=1):].sum() if len(data.dividends) else 0.0
        value = qty * price * rate
        rows.append({
            "symbol": data.symbol, "name": (data.info or {}).get("longName") or data.symbol, "currency": cur,
            "sector": (data.info or {}).get("sector") or sector_for(data.symbol) or "Other",
            "country": "India" if market_for(data.symbol) == "IN" else "United States",
            "quantity": qty, "avg_cost": cost, "price": num(price, 2),
            "value": num(value, 2), "cost": num(qty * cost * rate, 2) if cost else None,
            "pnl": num(value - qty * cost * rate, 2) if cost else None,
            "pnl_pct": pct(price / cost - 1) if cost else None,
            "day_change": num(qty * (price - prev) * rate, 2), "day_change_pct": pct(price / prev - 1),
            "dividend_income": num(qty * divs * rate, 2), "pe": num((data.info or {}).get("trailingPE"), 2),
        })
        series[data.symbol] = close

    total = sum(r["value"] for r in rows)
    if not total:
        return {"holdings": rows, "totals": None, "errors": errors}
    for r in rows:
        r["weight_pct"] = pct(r["value"] / total)
    cost_total = sum(r["cost"] for r in rows if r["cost"])
    pnl_total = sum(r["pnl"] for r in rows if r["pnl"] is not None)

    def alloc(key):
        out = {}
        for r in rows:
            out[r[key]] = out.get(r[key], 0) + r["value"]
        return sorted([{"name": k, "value": num(v, 2), "weight_pct": pct(v / total)} for k, v in out.items()],
                      key=lambda x: -x["value"])

    weights = np.array([r["value"] / total for r in rows])
    hhi = float((weights ** 2).sum())

    # Risk from the last year of daily returns (dates aligned across markets).
    rets = pd.DataFrame({s: c.loc[c.index[-1] - pd.DateOffset(years=1):].pct_change() for s, c in series.items()}).dropna(how="all")
    rets = rets.fillna(0.0)
    syms = [r["symbol"] for r in rows]
    port = (rets[syms] * weights).sum(axis=1) if len(rets) > 20 else None
    corr = rets[syms].corr().round(2) if len(rets) > 20 and len(syms) > 1 else None
    beta = None
    if port is not None:
        bench_sym = benchmark_for(syms[int(np.argmax(weights))])
        try:
            b = provider.get_history(bench_sym)["Close"].pct_change()
            joined = pd.concat([port, b], axis=1, join="inner").dropna()
            if len(joined) > 20 and joined.iloc[:, 1].var() > 0:
                beta = num(joined.cov().iloc[0, 1] / joined.iloc[:, 1].var(), 2)
        except Exception:
            pass
    vol = pct(port.std() * np.sqrt(TRADING_DAYS)) if port is not None else None
    dd = None
    if port is not None:
        growth = (1 + port).cumprod()
        dd = pct((growth / growth.cummax() - 1).min())
    weighted_pe_parts = [(r["weight_pct"], r["pe"]) for r in rows if r["pe"] and r["pe"] > 0]
    wpe = (sum(w for w, _ in weighted_pe_parts) / sum(w / pe for w, pe in weighted_pe_parts)
           if weighted_pe_parts else None)  # harmonic mean = P/E of the combined holding

    top = max(rows, key=lambda r: r["value"])
    flags = []
    if top["weight_pct"] > 25:
        flags.append(f"{top['symbol']} is {top['weight_pct']:.0f}% of the portfolio - high single-stock concentration.")
    sectors = alloc("sector")
    if sectors and sectors[0]["weight_pct"] > 40:
        flags.append(f"{sectors[0]['name']} is {sectors[0]['weight_pct']:.0f}% of the portfolio - high sector concentration.")
    if corr is not None:
        high = [(a, b, corr.loc[a, b]) for i, a in enumerate(syms) for b in syms[i + 1:] if corr.loc[a, b] > 0.8]
        if high:
            flags.append(f"{len(high)} pair(s) move very closely together (correlation > 0.8) - less diversification than it looks.")

    return {
        "base_currency": base, "usd_inr": num(usdinr, 4),
        "holdings": sorted(rows, key=lambda r: -r["value"]),
        "totals": {"value": num(total, 2), "cost": num(cost_total, 2) if cost_total else None,
                   "pnl": num(pnl_total, 2) if cost_total else None,
                   "pnl_pct": pct(pnl_total / cost_total) if cost_total else None,
                   "day_change": num(sum(r["day_change"] for r in rows), 2),
                   "dividend_income": num(sum(r["dividend_income"] for r in rows), 2),
                   "dividend_yield_pct": pct(sum(r["dividend_income"] for r in rows) / total)},
        "allocation": {"sector": sectors, "country": alloc("country"), "holding": [
            {"name": r["symbol"], "value": r["value"], "weight_pct": r["weight_pct"]} for r in rows]},
        "risk": {"beta": beta, "volatility_pct": vol, "max_drawdown_1y_pct": dd, "hhi": num(hhi, 3),
                 "effective_holdings": num(1 / hhi, 1) if hhi else None, "weighted_pe": num(wpe, 1),
                 "correlation": {"symbols": syms, "matrix": corr.values.tolist() if corr is not None else None}},
        "flags": flags, "errors": errors,
        "method": "Values converted to the base currency at the latest USD/INR close. Risk uses the last year of daily "
                  "returns at today's weights. Weighted P/E is the harmonic mean (the P/E of the combined holding).",
    }
