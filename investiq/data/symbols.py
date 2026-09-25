"""Ticker helpers: name lookup, market detection and benchmark selection."""

from __future__ import annotations

# Well-known NSE listings so that "reliance" or "RELIANCE" resolves without a
# network round-trip. Yahoo search covers everything else.
POPULAR_INDIA = {
    "RELIANCE": "Reliance Industries",
    "TCS": "Tata Consultancy Services",
    "HDFCBANK": "HDFC Bank",
    "ICICIBANK": "ICICI Bank",
    "INFY": "Infosys",
    "BHARTIARTL": "Bharti Airtel",
    "SBIN": "State Bank of India",
    "ITC": "ITC",
    "HINDUNILVR": "Hindustan Unilever",
    "LT": "Larsen & Toubro",
    "KOTAKBANK": "Kotak Mahindra Bank",
    "AXISBANK": "Axis Bank",
    "BAJFINANCE": "Bajaj Finance",
    "ASIANPAINT": "Asian Paints",
    "MARUTI": "Maruti Suzuki India",
    "HCLTECH": "HCL Technologies",
    "SUNPHARMA": "Sun Pharmaceutical Industries",
    "TITAN": "Titan Company",
    "ULTRACEMCO": "UltraTech Cement",
    "WIPRO": "Wipro",
    "NESTLEIND": "Nestle India",
    "TATAMOTORS": "Tata Motors",
    "TATASTEEL": "Tata Steel",
    "POWERGRID": "Power Grid Corporation of India",
    "NTPC": "NTPC",
    "ONGC": "Oil & Natural Gas Corporation",
    "ADANIENT": "Adani Enterprises",
    "ADANIPORTS": "Adani Ports & SEZ",
    "COALINDIA": "Coal India",
    "JSWSTEEL": "JSW Steel",
    "M&M": "Mahindra & Mahindra",
    "BAJAJFINSV": "Bajaj Finserv",
    "TECHM": "Tech Mahindra",
    "HDFCLIFE": "HDFC Life Insurance",
    "DRREDDY": "Dr. Reddy's Laboratories",
    "CIPLA": "Cipla",
    "DIVISLAB": "Divi's Laboratories",
    "EICHERMOT": "Eicher Motors",
    "HEROMOTOCO": "Hero MotoCorp",
    "BRITANNIA": "Britannia Industries",
    "GRASIM": "Grasim Industries",
    "INDUSINDBK": "IndusInd Bank",
    "APOLLOHOSP": "Apollo Hospitals",
    "DMART": "Avenue Supermarts (DMart)",
    "PIDILITIND": "Pidilite Industries",
    "ZOMATO": "Zomato",
    "IRCTC": "Indian Railway Catering & Tourism",
    "HAL": "Hindustan Aeronautics",
    "BEL": "Bharat Electronics",
    "TATAPOWER": "Tata Power",
    "VEDL": "Vedanta",
}

POPULAR_US = {
    "AAPL": "Apple",
    "MSFT": "Microsoft",
    "GOOGL": "Alphabet",
    "AMZN": "Amazon",
    "NVDA": "NVIDIA",
    "META": "Meta Platforms",
    "TSLA": "Tesla",
    "BRK-B": "Berkshire Hathaway",
    "JPM": "JPMorgan Chase",
    "V": "Visa",
    "NFLX": "Netflix",
    "AMD": "Advanced Micro Devices",
}

INDIA_SUFFIXES = (".NS", ".BO")


def market_for(symbol: str) -> str:
    """Return 'IN' for NSE/BSE listings, 'US' otherwise."""
    s = symbol.upper()
    if s.endswith(INDIA_SUFFIXES) or s in ("^NSEI", "^BSESN", "^NSEBANK"):
        return "IN"
    return "US"


def benchmark_for(symbol: str) -> str:
    return "^NSEI" if market_for(symbol) == "IN" else "^GSPC"


def currency_for(symbol: str) -> str:
    return "INR" if market_for(symbol) == "IN" else "USD"


def search_local(query: str, limit: int = 10) -> list[dict]:
    """Match the query against the built-in list of popular stocks."""
    q = query.strip().upper()
    if not q:
        return []
    results = []
    for table, suffix, exchange in (
        (POPULAR_INDIA, ".NS", "NSE"),
        (POPULAR_US, "", "NASDAQ/NYSE"),
    ):
        for sym, name in table.items():
            if q in sym or q in name.upper():
                exact = sym == q or name.upper() == q
                starts = sym.startswith(q) or name.upper().startswith(q)
                rank = 0 if exact else 1 if starts else 2
                results.append(
                    (rank, {"symbol": sym + suffix, "name": name, "exchange": exchange})
                )
    results.sort(key=lambda r: (r[0], r[1]["symbol"]))
    return [r[1] for r in results[:limit]]


def resolve_candidates(raw: str) -> list[str]:
    """Ordered list of Yahoo tickers to try for a user-typed symbol or name.

    "reliance" -> ["RELIANCE.NS", ...]; "AAPL" -> ["AAPL"]; "INFY.NS" stays as is.
    """
    s = raw.strip().upper().replace(" ", "")
    if not s:
        return []
    if "." in s or s.startswith("^") or "=" in s:
        return [s]
    if s in POPULAR_INDIA:
        return [s + ".NS", s + ".BO"]
    if s in POPULAR_US:
        return [s]
    local = search_local(raw, limit=1)
    if local and local[0]["name"].upper().startswith(raw.strip().upper()):
        return [local[0]["symbol"]]
    # Unknown bare ticker: try NSE first (primary use case), then as-is (US).
    return [s + ".NS", s, s + ".BO"]
