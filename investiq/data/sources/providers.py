"""The five API-key providers. Each maps the provider's JSON to InvestIQ's normalised shapes.

Normalised quote:
    {symbol, price, change, change_pct, prev_close, open, high, low, volume,
     timestamp (ISO-8601 UTC or None), provider, realtime (bool), delayed (str|None)}

Normalised daily bar (history fallback):
    {date: "YYYY-MM-DD", open, high, low, close, volume}

Endpoints are from each provider's public documentation (2025-2026); every
parse is defensive because free plans omit fields or return errors as 200s.
"""

from __future__ import annotations

from datetime import datetime, timezone

from ..http import AuthError, NotFoundError, ProviderError, RateLimitError
from .base import KeyedSource, normalize_symbol, to_float


def _iso_from_unix(ts) -> str | None:
    t = to_float(ts)
    if not t:
        return None
    if t > 1e12:  # milliseconds
        t /= 1000
    return datetime.fromtimestamp(t, tz=timezone.utc).replace(microsecond=0).isoformat()


def _quote(symbol, provider, *, price, prev_close=None, change=None, change_pct=None, open_=None,
           high=None, low=None, volume=None, timestamp=None, realtime=False, delayed=None):
    if price is None or price <= 0:
        return None
    if change is None and prev_close:
        change = price - prev_close
    if change_pct is None and prev_close:
        change_pct = (price / prev_close - 1) * 100
    return {
        "symbol": symbol.upper(), "price": price, "change": change, "change_pct": change_pct,
        "prev_close": prev_close, "open": open_, "high": high, "low": low, "volume": volume,
        "timestamp": timestamp, "provider": provider, "realtime": realtime, "delayed": delayed,
    }


class Alpaca(KeyedSource):
    """Free real-time US quotes from the IEX exchange feed (IEX volume is a slice of the market)."""

    id = "alpaca"
    env_vars = ("ALPACA_API_KEY_ID", "ALPACA_API_SECRET_KEY")
    realtime_us = True
    BASE = "https://data.alpaca.markets/v2"

    def _headers(self):
        key_id, secret = self.keys()
        return {"APCA-API-KEY-ID": key_id, "APCA-API-SECRET-KEY": secret}

    def quote(self, symbol):
        sym = normalize_symbol(self.id, symbol)
        d = self.fetch(f"{self.BASE}/stocks/{sym}/snapshot", params={"feed": "iex"}, headers=self._headers())
        trade = d.get("latestTrade") or {}
        day = d.get("dailyBar") or {}
        prev = d.get("prevDailyBar") or {}
        return _quote(symbol, self.id, price=to_float(trade.get("p")), prev_close=to_float(prev.get("c")),
                      open_=to_float(day.get("o")), high=to_float(day.get("h")), low=to_float(day.get("l")),
                      volume=to_float(day.get("v")), timestamp=trade.get("t"), realtime=True,
                      delayed="Real-time IEX trades (IEX is ~2-3% of US volume)")


class Finnhub(KeyedSource):
    id = "finnhub"
    env_vars = ("FINNHUB_API_KEY",)
    realtime_us = True
    BASE = "https://finnhub.io/api/v1"

    def quote(self, symbol):
        sym = normalize_symbol(self.id, symbol)
        d = self.fetch(f"{self.BASE}/quote", params={"symbol": sym, "token": self.keys()[0]})
        if not to_float(d.get("c")) and not d.get("t"):
            raise NotFoundError(self.id, f"no quote for {sym}")
        return _quote(symbol, self.id, price=to_float(d.get("c")), prev_close=to_float(d.get("pc")),
                      change=to_float(d.get("d")), change_pct=to_float(d.get("dp")), open_=to_float(d.get("o")),
                      high=to_float(d.get("h")), low=to_float(d.get("l")), timestamp=_iso_from_unix(d.get("t")),
                      realtime=True, delayed=None)


class TwelveData(KeyedSource):
    id = "twelvedata"
    env_vars = ("TWELVEDATA_API_KEY",)
    daily_limit = 800
    BASE = "https://api.twelvedata.com"

    def check_payload(self, data):
        # Twelve Data reports errors as {"status": "error", "code": 4xx, "message": ...} with HTTP 200.
        if isinstance(data, dict) and data.get("status") == "error":
            code = data.get("code")
            msg = data.get("message", "error")
            if code in (401, 403):
                raise AuthError(self.id, msg, code)
            if code == 429:
                raise RateLimitError(self.id, msg, code, retryable=True)
            if code == 404:
                raise NotFoundError(self.id, msg, code)
            raise ProviderError(self.id, msg, code)
        return data

    def quote(self, symbol):
        sym = normalize_symbol(self.id, symbol)
        d = self.fetch(f"{self.BASE}/quote", params={"symbol": sym, "apikey": self.keys()[0]})
        return _quote(symbol, self.id, price=to_float(d.get("close")), prev_close=to_float(d.get("previous_close")),
                      change=to_float(d.get("change")), change_pct=to_float(d.get("percent_change")),
                      open_=to_float(d.get("open")), high=to_float(d.get("high")), low=to_float(d.get("low")),
                      volume=to_float(d.get("volume")),
                      timestamp=_iso_from_unix(d.get("last_quote_at") or d.get("timestamp")),
                      realtime=False, delayed="Real-time or up to 15 min delayed, depending on the plan")

    def daily_history(self, symbol):
        sym = normalize_symbol(self.id, symbol)
        d = self.fetch(f"{self.BASE}/time_series",
                       params={"symbol": sym, "interval": "1day", "outputsize": 5000, "apikey": self.keys()[0]},
                       kind="prices")
        rows = [{"date": v.get("datetime", "")[:10], "open": to_float(v.get("open")), "high": to_float(v.get("high")),
                 "low": to_float(v.get("low")), "close": to_float(v.get("close")), "volume": to_float(v.get("volume"))}
                for v in d.get("values") or []]
        return sorted([r for r in rows if r["date"] and r["close"]], key=lambda r: r["date"]) or None


class FMP(KeyedSource):
    id = "fmp"
    env_vars = ("FMP_API_KEY",)
    daily_limit = 250
    BASE = "https://financialmodelingprep.com/stable"

    def check_payload(self, data):
        # FMP sends {"Error Message": "..."} for bad keys / plan limits.
        if isinstance(data, dict) and data.get("Error Message"):
            msg = data["Error Message"]
            if "limit" in msg.lower():
                raise RateLimitError(self.id, msg)
            raise AuthError(self.id, msg)
        return data

    def _get(self, path, kind="quote", **params):
        return self.fetch(f"{self.BASE}/{path}", params={**params, "apikey": self.keys()[0]}, kind=kind)

    def quote(self, symbol):
        rows = self._get("quote", symbol=normalize_symbol(self.id, symbol))
        if not rows:
            raise NotFoundError(self.id, f"no quote for {symbol}")
        d = rows[0]
        return _quote(symbol, self.id, price=to_float(d.get("price")), prev_close=to_float(d.get("previousClose")),
                      change=to_float(d.get("change")), change_pct=to_float(d.get("changePercentage")),
                      open_=to_float(d.get("open")), high=to_float(d.get("dayHigh")), low=to_float(d.get("dayLow")),
                      volume=to_float(d.get("volume")), timestamp=_iso_from_unix(d.get("timestamp")),
                      realtime=False, delayed="May be delayed on the free plan")

    def daily_history(self, symbol):
        rows = self._get("historical-price-eod/full", kind="prices", symbol=normalize_symbol(self.id, symbol))
        if isinstance(rows, dict):  # older shape: {"symbol":..., "historical": [...]}
            rows = rows.get("historical") or []
        out = [{"date": r.get("date", "")[:10], "open": to_float(r.get("open")), "high": to_float(r.get("high")),
                "low": to_float(r.get("low")), "close": to_float(r.get("close")), "volume": to_float(r.get("volume"))}
               for r in rows or []]
        return sorted([r for r in out if r["date"] and r["close"]], key=lambda r: r["date"]) or None

    def profile(self, symbol) -> dict | None:
        rows = self._get("profile", kind="profile", symbol=normalize_symbol(self.id, symbol))
        return rows[0] if rows else None


class AlphaVantage(KeyedSource):
    id = "alphavantage"
    env_vars = ("ALPHAVANTAGE_API_KEY",)
    daily_limit = 25
    BASE = "https://www.alphavantage.co/query"

    def supports(self, symbol):
        return not symbol.startswith("^")  # BSE listings work as SYMBOL.BSE

    @staticmethod
    def av_symbol(symbol: str) -> str:
        s = symbol.upper()
        if s.endswith((".NS", ".BO")):
            return s.rsplit(".", 1)[0] + ".BSE"
        return s

    def check_payload(self, data):
        # Quota / throttling messages arrive as {"Note": ...} or {"Information": ...}; bad input as {"Error Message": ...}.
        if isinstance(data, dict):
            if data.get("Note") or data.get("Information"):
                raise RateLimitError(self.id, data.get("Note") or data.get("Information"))
            if data.get("Error Message"):
                raise NotFoundError(self.id, data["Error Message"])
        return data

    def quote(self, symbol):
        d = self.fetch(self.BASE, params={"function": "GLOBAL_QUOTE", "symbol": self.av_symbol(symbol),
                                          "apikey": self.keys()[0]}, kind="prices")
        g = d.get("Global Quote") or {}
        if not g:
            raise NotFoundError(self.id, f"no quote for {symbol}")
        return _quote(symbol, self.id, price=to_float(g.get("05. price")), prev_close=to_float(g.get("08. previous close")),
                      change=to_float(g.get("09. change")), change_pct=to_float(g.get("10. change percent")),
                      open_=to_float(g.get("02. open")), high=to_float(g.get("03. high")), low=to_float(g.get("04. low")),
                      volume=to_float(g.get("06. volume")), timestamp=None, realtime=False,
                      delayed=f"End of day {g.get('07. latest trading day', '')}".strip())
