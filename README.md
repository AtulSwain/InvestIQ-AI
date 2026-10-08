# InvestIQ

A stock-research and financial-intelligence terminal for Indian (NSE/BSE) and US stocks. It is
organised around one research workflow: **Discover → Research → Investigate → Compare → Value →
Monitor → Build thesis**. Every metric shows its source, period, currency, last-updated time and
whether it is reported, an estimate or calculated (hover any value).

| Area | What you get |
|---|---|
| **Dashboard** | Indices and macro ticker, your watchlist's performance, market movers (gainers, losers, unusual volume), sector heat map, ranked news, upcoming earnings, economic events, insights about your own stocks and notebooks |
| **Markets** | Indices table, sector intelligence with drill-down into each sector's stocks, macro dashboard (rates, USD/INR, crude, gold, VIX, US economic series, how macro moves sectors) |
| **Discover** | Ready-made screens (quality at a fair price, undervalued, compounders, dividends, momentum, low volatility, beaten-down quality, cash machines) |
| **Research** (company page) | Tabs: Overview (line or candlestick chart with OHLC and volume, summary, scorecard, ~45 key metrics with signals), Financials (annual + quarterly with YoY), Valuation (fair value, multiples, reverse DCF, scenarios, planner, buy checklist, trade plan), Earnings (estimate vs actual, analyst actions, consensus), Ownership & dividends (holders, funds, insider activity), News ("why did it move"), Filings, Peers (positioning ranks), Risk (10-dimension risk profile with evidence), Performance & technicals, AI analysis, Sources |
| **News intelligence** | Headlines classified into earnings, M&A, regulatory, legal, insider, analyst, product, corporate and macro, linked to that day's price move |
| **Screener** | Filter on any calculated metric, by market and sector; sort; saved screens; CSV; send picks to Compare or a watchlist |
| **Compare** | Up to 4 stocks: rebased performance, every metric with the best value highlighted, strengths and risks, AI comparison |
| **AI research** | Ask "Why did this stock move?", "Is it overvalued?", "Analyze the latest earnings"… Answers are structured and every claim links to a numbered source (InvestIQ data with its date, or a web page). Uses Claude via the Anthropic API |
| **Watchlists & portfolio** | Multiple watchlists; portfolio P&L in INR or USD, allocation by holding / sector / country, beta, volatility, drawdown, correlation, weighted P/E, concentration warnings |
| **Alerts** | Price, daily move, any metric, news category, earnings date, insider selling, downgrades, new filings; toast + browser notification |
| **Research workspace** | A notebook per idea (thesis, bull/bear, risks, catalysts, questions, notes, saved AI answers, sources) and a thesis tracker that checks measurable assumptions and new developments and flags conflicts |
| **Data sources** | Every exchange (NSE, BSE, Nasdaq, NYSE), data provider (Yahoo Finance, Alpaca, Finnhub, Twelve Data, FMP, Alpha Vantage), regulator (SEC, SEBI, RBI, MoSPI) and AI service, with its logo, what InvestIQ uses it for and (on a live server) whether it is configured. The same logos mark prices, section sources, news publishers, filings and AI citations across the app |
| **Reports** | One-click research report (with your thesis if you have one), print to PDF or download Markdown |

Logos are each organisation's own site icon, loaded in the browser through Google's public favicon service; if one can't load, a lettered badge in the brand colour is shown. Names and logos are trademarks of their owners, used only to identify data sources.

Keyboard: `Ctrl K` or `/` opens the command palette, `g` then a letter jumps to a page (`?` lists them), `t` toggles light/dark.
Watchlists, portfolio, notebooks and alerts are stored in your browser; export/import them from the command palette.

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
| [Finnhub](https://finnhub.io) | `FINNHUB_API_KEY` | 60 calls/min | Real-time US quotes, US company news, peers |
| [Twelve Data](https://twelvedata.com) | `TWELVEDATA_API_KEY` | 800 calls/day | US quotes, US price history if Yahoo fails |
| [Financial Modeling Prep](https://financialmodelingprep.com) | `FMP_API_KEY` | 250 calls/day | US quotes, US price history and profile if Yahoo fails |
| [Alpha Vantage](https://www.alphavantage.co) | `ALPHAVANTAGE_API_KEY` | 25 calls/day | Last-resort quotes; US macro series (rates, CPI, unemployment, GDP) |
| [Anthropic](https://console.anthropic.com) | `ANTHROPIC_API_KEY` | Pay per use | AI research assistant, AI investment summaries (`INVESTIQ_AI_MODEL`, default `claude-opus-5-5`; `INVESTIQ_AI_RATE_LIMIT` questions per IP per hour, default 20; `INVESTIQ_AI_WEB_SEARCH=0` turns web search off) |

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
- `GET /api/extended/{symbol}`: news, earnings, quarterly results, ownership, insider trades, analyst actions, filings
- `GET /api/peers/{symbol}`: peer table and competitive positioning
- `GET /api/screener`: every metric for the tracked universe (cached 6 h)
- `GET /api/market/overview` · `/movers` · `/macro` · `/earnings?days=30` · `/news?symbols=A,B`
- `POST /api/portfolio` `{holdings:[{symbol, quantity, avg_cost}], base}`: portfolio analytics
- `POST /api/thesis/check` `{symbol, assumptions:[{metric, op, value}], since}`: thesis tracker
- `POST /api/ai/ask` `{question, symbols, web_search}` and `GET /api/ai/summary/{symbol}`: AI research with citations (503 when `ANTHROPIC_API_KEY` is not set)

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
  data/extended.py      news, earnings, quarterly results, ownership, analyst actions, filings
  analysis/             performance, risk, technicals, fundamentals, valuation, projection,
                        scorecard, report, metrics (registry + provenance + signals),
                        market (indices, movers, sectors, macro), news, peers, risk_profile,
                        portfolio, thesis
  ai.py                 Claude research assistant: report data as citable documents + web search
  api.py                FastAPI app
  build_static.py       static site builder for GitHub Pages
web/                    research terminal (vanilla JS + Chart.js, vendored): app.js shell/router,
                        data.js, store.js, ui.js, views/*.js (one file per page)
tests/                  pytest suite (runs offline)
```

Run the tests with `pip install -r requirements-dev.txt && pytest`.

> **Disclaimer:** InvestIQ is a research tool, not investment advice. Estimates and projections are model outputs based on past data and can be wrong.
