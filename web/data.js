/* Data layer. Three ways to get data, one interface:
   - server:  the page is served by the FastAPI app itself (python -m investiq) - any stock, live.
   - static:  GitHub Pages - pre-built JSON reports refreshed by a scheduled workflow.
   - hybrid:  GitHub Pages + INVESTIQ_CONFIG.apiBase pointing at the hosted FastAPI app.
              Snapshot reports render instantly, the live report replaces them when it arrives,
              and stocks outside the snapshot are researched live. If the live server is asleep
              or down, everything falls back to the snapshot. */
(function () {
  const cfg = window.INVESTIQ_CONFIG || {};
  const isStatic = !!cfg.static;
  const apiBase = String(cfg.apiBase || "").replace(/\/+$/, "");
  const cache = new Map();

  async function getJSON(url, { notFound, timeout = 30000, fresh = false } = {}) {
    if (!fresh && cache.has(url)) return cache.get(url);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    let res;
    try {
      res = await fetch(url, { signal: ctl.signal });
    } catch (err) {
      throw new Error(err.name === "AbortError" ? "The data server took too long to respond." : "Could not reach the data server.");
    } finally {
      clearTimeout(timer);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(res.status === 404 && notFound ? notFound : body.detail || `Request failed (${res.status})`);
    cache.set(url, body);
    return body;
  }

  // Must match investiq.build_static.report_filename
  const fileName = (symbol) => symbol.toUpperCase().replace(/[^A-Z0-9.\-]/g, "_");

  function makeServer(base) {
    const u = (path) => (base ? `${base}/${path}` : path);
    return {
      health: (opts) => getJSON(u("api/health"), { fresh: true, ...opts }),
      search: async (q, opts) => (await getJSON(u(`api/search?q=${encodeURIComponent(q)}`), opts)).results,
      report: async (q, opts) => ({ ...(await getJSON(u(`api/report/${encodeURIComponent(q)}`), { timeout: 60000, ...opts })), _origin: "live" }),
      quote: (q, opts) => getJSON(u(`api/quote/${encodeURIComponent(q)}`), { fresh: true, ...opts }),
    };
  }

  /* ---------------- served by FastAPI ---------------- */
  const direct = makeServer("");
  const server = {
    isStatic: false,
    hasLive: true,
    health: () => direct.health(),
    search: (q) => direct.search(q),
    report: (q) => direct.report(q),
    listAll: async () => null,
    liveHealth: () => direct.health(),
  };

  /* ---------------- GitHub Pages (snapshot, optionally + live server) ---------------- */
  const live = isStatic && apiBase ? makeServer(apiBase) : null;
  // Free hosts sleep when idle; the first request can take ~30-60 s. Wake it as soon as the page loads.
  let livePromise = live ? live.health({ timeout: 75000 }).catch(() => null) : Promise.resolve(null);

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
    hasLive: !!live,
    health: async () => {
      const idx = await staticIndex();
      return { demo: !!idx.demo, static: true, generated_at: idx.generated_at, count: idx.stocks.length, live: !!live };
    },
    /* Resolves to the live server's /api/health, or null if there is none / it is down. */
    liveHealth: () => livePromise,
    search: async (q) => {
      const s = q.trim().toUpperCase();
      const { stocks } = await staticIndex();
      const local = stocks
        .filter((x) => x.symbol.includes(s) || x.name.toUpperCase().includes(s))
        .sort((a, b) => (b.symbol.startsWith(s) || b.name.toUpperCase().startsWith(s)) - (a.symbol.startsWith(s) || a.name.toUpperCase().startsWith(s)))
        .slice(0, 10)
        .map((x) => ({ symbol: x.symbol, name: x.name, exchange: x.exchange }));
      if (!live || !(await livePromise)) return local;
      // Live search covers every listed stock, not just the snapshot.
      const remote = await live.search(q, { timeout: 5000 }).catch(() => []);
      const seen = new Set(local.map((x) => x.symbol));
      return [...local, ...remote.filter((x) => !seen.has(x.symbol))].slice(0, 12);
    },
    /* Snapshot first (instant); onLive(report) fires later with the live report, if available. */
    report: async (q, { onLive } = {}) => {
      const hit = await resolve(q);
      if (hit) {
        const snap = await getJSON(`data/reports/${fileName(hit.symbol)}.json`, { notFound: `Report for ${hit.symbol} is missing.` });
        if (live && onLive) {
          livePromise.then((up) => (up ? live.report(hit.symbol) : null)).then((r) => r && onLive(r)).catch(() => {});
        }
        return { ...snap, _origin: "snapshot" };
      }
      if (live) {
        const up = await livePromise;
        if (!up) {
          // Retry once: the server may have finished waking up since the page loaded.
          livePromise = live.health({ timeout: 75000 }).catch(() => null);
          if (!(await livePromise)) throw new Error(`"${q}" isn't in today's snapshot and the live data server is not responding. Try again in a minute.`);
        }
        return live.report(q, { timeout: 90000 });
      }
      throw new Error(`"${q}" isn't in the stocks published on this site. Run InvestIQ on your computer (python -m investiq) to research any stock.`);
    },
    listAll: async () => (await staticIndex()).stocks,
  };

  const backend = isStatic ? pages : server;

  /* Side-by-side comparison, built from full reports (same in all modes). */
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
