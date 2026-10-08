/* Data layer. Three ways to get data, one interface:
   - server:  the page is served by the FastAPI app itself (python -m investiq) - any stock, live.
   - static:  GitHub Pages - pre-built JSON (reports, index, market) refreshed by a scheduled workflow.
   - hybrid:  GitHub Pages + INVESTIQ_CONFIG.apiBase pointing at the hosted FastAPI app.
              Snapshot data renders instantly and live data replaces it when it arrives; features
              that need computation (AI, portfolio analytics, thesis checks, any-stock research)
              use the live server. If it is asleep or down, the snapshot still works.
   Every function returns plain JSON produced by the Python backend - the browser only displays. */
(function () {
  const cfg = window.INVESTIQ_CONFIG || {};
  const isStatic = !!cfg.static;
  const apiBase = String(cfg.apiBase || "").replace(/\/+$/, "");
  const cache = new Map();

  async function request(url, { notFound, timeout = 30000, fresh = false, method = "GET", body } = {}) {
    const key = method === "GET" ? url : null;
    if (key && !fresh && cache.has(key)) return cache.get(key);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    let res;
    try {
      res = await fetch(url, {
        method, signal: ctl.signal,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new Error(err.name === "AbortError" ? "The data server took too long to respond." : "Could not reach the data server.");
    } finally {
      clearTimeout(timer);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(res.status === 404 && notFound ? notFound : data.detail || `Request failed (${res.status})`);
    if (key) cache.set(key, data);
    return data;
  }

  // Must match investiq.build_static.report_filename
  const fileName = (symbol) => symbol.toUpperCase().replace(/[^A-Z0-9.\-]/g, "_");

  function makeApi(base) {
    const u = (path) => (base ? `${base}/${path}` : path);
    const get = (path, opts) => request(u(path), opts);
    const post = (path, body, opts) => request(u(path), { method: "POST", body, timeout: 90000, ...opts });
    return {
      health: (opts) => get("api/health", { fresh: true, ...opts }),
      search: async (q, opts) => (await get(`api/search?q=${encodeURIComponent(q)}`, opts)).results,
      report: async (q, opts) => ({ ...(await get(`api/report/${encodeURIComponent(q)}`, { timeout: 90000, ...opts })), _origin: "live" }),
      quote: (q, opts) => get(`api/quote/${encodeURIComponent(q)}`, { fresh: true, ...opts }),
      overview: () => get("api/market/overview", { timeout: 60000 }),
      movers: () => get("api/market/movers", { timeout: 120000 }),
      macro: () => get("api/market/macro", { timeout: 60000 }),
      earnings: () => get("api/market/earnings", { timeout: 120000 }),
      news: (symbols) => get(`api/market/news${symbols ? `?symbols=${encodeURIComponent(symbols.join(","))}` : ""}`, { timeout: 60000 }),
      peers: (sym) => get(`api/peers/${encodeURIComponent(sym)}`, { timeout: 120000 }),
      screener: () => get("api/screener", { timeout: 180000 }),
      portfolio: (holdings, base) => post("api/portfolio", { holdings, base }),
      thesis: (symbol, assumptions, since) => post("api/thesis/check", { symbol, assumptions, since }),
      aiAsk: (question, symbols, web_search) => post("api/ai/ask", { question, symbols, web_search }, { timeout: 240000 }),
      aiSummary: (sym) => get(`api/ai/summary/${encodeURIComponent(sym)}`, { timeout: 240000 }),
    };
  }

  /* `api` is the live FastAPI server, if there is one: same origin (server mode) or apiBase (hybrid). */
  const api = !isStatic ? makeApi("") : apiBase ? makeApi(apiBase) : null;
  // Free hosts sleep when idle; the first request can take ~30-60 s. Wake it as soon as the page loads.
  let livePromise = api ? api.health({ timeout: isStatic ? 75000 : 20000 }).catch(() => null) : Promise.resolve(null);
  async function liveUp() {
    if (!api) return false;
    if (await livePromise) return true;
    livePromise = api.health({ timeout: 75000 }).catch(() => null); // retry once - it may have woken up
    return !!(await livePromise);
  }
  const needLive = (what) => new Error(`${what} needs the live InvestIQ server${isStatic && !apiBase
    ? ". This site is a daily snapshot - run InvestIQ on your computer or connect a hosted server (see README)."
    : ", which is not responding right now. Try again in a minute."}`);

  /* ---------------- snapshot files (GitHub Pages) ---------------- */
  const snapIndex = () => request("data/index.json");
  const snapMarket = () => request("data/market.json", { notFound: "Market snapshot not published yet." });

  async function resolveSnapshot(q) {
    const s = q.trim().toUpperCase();
    const { stocks } = await snapIndex();
    return (
      stocks.find((x) => x.symbol === s) ||
      stocks.find((x) => x.symbol.split(".")[0] === s) ||
      stocks.find((x) => x.name.toUpperCase() === s) ||
      stocks.find((x) => x.name.toUpperCase().startsWith(s)) ||
      (s.length >= 3 && stocks.find((x) => x.name.toUpperCase().includes(s))) ||
      null
    );
  }

  const data = {
    isStatic,
    hasLive: !!api,
    mode: !isStatic ? "server" : apiBase ? "hybrid" : "static",

    async health() {
      if (!isStatic) return { ...(await api.health()), static: false };
      const idx = await snapIndex();
      return { demo: !!idx.demo, static: true, generated_at: idx.generated_at, count: idx.stocks.length, live: !!api };
    },
    /* The live server's /api/health, or null if there is none / it is down. */
    liveHealth: () => livePromise,
    liveUp,

    async search(q) {
      if (!isStatic) return api.search(q);
      const s = q.trim().toUpperCase();
      const { stocks } = await snapIndex();
      const local = stocks
        .filter((x) => x.symbol.includes(s) || x.name.toUpperCase().includes(s))
        .sort((a, b) => (b.symbol.startsWith(s) || b.name.toUpperCase().startsWith(s)) - (a.symbol.startsWith(s) || a.name.toUpperCase().startsWith(s)))
        .slice(0, 10)
        .map((x) => ({ symbol: x.symbol, name: x.name, exchange: x.exchange }));
      if (!api || !(await livePromise)) return local;
      const remote = await api.search(q, { timeout: 5000 }).catch(() => []);
      const seen = new Set(local.map((x) => x.symbol));
      return [...local, ...remote.filter((x) => !seen.has(x.symbol))].slice(0, 12);
    },

    /* Full report. Static: snapshot first; onLive(report) fires later with the live one if available. */
    async report(q, { onLive, fresh = false } = {}) {
      if (!isStatic) return api.report(q, { fresh });
      const hit = await resolveSnapshot(q);
      if (hit) {
        const snap = await request(`data/reports/${fileName(hit.symbol)}.json`, { notFound: `Report for ${hit.symbol} is missing.`, fresh });
        if (api && onLive) livePromise.then((up) => (up ? api.report(hit.symbol) : null)).then((r) => r && onLive(r)).catch(() => {});
        return { ...snap, _origin: "snapshot" };
      }
      if (await liveUp()) return api.report(q, { fresh });
      throw api ? needLive(`"${q}" isn't in today's snapshot, and researching it`) :
        new Error(`"${q}" isn't in the stocks published on this site. Run InvestIQ on your computer (python -m investiq) to research any stock.`);
    },

    /* Newest available report, bypassing the page cache (alerts engine): live server first, else snapshot. */
    async freshReport(q) {
      if (api && (await liveUp())) return api.report(q, { fresh: true });
      return data.report(q, { fresh: true });
    },

    /* Screener / dashboard universe rows (every registry metric per stock). */
    async universe() {
      if (!isStatic) return { ...(await api.screener()), origin: "live" };
      const idx = await snapIndex();
      return { stocks: idx.stocks, generated_at: idx.generated_at, origin: "snapshot" };
    },
    listAll: async () => (isStatic ? (await snapIndex()).stocks : null),

    /* Dashboard bundle: {overview, movers, macro, earnings, news}. */
    async market({ onLive } = {}) {
      if (!isStatic) {
        const [overview, movers, macro, earnings, news] = await Promise.allSettled(
          [api.overview(), api.movers(), api.macro(), api.earnings(), api.news()]);
        const v = (r) => (r.status === "fulfilled" ? r.value : null);
        return { overview: v(overview), movers: v(movers), macro: v(macro), earnings: v(earnings)?.items || [],
          news: v(news)?.items || [], origin: "live", errors: [overview, movers, macro, earnings, news].filter((r) => r.status === "rejected").map((r) => r.reason.message) };
      }
      const snap = { ...(await snapMarket()), origin: "snapshot" };
      if (api && onLive) {
        livePromise.then(async (up) => {
          if (!up) return;
          const [overview, movers] = await Promise.all([api.overview().catch(() => null), api.movers().catch(() => null)]);
          if (overview || movers) onLive({ ...snap, overview: overview || snap.overview, movers: movers || snap.movers, origin: "live" });
        }).catch(() => {});
      }
      return snap;
    },

    /* One piece of the dashboard ("overview" | "movers" | "macro" | "earnings" | "news") so cards load independently.
       Snapshot pieces resolve instantly; onLive(value) delivers fresher live data when available. */
    async marketPart(name, { onLive } = {}) {
      const live = { overview: () => api.overview(), movers: () => api.movers(), macro: () => api.macro(),
        earnings: async () => (await api.earnings()).items, news: async () => (await api.news()).items };
      if (!isStatic) return live[name]();
      const snap = await snapMarket().catch(() => ({}));
      if (api && onLive && ["overview", "movers"].includes(name)) {
        livePromise.then((up) => (up ? live[name]() : null)).then((v) => v && onLive(v)).catch(() => {});
      }
      return snap[name] ?? null;
    },

    async news(symbols) {
      if (!isStatic || (await liveUp())) return (await api.news(symbols)).items;
      const m = await snapMarket();
      return symbols ? m.news.filter((n) => symbols.includes(n.symbol)) : m.news;
    },

    async peers(report) {
      if (report.peers) return report.peers;
      if (api && (await liveUp())) return api.peers(report.symbol);
      throw needLive("Peer analysis");
    },

    async portfolio(holdings, base) {
      if (api && (await liveUp())) return api.portfolio(holdings, base);
      throw needLive("Portfolio analytics");
    },

    async thesis(symbol, assumptions, since) {
      if (api && (await liveUp())) return api.thesis(symbol, assumptions, since);
      // Snapshot fallback: compare against the published metrics (no new-developments scan).
      const r = await data.report(symbol);
      const ops = { ">": (a, b) => a > b, ">=": (a, b) => a >= b, "<": (a, b) => a < b, "<=": (a, b) => a <= b, "==": (a, b) => a === b };
      const res = assumptions.map((a) => {
        const m = r.metrics[a.metric];
        if (!m || m.value == null || !ops[a.op]) return { ...a, label: m ? m.label : a.metric, status: "unknown", current: m?.value ?? null, reason: "No data" };
        return { ...a, label: m.label, current: m.value, source: m.source, period: m.period,
          status: ops[a.op](m.value, Number(a.value)) ? "holds" : "broken", reason: `Now ${m.value} vs required ${a.op} ${a.value}` };
      });
      const broken = res.filter((x) => x.status === "broken").length;
      return { symbol: r.symbol, status: broken ? "conflict" : "intact", assumptions: res, developments: [],
        headline: broken ? `${broken} assumption(s) no longer hold.` : "All measurable assumptions still hold (snapshot data; news scan needs the live server).",
        checked_at: r.generated_at, snapshot: true };
    },

    async aiStatus() {
      if (!api) return { available: false, reason: "AI research needs the live InvestIQ server with an Anthropic API key." };
      const h = await livePromise;
      if (!h) return { available: false, reason: "The live server is not responding right now." };
      return h.ai && h.ai.configured ? { available: true, model: h.ai.model }
        : { available: false, reason: "The server has no ANTHROPIC_API_KEY configured." };
    },
    async aiAsk(question, symbols, webSearch = true) {
      if (!api || !(await liveUp())) throw needLive("AI research");
      return api.aiAsk(question, symbols, webSearch);
    },
    async aiSummary(symbol) {
      if (!api || !(await liveUp())) throw needLive("AI research");
      return api.aiSummary(symbol);
    },

    /* Side-by-side comparison rows, built from full reports (same in all modes). */
    async compare(queries) {
      const settled = await Promise.allSettled(queries.map((q) => data.report(q)));
      return settled.map((res, i) => {
        if (res.status === "rejected") return { query: queries[i], error: res.reason.message };
        const r = res.value;
        const m = Object.fromEntries(Object.entries(r.metrics || {}).map(([k, v]) => [k, v.value]));
        return { query: queries[i], symbol: r.symbol, name: r.name, currency: r.currency, report: r, metrics: m,
          chart: { dates: r.chart.dates, close: r.chart.close }, disclaimer: r.disclaimer };
      });
    },
  };

  window.investiqData = data;
})();
