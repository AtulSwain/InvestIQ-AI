/* Compare: 2-4 companies side by side - rebased performance, every registry metric with the best
   value highlighted (direction-aware), valuation, risk, quarterly growth, and an AI comparison.
   #/compare/SYM1,SYM2,... */
(function () {
  const { esc } = fmt;
  const data = window.investiqData;

  const GROUPS = [
    ["Price & size", ["price", "change_pct", "market_cap"]],
    ["Valuation", ["pe", "forward_pe", "pb", "ps", "peg", "ev_ebitda", "ev_sales", "fcf_yield_pct", "earnings_yield_pct", "dividend_yield_pct", "fair_value", "margin_of_safety_pct", "implied_growth_pct"]],
    ["Profitability", ["roe_pct", "roce_pct", "roic_pct", "gross_margin_pct", "operating_margin_pct", "net_margin_pct"]],
    ["Growth", ["revenue_cagr_pct", "profit_cagr_pct", "revenue_growth_pct"]],
    ["Financial health", ["debt_to_equity", "current_ratio", "interest_coverage", "free_cash_flow", "piotroski", "altman_z"]],
    ["Returns & risk", ["return_1y_pct", "cagr_5y_pct", "cagr_10y_pct", "volatility_pct", "max_drawdown_pct", "beta"]],
    ["InvestIQ", ["score", "checklist_passed", "insiders_pct", "institutions_pct"]],
  ];
  // Which direction is "better" for highlighting; anything not listed is not ranked.
  const HIGHER = new Set(["fcf_yield_pct", "earnings_yield_pct", "dividend_yield_pct", "margin_of_safety_pct", "roe_pct", "roce_pct", "roic_pct", "gross_margin_pct",
    "operating_margin_pct", "net_margin_pct", "revenue_cagr_pct", "profit_cagr_pct", "revenue_growth_pct", "current_ratio", "interest_coverage", "piotroski", "altman_z",
    "return_1y_pct", "cagr_5y_pct", "cagr_10y_pct", "max_drawdown_pct", "score", "checklist_passed"]);
  const LOWER = new Set(["pe", "forward_pe", "pb", "ps", "peg", "ev_ebitda", "ev_sales", "debt_to_equity", "volatility_pct"]);
  const RANGES = [["1Y", 12], ["3Y", 36], ["5Y", 60], ["10Y", 120], ["MAX", null]];

  function best(key, vals) {
    const v = vals.filter((x) => x != null && !(LOWER.has(key) && x <= 0));
    if (v.length < 2) return null;
    if (HIGHER.has(key)) return Math.max(...v);
    if (LOWER.has(key)) return Math.min(...v);
    return null;
  }

  window.views.compare = {
    title: "Compare",
    async render(el, arg, ctx) {
      const symbols = (arg || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 4);
      el.innerHTML = `<div class="page-head"><div><div class="crumbs">Research</div><h1>Compare companies</h1><p class="sub muted">Up to 4 stocks side by side. The best value in each row is highlighted.</p></div></div>
        <div class="card section"><form id="cmp-form" class="row" autocomplete="off">
          <div class="chips">${symbols.map((s, i) => `<button type="button" class="chip" data-rm="${i}">${esc(s)} <span class="x">×</span></button>`).join("")}</div>
          <input id="cmp-input" type="text" placeholder="Add a stock, e.g. TCS" style="min-width:200px" ${symbols.length >= 4 ? "disabled" : ""}>
          <button class="btn primary" type="submit" ${symbols.length >= 4 ? "disabled" : ""}>Add</button></form><div id="cmp-sugg"></div></div>
        <div id="cmp-body"></div>`;
      const $ = (s) => el.querySelector(s);
      const go = (list) => ui.go("#/compare/" + list.map(encodeURIComponent).join(","));
      $("#cmp-form").addEventListener("submit", (e) => { e.preventDefault(); const v = $("#cmp-input").value.trim(); if (v && !symbols.includes(v)) go([...symbols, v]); });
      $("#cmp-form").addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (b) go(symbols.filter((_, i) => i !== +b.dataset.rm)); });
      let timer;
      $("#cmp-input").addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const v = $("#cmp-input").value.trim();
          const res = v ? await data.search(v).catch(() => []) : [];
          $("#cmp-sugg").innerHTML = res.slice(0, 6).map((s) => `<button type="button" class="chip" data-add="${esc(s.symbol)}" style="margin:6px 6px 0 0"><span class="ticker">${esc(s.symbol)}</span> <span class="muted">${esc(s.name)}</span></button>`).join("");
        }, 200);
      });
      $("#cmp-sugg").addEventListener("click", (e) => { const b = e.target.closest("[data-add]"); if (b && !symbols.includes(b.dataset.add)) go([...symbols, b.dataset.add]); });

      const body = $("#cmp-body");
      if (symbols.length < 2) {
        const wl = store.watchlists.symbols().slice(0, 4);
        body.innerHTML = ui.empty("Add at least two stocks", `Try <a href="#/compare/RELIANCE.NS,ONGC.NS">Reliance vs ONGC</a>, <a href="#/compare/TCS.NS,INFY.NS,HCLTECH.NS">TCS vs Infosys vs HCL</a> or <a href="#/compare/AAPL,MSFT,GOOGL">Apple vs Microsoft vs Alphabet</a>.`,
          wl.length >= 2 ? `<a class="btn" href="#/compare/${wl.map(encodeURIComponent).join(",")}">Compare my watchlist</a>` : "", "compare");
        return;
      }
      body.innerHTML = `${ui.skeleton(3, true)}${ui.skeleton(8, false)}`;
      const rows = await data.compare(symbols);
      if (!ctx.alive()) return;
      const ok = rows.filter((s) => !s.error), bad = rows.filter((s) => s.error);
      if (ok.length < 2) { body.innerHTML = bad.map((b) => ui.errorBox(`${b.query}: ${b.error}`)).join(""); return; }
      const curs = new Set(ok.map((s) => s.currency));
      const cell = (s, k) => {
        const m = s.report.metrics[k];
        if (!m) return "—";
        return `<span title="${esc(ui.provText(m, s.report))}">${k === "change_pct" ? ui.chg(m.value) : ui.fmtUnit(m.value, m.unit, m.currency)}</span>`;
      };
      body.innerHTML = `
        ${bad.map((b) => `<p class="callout">Could not load ${esc(b.query)}: ${esc(b.error)}</p>`).join("")}
        ${curs.size > 1 ? `<p class="callout info">These stocks report in different currencies (${[...curs].join(", ")}). Ratios and percentages compare directly; money amounts do not.</p>` : ""}
        <section class="card section"><div class="card-head"><h2>Growth of 100</h2><div class="seg" id="cmp-seg">${RANGES.map(([l]) => `<button type="button" data-range="${l}">${l}</button>`).join("")}</div></div>
          <div class="legend">${ok.map((s, i) => `<span><span class="swatch" style="background:var(${charts.SERIES[i]})"></span> ${esc(s.symbol)}</span>`).join("")}</div>
          <div class="chart-box tall"><canvas id="cmp-chart" aria-label="Comparison chart"></canvas></div></section>
        <section class="card section"><div class="card-head"><h2>Side by side</h2><button class="btn sm" id="cmp-csv">${ui.icon("download")} CSV</button></div>
          <div class="table-wrap"><table class="compact"><thead><tr><th class="l">Metric</th>${ok.map((s) => `<th><a class="ticker" href="#/research/${encodeURIComponent(s.symbol)}">${esc(s.symbol)}</a><div class="muted" style="font-weight:400;text-transform:none">${esc(s.name)}</div></th>`).join("")}</tr></thead>
          <tbody>
            <tr><td class="l">Sector</td>${ok.map((s) => `<td>${esc(s.report.fundamentals.sector || "—")}</td>`).join("")}</tr>
            <tr><td class="l">Valuation verdict</td>${ok.map((s) => `<td>${esc(s.report.valuation.verdict)}</td>`).join("")}</tr>
            <tr><td class="l">Risk profile</td>${ok.map((s) => `<td>${s.report.risk_profile ? `${esc(s.report.risk_profile.level)} · ${fmt.n(s.report.risk_profile.overall, 1)}/10` : "—"}</td>`).join("")}</tr>
            ${GROUPS.map(([g, keys]) => `<tr><td class="l" colspan="${ok.length + 1}" style="padding-top:12px"><strong>${g}</strong></td></tr>
              ${keys.filter((k) => ok.some((s) => s.report.metrics[k])).map((k) => {
                const vals = ok.map((s) => s.report.metrics[k]?.value ?? null);
                const b = best(k, vals);
                const label = ok.map((s) => s.report.metrics[k]).find(Boolean).label;
                return `<tr><td class="l">${glossary.T(label)}</td>${ok.map((s, i) => `<td ${b != null && vals[i] === b ? 'style="background:var(--accent-soft);font-weight:600"' : ""}>${cell(s, k)} ${ui.sig(s.report.metrics[k]?.signal)}</td>`).join("")}</tr>`;
              }).join("")}`).join("")}
            <tr><td class="l" colspan="${ok.length + 1}" style="padding-top:12px"><strong>Strengths & risks</strong></td></tr>
            <tr><td class="l">Strengths</td>${ok.map((s) => `<td class="wrap l" style="font-size:11.5px">${s.report.scorecard.strengths.map(esc).join("<br>") || "—"}</td>`).join("")}</tr>
            <tr><td class="l">Risks</td>${ok.map((s) => `<td class="wrap l" style="font-size:11.5px">${s.report.scorecard.risks.map(esc).join("<br>") || "—"}</td>`).join("")}</tr>
          </tbody></table></div><p class="prov">Hover any value for its source and period. Highlight = best in row (lower is better for valuation multiples, debt and volatility).</p></section>
        <section class="card section"><div class="card-head"><h2>AI comparison</h2><span class="muted" style="font-size:12px" id="cmp-ai-st"></span></div>
          <div id="cmp-ai"><button class="btn primary" id="cmp-ai-btn">${ui.icon("ai")} Compare these companies with AI</button></div></section>
        <p class="disclaimer">Comparison of calculated metrics from public data. Research tool, not investment advice.</p>`;

      let range = "5Y";
      const draw = () => {
        el.querySelectorAll("#cmp-seg button").forEach((b) => b.classList.toggle("on", b.dataset.range === range));
        const months = RANGES.find(([l]) => l === range)[1];
        const last = ok.map((s) => s.chart.dates.at(-1)).sort().at(-1);
        const d = new Date(last + "T00:00:00");
        let start = "0000-00-00";
        if (months) { d.setMonth(d.getMonth() - months); start = d.toISOString().slice(0, 10); }
        else start = ok.map((s) => s.chart.dates[0]).sort().at(-1); // MAX: common start
        charts.compare($("#cmp-chart"), ok, start);
      };
      $("#cmp-seg").addEventListener("click", (e) => { const b = e.target.closest("[data-range]"); if (b) { range = b.dataset.range; draw(); } });
      draw();
      $("#cmp-csv").addEventListener("click", () => {
        const keys = GROUPS.flatMap(([, k]) => k);
        ui.downloadCSV(`investiq-compare-${ok.map((s) => s.symbol).join("-")}.csv`, keys.map((k) => ({ metric: k, ...Object.fromEntries(ok.map((s) => [s.symbol, s.report.metrics[k]?.value])) })));
      });
      $("#cmp-ai-btn").addEventListener("click", async () => {
        $("#cmp-ai").innerHTML = ui.loading("Comparing with cited evidence - up to a minute…");
        try {
          const q = `Compare ${ok.map((s) => `${s.name} (${s.symbol})`).join(", ")} as investments: business quality, growth, profitability, balance sheet, valuation, recent news and risks. End with which looks strongest on which dimension and what would change that view.`;
          const res = await data.aiAsk(q, ok.map((s) => s.symbol), true);
          if (!ctx.alive()) return;
          $("#cmp-ai").innerHTML = ui.aiAnswer(res, "cmp");
        } catch (err) { if (ctx.alive()) $("#cmp-ai").innerHTML = ui.errorBox(err); }
      });
    },
  };
})();
