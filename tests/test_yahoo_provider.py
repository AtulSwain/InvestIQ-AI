"""YahooProvider against a stubbed yfinance (no network)."""

import numpy as np
import pandas as pd
import pytest
import yfinance

from investiq.analysis.report import build_report
from investiq.data.provider import DataUnavailableError, YahooProvider


class FakeTicker:
    def __init__(self, symbol):
        self.symbol = symbol

    def history(self, **kwargs):
        if self.symbol.startswith("MISSING"):
            return pd.DataFrame()
        idx = pd.date_range("2012-01-02", "2026-09-24", freq="B", tz="Asia/Kolkata")
        close = 100 * np.exp(np.cumsum(np.random.default_rng(0).normal(0.0004, 0.015, len(idx))))
        return pd.DataFrame(
            {"Open": close, "High": close * 1.01, "Low": close * 0.99, "Close": close,
             "Volume": 1e6, "Dividends": 0.0, "Stock Splits": 0.0},
            index=idx,
        )

    @property
    def info(self):
        return {"longName": "Fake Industries", "currency": "INR", "trailingEps": 50.0,
                "bookValue": 400.0, "sharesOutstanding": 1e9}

    @property
    def income_stmt(self):
        cols = pd.to_datetime(["2026-03-31", "2025-03-31", "2024-03-31"])
        return pd.DataFrame([[120.0, 100.0, 90.0], [12.0, 10.0, 8.0]],
                            index=["Total Revenue", "Net Income"], columns=cols)

    @property
    def balance_sheet(self):
        raise RuntimeError("not available")  # must be tolerated

    cashflow = pd.DataFrame()


@pytest.fixture
def provider(monkeypatch):
    monkeypatch.setattr(yfinance, "Ticker", FakeTicker)
    return YahooProvider()


def test_history_is_tz_naive_and_report_builds(provider):
    data = provider.get_stock("FAKE.NS")
    assert data.history.index.tz is None
    assert list(data.history.columns) == ["Open", "High", "Low", "Close", "Volume"]
    assert data.balance.empty  # failing statement falls back to empty
    report = build_report(provider, "FAKE.NS")
    assert report["name"] == "Fake Industries"
    assert report["fundamentals"]["revenue_cagr_pct"] == pytest.approx(15.5, abs=0.3)


def test_missing_symbol_raises(provider):
    with pytest.raises(DataUnavailableError):
        provider.get_stock("MISSING.NS")
