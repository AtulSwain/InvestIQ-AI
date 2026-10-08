# InvestIQ

Your own stock research platform. Type a company name (e.g. **Reliance**) and InvestIQ
researches it on its own. It pulls the full price history and financial statements, then
builds one report covering:

| Section | What you get |
|---|---|
| **Verdict & scorecard** | Plain-English summary, strengths and risks, and a 0–10 score for performance, valuation, quality, momentum and safety |
| **Key numbers** | Market cap (₹ Cr / L Cr), P/E, P/B, EPS, dividend yield, ROE, debt/equity, margins, 52-week range, beta, all-time high |
| **Price history** | Interactive chart (1M to MAX) with SMA 50/200 and a "vs NIFTY 50 / S&P 500" comparison |
| **Performance** | Returns and CAGR for 1W to 20Y and MAX, year-by-year returns vs the index, what ₹10,000 invested 1/3/5/10/15/20 years ago is worth, SIP backtests with XIRR |
| **Rises & falls** | Drawdown chart, the 5 biggest crashes (peak, bottom, recovery date, time under water), biggest one-day rises and falls, volatility, Sharpe, Sortino, VaR, beta |
| **Fundamentals** | Revenue and profit by year, growth CAGR, cash, debt, free cash flow, company profile |
| **Fair value** | Graham number, Graham growth formula, DCF, earnings multiple and analyst targets, blended into a fair-value range and an under/overvalued verdict |
| **Future** | Bear/base/bull price ranges for 1, 3, 5 and 10 years, chance of loss, and an investment planner for a lump sum plus a monthly SIP |
| **Technicals** | Trend, RSI, MACD, Bollinger bands, golden/death cross, support and resistance levels |
| **Buy checklist** | 15 pass/fail checks across business quality, financial strength, valuation and price trend, with a verdict |
| **Trade plan** | Entry zone, stop-loss, up to 3 targets, reward-to-risk ratio, ATR, and a position-size calculator based on how much you're willing to lose |
| **More valuation** | Peter Lynch (PEG = 1), historical-P/E, and dividend-discount values; reverse DCF (the growth the price assumes); a DCF sensitivity grid; P/S, EV/EBITDA, EV/Sales, earnings and FCF yield; P/E at each year-end |
| **Financial breakdown** | Several years of revenue, profit, margins, ROE, ROCE, debt, interest coverage, cash flow and cash conversion; Piotroski F-Score (9 tests); Altman Z-Score (bankruptcy risk) |
| **Returns breakdown** | Month-by-month returns heatmap, seasonality by calendar month, holding-period returns (worst, typical and best for 1/3/5/10 years) |
| **Dividends & ownership** | Dividend per year, yield, 5-year growth, payment streak; insider and institutional holding |
| **Screener** (website) | Sort and filter every published stock by score, valuation, P/E, ROE, debt, dividend yield, sector and market |
| **Compare** | 2–5 stocks side by side, plus a "growth of 100" chart |
| **Watchlist** | Saved in your browser |

Indian stocks (NSE `.NS` / BSE `.BO`) are the primary focus. US tickers also work.
Market data comes from Yahoo Finance via [yfinance](https://github.com/ranaroussi/yfinance), which is free and needs no API key.

## Run it

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

python -m investiq                 # live data, opens http://127.0.0.1:8000
python -m investiq --demo          # synthetic offline data (no internet needed)
```

Then search for `Reliance`, `TCS`, `HDFCBANK`, `INFY.NS`, `AAPL` and so on.

Useful options: `--port 8080`, `--host 0.0.0.0` (open it from your phone on the same Wi-Fi), `--no-browser`.

## Website (GitHub Pages)

GitHub Pages can't run Python, so the workflow in `.github/workflows/pages.yml` does the work instead:
- It runs every weekday after the NSE close (and on every push to `main`).
- It builds full reports for about 60 popular stocks (the NIFTY 50 names, a few other popular Indian stocks and large US stocks).
- It publishes them with the dashboard to https://atulswain.github.io/InvestIQ-AI/.

One-time setup: go to repo **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
If the site shows a "InvestIQ is almost live" setup page (the root `index.html`), this setting hasn't been changed yet.
To add stocks to the site, edit `POPULAR_INDIA` / `POPULAR_US` in `investiq/data/symbols.py`.

You can build the site yourself with `python -m investiq.build_static --out site` (add `--demo` to work offline).
The local app (`python -m investiq`) can still research **any** stock on demand.

## Live server and data providers

Yahoo Finance (no key) is always the base source and the only one with good NSE/BSE coverage.
API keys add real-time US quotes and backups, and each one is optional:

| Provider | Environment variable(s) | Free tier | What InvestIQ uses it for |
|---|---|---|---|
| [Alpaca](https://alpaca.markets) | `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY` | Real-time IEX feed | Real-time US quotes (first choice) |
| [Finnhub](https://finnhub.io) | `FINNHUB_API_KEY` | 60 calls/min | Real-time US quotes |
| [Twelve Data](https://twelvedata.com) | `TWELVEDATA_API_KEY` | 800 calls/day | US quotes, US price history if Yahoo fails |
| [Financial Modeling Prep](https://financialmodelingprep.com) | `FMP_API_KEY` | 250 calls/day | US quotes, US price history and profile if Yahoo fails |
| [Alpha Vantage](https://www.alphavantage.co) | `ALPHAVANTAGE_API_KEY` | 25 calls/day | Last-resort quotes (news and macro in a later phase) |
| [Anthropic](https://console.anthropic.com) | `ANTHROPIC_API_KEY` | Pay per use | AI research (later phase) |

**On your computer:** copy `.env.example` to `.env`, fill in any keys, then run `python -m investiq`. `.env` is git-ignored.

**Hosted (so the website gets live data):**
1. Create a free account at [render.com](https://render.com), then choose **New → Blueprint** and pick this repository. `render.yaml` sets everything up.
2. In the new `investiq-api` service, open **Environment** and paste your keys. Keys live only on Render and are never in git or on the website.
3. Copy the service URL (e.g. `https://investiq-api.onrender.com`). In GitHub, add it under **Settings → Secrets and variables → Actions → Variables** as `INVESTIQ_API_URL`, then re-run the **Publish to GitHub Pages** workflow.

The website then shows the daily snapshot instantly, swaps in the live report when the server answers, and can research **any** stock, not only the published ones.
Render's free plan sleeps after ~15 minutes idle, so the first request after that takes 30–60 seconds; the snapshot covers that gap.
Check provider status any time at `<your-service>/api/health`, which shows the configured flag, calls today and last error for each provider (never the keys).

### Data trust
Every report includes:
- `sources`: provider, fetched time, as-of date, reporting period, currency, real-time or delayed, and whether each figure is reported, an estimate or calculated.
- `section_sources`: which sources back each section.
- `data_quality`: warnings for bad prices, gaps, stale statements and fallbacks used.

The dashboard shows these as a source line under each section, a "Sources & methodology" table, and badges for price freshness.
Provider responses are cached in memory and in SQLite (`INVESTIQ_CACHE_DIR`), and daily quotas are enforced.

## API

The dashboard is built on a JSON API you can use directly (docs at `/docs`):

- `GET /api/report/{symbol}`: the full research report (e.g. `/api/report/RELIANCE`)
- `GET /api/quote/{symbol}`: fastest available quote (real-time US with keys, else last close)
- `GET /api/search?q=reli`: symbol search
- `GET /api/compare?symbols=RELIANCE,TCS,INFY`: side-by-side comparison
- `GET /api/health`: data source and provider status

Browsers can call the API only from `INVESTIQ_ALLOWED_ORIGINS`, and each visitor gets `INVESTIQ_RATE_LIMIT` requests per minute (default 60).

## How the estimates work

- **Fair value** is the median of several simple models. Outliers more than 4× from the median are dropped. The table shows each model's formula and inputs. FCF and EPS models fit banks and loss-making companies poorly.
- **Future scenarios** use a log-normal model. Expected return blends the stock's own history (at most 50% weight) with a long-run market return (12% India, 9% US), and volatility comes from the last 10 years. Bear, base and bull are the 10th, 50th and 90th percentiles.
- **Risk-free rate** is 6.5% for India and 4% for the US. **Discount rate** is 12% for India and 9% for the US.

All of these assumptions live in `investiq/analysis/*.py` and are easy to change.

## Project layout

```
investiq/
  data/provider.py      Yahoo + demo data providers (15-min cache), US fallback
  data/sources/         Alpaca, Finnhub, Twelve Data, FMP, Alpha Vantage + fallback chains
  data/http.py          shared HTTP client: retries, typed errors, key redaction
  data/cache.py         memory + SQLite cache, daily quota counters
  data/provenance.py    source / timestamp / period / status records
  data/validation.py    data-quality checks
  data/symbols.py       name -> ticker resolution, benchmarks
  analysis/             performance, risk, technicals, fundamentals,
                        valuation, projection, scorecard, report
  api.py                FastAPI app
  build_static.py       static site builder for GitHub Pages
web/                    single-page dashboard (vanilla JS + Chart.js, vendored)
tests/                  pytest suite (runs offline)
```

Run the tests with `pip install -r requirements-dev.txt && pytest`.

> **Disclaimer:** InvestIQ is a research tool, not investment advice. Estimates and projections are model outputs based on past data and can be wrong.
