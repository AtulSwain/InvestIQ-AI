/* Discover: idea generation. Ready-made screens ("themes") over the tracked universe, each one
   explaining its rules, with the top matches and a link to open it in the Screener.
   Presets are shared with the Screener (window.screenPresets). */
(function () {
  const { esc } = fmt;
  const data = window.investiqData;

  // filters: [key, op, value]; sort: [key, "desc"|"asc"]
  const PRESETS = [
    { id: "quality-fair", name: "Quality at a fair price", why: "High returns on capital, low debt and a price no higher than InvestIQ's fair-value range.",
      filters: [["roe_pct", ">=", 15], ["debt_to_equity", "<=", 1], ["margin_of_safety_pct", ">=", -10]], sort: ["score", "desc"] },
    { id: "undervalued", name: "Undervalued by our models", why: "Price at least 15% below the blended fair-value estimate. Check why the market disagrees.",
      filters: [["margin_of_safety_pct", ">=", 15]], sort: ["margin_of_safety_pct", "desc"] },
    { id: "compounders", name: "Steady compounders", why: "Revenue and profit both growing 12%+ a year with healthy margins.",
      filters: [["revenue_cagr_pct", ">=", 12], ["profit_cagr_pct", ">=", 12], ["net_margin_pct", ">=", 10]], sort: ["profit_cagr_pct", "desc"] },
    { id: "dividend", name: "Dividend payers", why: "Dividend yield of 2%+ with a Piotroski score of 6+ (finances not deteriorating).",
      filters: [["dividend_yield_pct", ">=", 2], ["piotroski", ">=", 6]], sort: ["dividend_yield_pct", "desc"] },
    { id: "momentum", name: "Momentum leaders", why: "Best 1-year price performance. Momentum persists on average but reverses sharply.",
      filters: [["return_1y_pct", ">=", 20]], sort: ["return_1y_pct", "desc"] },
    { id: "low-vol", name: "Low volatility", why: "Smallest price swings - useful for defensive positions.",
      filters: [["volatility_pct", "<=", 25]], sort: ["volatility_pct", "asc"] },
    { id: "beaten-down", name: "Beaten-down quality", why: "Strong businesses (score 6+) whose share price fell 20%+ over the year. Possible opportunities or value traps.",
      filters: [["score", ">=", 6], ["return_1y_pct", "<=", -20]], sort: ["return_1y_pct", "asc"] },
    { id: "cash-machines", name: "Cash machines", why: "Free-cash-flow yield of 5%+ - the business generates plenty of cash relative to its price.",
      filters: [["fcf_yield_pct", ">=", 5]], sort: ["fcf_yield_pct", "desc"] },
  ];
  const OPS = { ">=": (a, b) => a >= b, "<=": (a, b) => a <= b, ">": (a, b) => a > b, "<": (a, b) => a < b, "=": (a, b) => a === b };
  function applyScreen(rows, filters, sort, market) {
    let out = rows.filter((r) => (!market || market === "ALL" || r.market === market)
      && filters.every(([k, op, v]) => r[k] != null && (typeof v === "string" ? r[k] === v : OPS[op](r[k], v))));
    if (sort) out = out.sort((a, b) => ((a[sort[0]] ?? -Infinity) - (b[sort[0]] ?? -Infinity)) * (sort[1] === "asc" ? 1 : -1));
    return out;
  }
  window.screenPresets = { PRESETS, applyScreen };

  const LABELS = { roe_pct: "ROE", debt_to_equity: "D/E", margin_of_safety_pct: "Margin of safety", revenue_cagr_pct: "Revenue CAGR",
    profit_cagr_pct: "Profit CAGR", net_margin_pct: "Net margin", dividend_yield_pct: "Div. yield", piotroski: "Piotroski",
    return_1y_pct: "1Y return", volatility_pct: "Volatility", score: "Score", fcf_yield_pct: "FCF yield" };
  const unitOf = (k) => (k.endsWith("_pct") ? "%" : "");

  function themeCard(p, rows) {
    const hits = applyScreen(rows, p.filters, p.sort);
    const k = p.sort[0];
    return `<div class="card"><div class="card-head"><h2>${esc(p.name)}</h2><span class="badge accent">${hits.length}</span></div>
      <p class="muted" style="font-size:12.5px;margin:0 0 6px">${esc(p.why)}</p>
      <div class="chips" style="margin-bottom:8px">${p.filters.map(([fk, op, v]) => `<span class="chip">${esc(LABELS[fk] || fk)} ${op} ${v}${unitOf(fk)}</span>`).join("")}</div>
      ${hits.length ? hits.slice(0, 5).map((r) => `<div class="list-row" data-open="${esc(r.symbol)}">
          <span class="nm"><span class="ticker">${esc(r.symbol.replace(/\.NS$/, ""))}</span> <span class="muted">${esc(r.name)}</span></span>
          <span class="muted num">${esc(LABELS[k] || k)} ${k.endsWith("_pct") ? fmt.pct(r[k], 1, false) : fmt.n(r[k], 1)}</span>
          <span>${ui.sig(r.signals?.[k])}</span></div>`).join("") : `<p class="muted" style="font-size:12.5px">No tracked stock passes today.</p>`}
      <div style="margin-top:8px"><a class="btn sm" href="#/screener/${p.id}">Open in Screener →</a></div></div>`;
  }

  window.views.discover = {
    title: "Discover",
    async render(el, arg, ctx) {
      el.innerHTML = `<div class="page-head"><div><div class="crumbs">Discover</div><h1>Discover ideas</h1>
        <p class="sub muted">Ready-made screens over the tracked universe. Each is a starting point for research, not a recommendation.</p></div>
        <div id="dc-mkt"></div></div><div id="dc-recent"></div><div id="dc-body"></div>
        <p class="disclaimer">Screens use InvestIQ's calculated metrics, which can be wrong for banks, loss-makers and companies with unusual accounting. Always open the full research page.</p>`;
      const recent = store.recent.all();
      if (recent.length) el.querySelector("#dc-recent").innerHTML = `<div class="card section"><h2>Recently researched</h2><div class="chips">${recent.map((r) => `<a class="chip" href="#/research/${encodeURIComponent(r.symbol)}"><span class="ticker">${esc(r.symbol)}</span> <span class="muted">${esc(r.name || "")}</span></a>`).join("")}</div></div>`;
      let market = "ALL";
      const uni = await ui.fill(el.querySelector("#dc-body"), () => data.universe(), (u) => `<div class="grid grid-2">${PRESETS.map((p) => themeCard(p, u.stocks)).join("")}</div>
        <p class="prov">${u.stocks.length} tracked stocks · ${u.origin === "snapshot" ? "daily snapshot " + fmt.date(u.generated_at) : "live"}</p>`, ctx, { lines: 8 });
      if (!uni) return;
      const mk = el.querySelector("#dc-mkt");
      mk.innerHTML = ui.seg([["ALL", "All"], ["IN", "India"], ["US", "US"]], market, "m");
      ui.bindChoice(mk, "m", (v) => {
        market = v;
        const rows = uni.stocks.filter((r) => market === "ALL" || r.market === market);
        el.querySelector("#dc-body .grid").innerHTML = PRESETS.map((p) => themeCard(p, rows)).join("");
      });
    },
  };
})();
