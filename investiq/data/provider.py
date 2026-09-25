"""Market data providers.

``YahooProvider`` pulls real data through yfinance (free, no API key; NSE
tickers end in ``.NS``, BSE in ``.BO``). ``DemoProvider`` generates
deterministic synthetic data so the app and tests work fully offline.
Select with the ``INVESTIQ_DATA_SOURCE`` environment variable
(``yahoo`` - the default - or ``demo``).
"""

from __future__ import annotations

import os
import threading
import time
import zlib
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .symbols import POPULAR_INDIA, POPULAR_US, currency_for, market_for, search_local


class DataUnavailableError(Exception):
    """Raised when no data can be fetched for a symbol."""


@dataclass
class StockData:
    symbol: str
    history: pd.DataFrame  # Open/High/Low/Close/Volume, adjusted, tz-naive DatetimeIndex
    info: dict = field(default_factory=dict)
    dividends: pd.Series = field(default_factory=lambda: pd.Series(dtype=float))
    # Annual statements: rows are line items, columns are fiscal year-end dates.
    income: pd.DataFrame = field(default_factory=pd.DataFrame)
    balance: pd.DataFrame = field(default_factory=pd.DataFrame)
    cashflow: pd.DataFrame = field(default_factory=pd.DataFrame)
    is_demo: bool = False


class _TTLCache:
    def __init__(self, ttl_seconds: float):
        self.ttl = ttl_seconds
        self._data: dict = {}
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            item = self._data.get(key)
            if item and time.time() - item[0] < self.ttl:
                return item[1]
            return None

    def set(self, key, value):
        with self._lock:
            self._data[key] = (time.time(), value)


class DataProvider:
    name = "base"
    is_demo = False

    def get_stock(self, symbol: str, with_fundamentals: bool = True) -> StockData:
        raise NotImplementedError

    def get_history(self, symbol: str) -> pd.DataFrame:
        return self.get_stock(symbol, with_fundamentals=False).history

    def search(self, query: str, limit: int = 10) -> list[dict]:
        return search_local(query, limit)


def _clean_history(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame()
    df = df.copy()
    if getattr(df.index, "tz", None) is not None:
        df.index = df.index.tz_localize(None)
    df.index = pd.DatetimeIndex(df.index).normalize()
    df = df[~df.index.duplicated(keep="last")].sort_index()
    df = df[df["Close"].notna() & (df["Close"] > 0)]
    return df


class YahooProvider(DataProvider):
    name = "yahoo"

    def __init__(self, ttl_seconds: float = 900):
        self._cache = _TTLCache(ttl_seconds)

    def get_stock(self, symbol: str, with_fundamentals: bool = True) -> StockData:
        key = (symbol.upper(), with_fundamentals)
        cached = self._cache.get(key) or (
            self._cache.get((symbol.upper(), True)) if not with_fundamentals else None
        )
        if cached is not None:
            return cached

        import yfinance as yf

        ticker = yf.Ticker(symbol)
        try:
            raw = ticker.history(period="max", auto_adjust=True, actions=True)
        except Exception as exc:  # network errors, rate limits, parse errors
            raise DataUnavailableError(f"Could not download prices for {symbol}: {exc}") from exc
        hist = _clean_history(raw)
        if hist.empty:
            raise DataUnavailableError(f"No price history found for {symbol}")

        dividends = hist["Dividends"] if "Dividends" in hist else pd.Series(dtype=float)
        dividends = dividends[dividends > 0]
        history = hist[["Open", "High", "Low", "Close", "Volume"]]

        data = StockData(symbol=symbol.upper(), history=history, dividends=dividends)
        if with_fundamentals:
            data.info = _safe(lambda: dict(ticker.info or {}), {})
            data.income = _safe(lambda: ticker.income_stmt, pd.DataFrame())
            data.balance = _safe(lambda: ticker.balance_sheet, pd.DataFrame())
            data.cashflow = _safe(lambda: ticker.cashflow, pd.DataFrame())
        self._cache.set(key, data)
        return data

    def search(self, query: str, limit: int = 10) -> list[dict]:
        results = search_local(query, limit)
        seen = {r["symbol"] for r in results}
        try:
            import yfinance as yf

            quotes = yf.Search(query, max_results=limit).quotes
        except Exception:
            quotes = []
        for q in quotes:
            sym = q.get("symbol")
            if not sym or sym in seen or q.get("quoteType") not in ("EQUITY", "ETF", "INDEX"):
                continue
            seen.add(sym)
            results.append(
                {
                    "symbol": sym,
                    "name": q.get("longname") or q.get("shortname") or sym,
                    "exchange": q.get("exchDisp") or q.get("exchange") or "",
                }
            )
        return results[:limit]


def _safe(fn, default):
    try:
        value = fn()
        return default if value is None else value
    except Exception:
        return default


class DemoProvider(DataProvider):
    """Deterministic synthetic market data (clearly flagged as demo in the UI)."""

    name = "demo"
    is_demo = True

    def __init__(self, years: int = 15, end: str | None = None):
        self.years = years
        self.end = pd.Timestamp(end) if end else pd.Timestamp.today().normalize()

    def _rng(self, symbol: str) -> np.random.Generator:
        return np.random.default_rng(zlib.crc32(symbol.upper().encode()))

    def get_stock(self, symbol: str, with_fundamentals: bool = True) -> StockData:
        symbol = symbol.upper()
        rng = self._rng(symbol)
        is_index = symbol.startswith("^")
        dates = pd.bdate_range(end=self.end, periods=self.years * 252)
        n = len(dates)
        mu = 0.10 if is_index else rng.uniform(0.04, 0.22)
        sigma = 0.17 if is_index else rng.uniform(0.20, 0.38)
        daily = rng.normal(mu / 252 - sigma**2 / 504, sigma / np.sqrt(252), n)
        # A market-wide crash around March 2020 so drawdown analysis has something to find.
        crash = (dates >= "2020-02-20") & (dates <= "2020-03-23")
        daily[crash] -= (0.30 if is_index else rng.uniform(0.25, 0.45)) / max(crash.sum(), 1)
        start_price = 100.0 if is_index else rng.uniform(80, 2500)
        close = start_price * np.exp(np.cumsum(daily))
        open_ = close * np.exp(rng.normal(0, sigma / 60, n))
        high = np.maximum(open_, close) * (1 + np.abs(rng.normal(0, sigma / 50, n)))
        low = np.minimum(open_, close) * (1 - np.abs(rng.normal(0, sigma / 50, n)))
        volume = rng.integers(1_000_000, 20_000_000, n).astype(float)
        history = pd.DataFrame(
            {"Open": open_, "High": high, "Low": low, "Close": close, "Volume": volume},
            index=dates,
        )

        div_dates = [d for d in dates if d.month == 8 and d.day <= 7][::5]
        price = close[-1]
        dividends = pd.Series(
            [price * rng.uniform(0.003, 0.012)] * len(div_dates),
            index=pd.DatetimeIndex(div_dates),
            dtype=float,
        )

        data = StockData(symbol=symbol, history=history, dividends=dividends, is_demo=True)
        if with_fundamentals and not is_index:
            self._fill_fundamentals(data, rng, price)
        return data

    def _fill_fundamentals(self, data: StockData, rng: np.random.Generator, price: float):
        base = data.symbol.split(".")[0]
        name = POPULAR_INDIA.get(base) or POPULAR_US.get(base) or f"{base} Demo Corp"
        shares = rng.uniform(0.5e9, 7e9)
        pe = rng.uniform(12, 45)
        eps = price / pe
        net_income = eps * shares
        margin = rng.uniform(0.06, 0.25)
        revenue = net_income / margin
        growth = rng.uniform(0.03, 0.18)
        years = pd.DatetimeIndex(
            [pd.Timestamp(self.end.year - i - 1, 3, 31) for i in range(4)]
        )
        rev = [revenue / (1 + growth) ** i for i in range(4)]
        ni = [r * margin * rng.uniform(0.9, 1.1) for r in rev]
        equity = [n / rng.uniform(0.10, 0.22) for n in ni]
        debt = [e * rng.uniform(0.1, 0.9) for e in equity]
        cash = [d * rng.uniform(0.2, 0.8) for d in debt]
        fcf = [n * rng.uniform(0.6, 1.1) for n in ni]
        data.income = pd.DataFrame(
            {y: {"Total Revenue": r, "Net Income": n, "Diluted EPS": n / shares}
             for y, r, n in zip(years, rev, ni)}
        )
        data.balance = pd.DataFrame(
            {y: {"Stockholders Equity": e, "Total Debt": d, "Cash And Cash Equivalents": c}
             for y, e, d, c in zip(years, equity, debt, cash)}
        )
        data.cashflow = pd.DataFrame({y: {"Free Cash Flow": f} for y, f in zip(years, fcf)})
        hist = data.history["Close"]
        data.info = {
            "longName": name,
            "shortName": name,
            "sector": "Demo Sector",
            "industry": "Demo Industry",
            "currency": currency_for(data.symbol),
            "exchange": "NSE" if market_for(data.symbol) == "IN" else "NASDAQ",
            "longBusinessSummary": (
                f"{name} - synthetic demo data generated by InvestIQ. "
                "Switch INVESTIQ_DATA_SOURCE to 'yahoo' for real market data."
            ),
            "marketCap": price * shares,
            "sharesOutstanding": shares,
            "trailingPE": pe,
            "forwardPE": pe * rng.uniform(0.8, 1.0),
            "trailingEps": eps,
            "forwardEps": eps * (1 + growth),
            "bookValue": equity[0] / shares,
            "priceToBook": price / (equity[0] / shares),
            "returnOnEquity": ni[0] / equity[0],
            "debtToEquity": debt[0] / equity[0] * 100,
            "profitMargins": margin,
            "operatingMargins": margin * 1.4,
            "revenueGrowth": growth,
            "earningsGrowth": growth * rng.uniform(0.8, 1.3),
            "currentRatio": rng.uniform(0.8, 2.5),
            "beta": rng.uniform(0.6, 1.4),
            "fiftyTwoWeekHigh": float(hist.iloc[-252:].max()),
            "fiftyTwoWeekLow": float(hist.iloc[-252:].min()),
            "targetMeanPrice": price * rng.uniform(0.9, 1.3),
            "targetHighPrice": price * rng.uniform(1.3, 1.6),
            "targetLowPrice": price * rng.uniform(0.7, 0.9),
            "numberOfAnalystOpinions": int(rng.integers(5, 40)),
            "recommendationKey": "buy",
        }


_provider: DataProvider | None = None


def get_provider() -> DataProvider:
    global _provider
    if _provider is None:
        source = os.environ.get("INVESTIQ_DATA_SOURCE", "yahoo").lower()
        _provider = DemoProvider() if source == "demo" else YahooProvider()
    return _provider


def set_provider(provider: DataProvider) -> None:
    global _provider
    _provider = provider
