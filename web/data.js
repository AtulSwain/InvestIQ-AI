/* Data layer. Two backends with the same interface:
   - server: the FastAPI app (python -m investiq), any stock on demand
   - static: pre-built JSON reports (GitHub Pages), refreshed by a scheduled workflow */
(function () {
  const isStatic = !!(window.INVESTIQ_CONFIG && window.INVESTIQ_CONFIG.static);
  const cache = new Map();

  async function getJSON(path, notFound) {
    if (cache.has(path)) return cache.get(path);
    const res = await fetch(path);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(res.status === 404 && notFound ? notFound : body.detail || `Request failed (${res.status})`);
    cache.set(path, body);
    return body;
  }

  // Must match investiq.build_static.report_filename
  const fileName = (symbol) => symbol.toUpperCase().replace(/[^A-Z0-9.\-]/g, "_");

  const server = {
    isStatic: false,
    health: () => getJSON("api/health"),
    search: async (q) => (await getJSON(`api/search?q=${encodeURIComponent(q)}`)).results,
    report: (q) => getJSON(`api/report/${encodeURIComponent(q)}`),
    listAll: async () => null,
  };

  const staticIndex = () => getJSON("data/index.json");

  async function resolve(q) {
    const s = q.trim().toUpperCase();
    const { stocks } = await staticIndex();
    return (
      stocks.find((x) => x.symbol === s) ||
      stocks.find((x) => x.symbol.split(".")[0] === s) ||
      stocks.find((x) => x.name.toUpperCase() === s) ||
      stocks.find((x) => x.name.toUpperCase().startsWith(s)) ||
      (s.length >= 3 && stocks.find((x) => x.name.toUpperCase().includes(s))) ||
      null
    );
  }

  const pages = {
    isStatic: true,
    health: async () => {
      const idx = await staticIndex();
      return { demo: !!idx.demo, static: true, generated_at: idx.generated_at, count: idx.stocks.length };
    },
    search: async (q) => {
      const s = q.trim().toUpperCase();
      const { stocks } = await staticIndex();
      return stocks
        .filter((x) => x.symbol.includes(s) || x.name.toUpperCase().includes(s))
        .sort((a, b) => (b.symbol.startsWith(s) || b.name.toUpperCase().startsWith(s)) - (a.symbol.startsWith(s) || a.name.toUpperCase().startsWith(s)))
        .slice(0, 10)
        .map((x) => ({ symbol: x.symbol, name: x.name, exchange: x.exchange }));
    },
    report: async (q) => {
      const hit = await resolve(q);
      if (!hit) {
        throw new Error(`"${q}" isn't in the stocks published on this site. Run InvestIQ on your computer (python -m investiq) to research any stock.`);
      }
      return getJSON(`data/reports/${fileName(hit.symbol)}.json`, `Report for ${hit.symbol} is missing.`);
    },
    listAll: async () => (await staticIndex()).stocks,
  };

  const backend = isStatic ? pages : server;

  /* Side-by-side comparison, built from full reports (same in both modes). */
  backend.compare = async (queries) => {
    const settled = await Promise.allSettled(queries.map((q) => backend.report(q)));
    return settled.map((res, i) => {
      if (res.status === "rejected") return { query: queries[i], error: res.reason.message };
      const r = res.value;
      const t = Object.fromEntries(r.performance.trailing.map((row) => [row.period, row]));
      const f = r.fundamentals;
      return {
        query: queries[i],
        symbol: r.symbol,
        name: r.name,
        currency: r.currency,
        price: r.quote.price,
        market_cap: f.market_cap,
        pe: f.pe,
        pb: f.pb,
        roe_pct: f.roe_pct,
        debt_to_equity: f.debt_to_equity,
        dividend_yield_pct: f.dividend_yield_pct,
        return_1y_pct: t["1Y"]?.total_return_pct,
        cagr_5y_pct: t["5Y"]?.cagr_pct,
        cagr_10y_pct: t["10Y"]?.cagr_pct,
        volatility_1y_pct: r.risk.windows["1Y"]?.volatility_pct,
        max_drawdown_pct: r.risk.windows.MAX?.max_drawdown_pct,
        fair_value_mid: r.valuation.fair_value?.mid,
        valuation_verdict: r.valuation.verdict,
        score: r.scorecard.overall,
        rating: r.scorecard.rating,
        chart: { dates: r.chart.dates, close: r.chart.close },
        disclaimer: r.disclaimer,
      };
    });
  };

  window.investiqData = backend;
})();
