"""Two-level cache (memory + SQLite on disk) and per-provider daily call counters.

The disk layer survives restarts, which matters on free hosts that sleep and
on providers with tiny quotas (Alpha Vantage: 25 calls/day). Values must be
JSON-serialisable. Location: ``INVESTIQ_CACHE_DIR`` (default ``~/.cache/investiq``).
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

# Default time-to-live per kind of data, in seconds.
TTL = {
    "quote": 60,                # live quotes
    "prices": 15 * 60,          # price history / delayed quotes
    "profile": 24 * 3600,
    "fundamentals": 12 * 3600,  # ratios, estimates, targets
    "statements": 24 * 3600,
    "news": 15 * 60,
    "macro": 24 * 3600,      # macro series update monthly; 6 Alpha Vantage calls/day
}


class Cache:
    def __init__(self, path: str | Path | None = None):
        if path is None:
            root = Path(os.environ.get("INVESTIQ_CACHE_DIR", Path.home() / ".cache" / "investiq"))
            path = root / "cache.sqlite3"
        self.path = str(path)
        self._mem: dict[str, tuple[float, object]] = {}
        self._lock = threading.Lock()
        self._db = None
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        try:
            self._db = sqlite3.connect(self.path, check_same_thread=False)
            self._db.execute("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, expires REAL, v TEXT)")
            self._db.execute("CREATE TABLE IF NOT EXISTS calls (provider TEXT, day TEXT, n INTEGER, "
                             "PRIMARY KEY (provider, day))")
            self._db.commit()
        except sqlite3.Error:
            self._db = None  # read-only filesystem etc. -> memory only

    # ---------- key/value ----------
    def get(self, key: str):
        now = time.time()
        with self._lock:
            hit = self._mem.get(key)
            if hit and hit[0] > now:
                return hit[1]
            if self._db is not None:
                row = self._db.execute("SELECT expires, v FROM kv WHERE k = ?", (key,)).fetchone()
                if row and row[0] > now:
                    value = json.loads(row[1])
                    self._mem[key] = (row[0], value)
                    return value
        return None

    def set(self, key: str, value, ttl: float):
        expires = time.time() + ttl
        with self._lock:
            self._mem[key] = (expires, value)
            if self._db is not None:
                try:
                    self._db.execute("INSERT OR REPLACE INTO kv VALUES (?, ?, ?)", (key, expires, json.dumps(value)))
                    self._db.commit()
                except (sqlite3.Error, TypeError, ValueError):
                    pass

    def cached(self, key: str, kind: str, fn):
        """Return the cached value for ``key`` or compute it with ``fn()`` and store it."""
        value = self.get(key)
        if value is None:
            value = fn()
            if value is not None:
                self.set(key, value, TTL[kind])
        return value

    # ---------- daily call counters (UTC days) ----------
    @staticmethod
    def _day() -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    def calls_today(self, provider: str) -> int:
        with self._lock:
            if self._db is None:
                return int(self._mem.get(f"__calls:{provider}:{self._day()}", (0, 0))[1])
            row = self._db.execute("SELECT n FROM calls WHERE provider = ? AND day = ?",
                                   (provider, self._day())).fetchone()
            return row[0] if row else 0

    def count_call(self, provider: str) -> int:
        day = self._day()
        with self._lock:
            if self._db is None:
                key = f"__calls:{provider}:{day}"
                n = int(self._mem.get(key, (0, 0))[1]) + 1
                self._mem[key] = (float("inf"), n)
                return n
            self._db.execute("INSERT INTO calls VALUES (?, ?, 1) ON CONFLICT(provider, day) "
                             "DO UPDATE SET n = n + 1", (provider, day))
            self._db.commit()
            return self._db.execute("SELECT n FROM calls WHERE provider = ? AND day = ?",
                                    (provider, day)).fetchone()[0]


_cache: Cache | None = None


def get_cache() -> Cache:
    global _cache
    if _cache is None:
        _cache = Cache()
    return _cache


def set_cache(c: Cache | None) -> None:
    global _cache
    _cache = c
