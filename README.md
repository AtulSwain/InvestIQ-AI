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

## API

The dashboard is built on a JSON API you can use directly (docs at `/docs`):

- `GET /api/report/{symbol}`: the full research report (e.g. `/api/report/RELIANCE`)
- `GET /api/search?q=reli`: symbol search
- `GET /api/compare?symbols=RELIANCE,TCS,INFY`: side-by-side comparison
- `GET /api/health`: data source status

## How the estimates work

- **Fair value** is the median of several simple models. Outliers more than 4× from the median are dropped. The table shows each model's formula and inputs. FCF and EPS models fit banks and loss-making companies poorly.
- **Future scenarios** use a log-normal model. Expected return blends the stock's own history (at most 50% weight) with a long-run market return (12% India, 9% US), and volatility comes from the last 10 years. Bear, base and bull are the 10th, 50th and 90th percentiles.
- **Risk-free rate** is 6.5% for India and 4% for the US. **Discount rate** is 12% for India and 9% for the US.

All of these assumptions live in `investiq/analysis/*.py` and are easy to change.

## Project layout

```
investiq/
  data/provider.py      Yahoo + demo data providers (15-min cache)
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
