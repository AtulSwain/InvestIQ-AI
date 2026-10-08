/* Portfolio intelligence: holdings editor, P&L, allocation by holding / sector / country,
   concentration, beta, volatility, drawdown, correlation, weighted P/E and warnings.
   Analytics run on the live server (POST /api/portfolio); on a snapshot-only site a simpler
   client-side valuation from published reports is shown and labelled as such. */
(function () {
  const { esc } = fmt;
  const data = window.investiqData;

  const bars = (rows, cur) => rows.map((a) => `<div class="score-bar" style="grid-template-columns:minmax(90px,160px) 1fr 70px">
      <span class="nm" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(a.name)}">${esc(a.name)}</span>
      <div class="track"><div class="fill" style="width:${Math.min(100, a.weight_pct)}%"></div></div><span class="val">${fmt.pct(a.weight_pct, 1, false)}</span></div>`).join("");

  /* Snapshot fallback: value holdings from published reports (no risk analytics). */
  async function clientAnalysis(holdings, base) {
    let usdinr = null;
    try { usdinr = (await data.marketPart("overview"))?.instruments.find((i) => i.symbol === "INR=X")?.last ?? null; } catch { /* none */ }
    const fxError = usdinr != null && !(usdinr > 40 && usdinr < 200); // demo data / bad tick: don't convert with it
    if (fxError) usdinr = null;
    const rate = (cur) => (cur === base ? 1 : !usdinr ? 1 : base === "INR" ? usdinr : 1 / usdinr);
    const rows = [], errors = [];
    if (fxError || (!usdinr && new Set(holdings.map((h) => /\.(NS|BO)$/i.test(h.symbol))).size > 1)) errors.push("No reliable USD/INR rate - INR and USD holdings are added without currency conversion.");
    const reps = await Promise.allSettled(holdings.map((h) => data.report(h.symbol)));
    reps.forEach((res, i) => {
      const h = holdings[i];
      if (res.status !== "fulfilled") { errors.push(`${h.symbol}: ${res.reason.message}`); return; }
      const r = res.value, fx = rate(r.currency), qty = +h.quantity, cost = +h.avg_cost || 0, price = r.quote.price;
      rows.push({ symbol: r.symbol, name: r.name, currency: r.currency, sector: r.fundamentals.sector || "Other", country: r.market === "IN" ? "India" : "United States",
        quantity: qty, avg_cost: cost, price, value: qty * price * fx, cost: cost ? qty * cost * fx : null, pnl: cost ? qty * (price - cost) * fx : null,
        pnl_pct: cost ? (price / cost - 1) * 100 : null, day_change: qty * r.quote.change * fx, day_change_pct: r.quote.change_pct, pe: r.metrics.pe?.value ?? null });
    });
    const total = rows.reduce((a, r) => a + r.value, 0);
    if (!total) return { holdings: rows, totals: null, errors };
    rows.forEach((r) => { r.weight_pct = (r.value / total) * 100; });
    const alloc = (k) => Object.entries(rows.reduce((o, r) => ({ ...o, [r[k]]: (o[r[k]] || 0) + r.value }), {})).map(([name, v]) => ({ name, value: v, weight_pct: (v / total) * 100 })).sort((a, b) => b.value - a.value);
    const cost = rows.reduce((a, r) => a + (r.cost || 0), 0), pnl = rows.reduce((a, r) => a + (r.pnl || 0), 0);
    const w = rows.map((r) => r.weight_pct / 100), hhi = w.reduce((a, x) => a + x * x, 0);
    const pes = rows.filter((r) => r.pe > 0);
    const flags = [];
    const top = rows.reduce((a, r) => (r.value > a.value ? r : a));
    if (top.weight_pct > 25) flags.push(`${top.symbol} is ${top.weight_pct.toFixed(0)}% of the portfolio - high single-stock concentration.`);
    const sec = alloc("sector");
    if (sec[0]?.weight_pct > 40) flags.push(`${sec[0].name} is ${sec[0].weight_pct.toFixed(0)}% of the portfolio - high sector concentration.`);
    return { base_currency: base, usd_inr: usdinr, holdings: rows.sort((a, b) => b.value - a.value), errors, flags, snapshot: true,
      totals: { value: total, cost: cost || null, pnl: cost ? pnl : null, pnl_pct: cost ? (pnl / cost) * 100 : null, day_change: rows.reduce((a, r) => a + r.day_change, 0) },
      allocation: { sector: sec, country: alloc("country"), holding: rows.map((r) => ({ name: r.symbol, value: r.value, weight_pct: r.weight_pct })) },
      risk: { hhi, effective_holdings: hhi ? 1 / hhi : null, weighted_pe: pes.length ? pes.reduce((a, r) => a + r.weight_pct, 0) / pes.reduce((a, r) => a + r.weight_pct / r.pe, 0) : null, correlation: { matrix: null } },
      method: "Snapshot valuation from published reports at the latest USD/INR close. Beta, volatility, drawdown and correlation need the live server." };
  }

  function results(a) {
    const base = a.base_currency, t = a.totals, rk = a.risk || {};
    if (!t) return ui.empty("Nothing to analyze", (a.errors || []).map(esc).join("<br>") || "Add holdings with a quantity above zero.");
    const corr = rk.correlation?.matrix;
    return `
      ${a.snapshot ? `<p class="callout info">${esc(a.method)}</p>` : ""}
      ${(a.errors || []).map((e) => `<p class="callout">${esc(e)}</p>`).join("")}
      <div class="grid grid-4 section">
        <div class="kpi"><div class="label">Value (${base})</div><div class="value">${fmt.big(t.value, base)}</div><div style="font-size:12px">${ui.chg(t.value ? (t.day_change / (t.value - t.day_change)) * 100 : null)} today</div></div>
        <div class="kpi"><div class="label">Unrealised P&L</div><div class="value ${fmt.signedClass(t.pnl)}">${t.pnl == null ? "—" : fmt.big(t.pnl, base)}</div><div style="font-size:12px">${ui.chg(t.pnl_pct, 1)} on ${t.cost ? fmt.big(t.cost, base) : "—"}</div></div>
        <div class="kpi"><div class="label">Beta · volatility</div><div class="value">${fmt.n(rk.beta, 2)} · ${rk.volatility_pct == null ? "—" : fmt.pct(rk.volatility_pct, 1, false)}</div><div class="muted" style="font-size:12px">1Y max drawdown ${rk.max_drawdown_1y_pct == null ? "—" : fmt.pct(rk.max_drawdown_1y_pct, 1)}</div></div>
        <div class="kpi"><div class="label">Diversification</div><div class="value">${fmt.n(rk.effective_holdings, 1)} <span class="muted" style="font-size:12px">effective holdings</span></div><div class="muted" style="font-size:12px">Weighted P/E ${fmt.n(rk.weighted_pe, 1)}${t.dividend_income != null ? ` · dividends ${fmt.big(t.dividend_income, base)}/yr` : ""}</div></div>
      </div>
      ${(a.flags || []).length ? `<div class="card section"><h2>Warnings</h2>${a.flags.map((f) => `<div class="insight"><span class="ico">!</span><div>${esc(f)}</div></div>`).join("")}</div>` : ""}
      <div class="card section"><div class="card-head"><h2>Holdings</h2><button class="btn sm" id="pf-csv">${ui.icon("download")} CSV</button></div>
        <div class="table-wrap"><table class="compact"><thead><tr><th class="l">Stock</th><th>Qty</th><th>Avg cost</th><th>Price</th><th>Value (${base})</th><th>Weight</th><th>Today</th><th>P&L (${base})</th><th>P&L %</th><th>P/E</th></tr></thead><tbody>
        ${a.holdings.map((h) => `<tr><td class="l"><a class="ticker" href="#/research/${encodeURIComponent(h.symbol)}">${esc(h.symbol)}</a> <span class="muted">${esc(h.name)}</span></td><td>${fmt.n(h.quantity, 0)}</td>
          <td>${h.avg_cost ? fmt.money(h.avg_cost, h.currency) : "—"}</td><td>${fmt.money(h.price, h.currency)}</td><td>${fmt.big(h.value, base)}</td><td>${fmt.pct(h.weight_pct, 1, false)}</td>
          <td>${ui.chg(h.day_change_pct)}</td><td class="${fmt.signedClass(h.pnl)}">${h.pnl == null ? "—" : fmt.big(h.pnl, base)}</td><td>${ui.chg(h.pnl_pct, 1)}</td><td>${fmt.n(h.pe, 1)}</td></tr>`).join("")}
        </tbody></table></div></div>
      <div class="grid grid-3 section">
        <div class="card"><h2>By holding</h2>${bars(a.allocation.holding)}</div>
        <div class="card"><h2>By sector</h2>${bars(a.allocation.sector)}</div>
        <div class="card"><h2>By country</h2>${bars(a.allocation.country)}${a.usd_inr ? `<p class="prov">USD/INR ${fmt.n(a.usd_inr, 2)}</p>` : ""}</div>
      </div>
      ${corr ? `<div class="card section"><h2>Correlation (1 year of daily returns)</h2><div class="table-wrap"><table class="compact"><thead><tr><th></th>${rk.correlation.symbols.map((s) => `<th>${esc(s.replace(/\.NS$/, ""))}</th>`).join("")}</tr></thead><tbody>
        ${corr.map((rw, i) => `<tr><td class="l"><strong>${esc(rk.correlation.symbols[i].replace(/\.NS$/, ""))}</strong></td>${rw.map((v, j) => `<td style="${i === j ? "" : ui.heatBg(v, 1)}">${i === j ? "—" : fmt.n(v, 2)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
        <p class="prov">1 = move together, 0 = unrelated, negative = opposite. Pairs above 0.8 offer little diversification.</p></div>` : ""}
      <p class="prov">${esc(a.method || "")}</p>`;
  }

  window.views.portfolio = {
    title: "Portfolio",
    async render(el, arg, ctx) {
      let base = store.get("portfolio_base", "INR");
      el.innerHTML = `<div class="page-head"><div><div class="crumbs">Monitor</div><h1>Portfolio intelligence</h1><p class="sub muted">Enter your holdings to see P&L, allocation, concentration and risk. Stored only in this browser.</p></div>
          <div class="row"><span id="pf-base"></span><button class="btn primary" id="pf-run">${ui.icon("refresh")} Analyze</button></div></div>
        <div class="card section"><div class="card-head"><h2>Holdings</h2><button class="btn sm" id="pf-ai">${ui.icon("ai")} Ask AI about my portfolio</button></div>
          <form id="pf-form" class="filters" autocomplete="off"><input id="pf-sym" placeholder="Symbol, e.g. TCS.NS or AAPL" required style="min-width:180px">
            <input id="pf-qty" type="number" min="0" step="any" placeholder="Quantity" required style="width:110px"><input id="pf-cost" type="number" min="0" step="any" placeholder="Avg cost (optional)" style="width:150px">
            <button class="btn sm" type="submit">${ui.icon("plus")} Add / update</button></form>
          <div id="pf-list"></div></div>
        <div id="pf-out"></div>
        <p class="disclaimer">Figures use delayed or end-of-day prices and may differ from your broker. Research tool, not investment advice.</p>`;
      const $ = (s) => el.querySelector(s);
      $("#pf-base").innerHTML = ui.seg([["INR", "₹ INR"], ["USD", "$ USD"]], base, "base");
      ui.bindChoice($("#pf-base"), "base", (v) => { base = v; store.set("portfolio_base", v); analyze(); });
      const paintList = () => {
        const hs = store.portfolio.holdings();
        $("#pf-list").innerHTML = hs.length ? `<div class="chips">${hs.map((h) => `<span class="chip"><span class="ticker">${esc(h.symbol)}</span> ${fmt.n(h.quantity, 0)}${h.avg_cost ? ` @ ${fmt.n(h.avg_cost, 2)}` : ""}
          <button class="icon-btn" data-edit="${h.id}" aria-label="Edit" style="width:18px;height:18px">✎</button><button class="icon-btn" data-rm="${h.id}" aria-label="Remove ${esc(h.symbol)}" style="width:18px;height:18px">${ui.icon("x")}</button></span>`).join("")}</div>`
          : `<p class="muted" style="font-size:12.5px">No holdings yet. Example: <button class="btn sm" id="pf-demo">Load a sample portfolio</button></p>`;
        $("#pf-demo")?.addEventListener("click", () => {
          [["RELIANCE.NS", 20, 2400], ["TCS.NS", 10, 3300], ["HDFCBANK.NS", 30, 1500], ["INFY.NS", 25, 1450], ["AAPL", 5, 170]].forEach(([symbol, quantity, avg_cost]) => store.portfolio.upsert({ symbol, quantity, avg_cost }));
          paintList(); analyze();
        });
      };
      $("#pf-list").addEventListener("click", (e) => {
        const rm = e.target.closest("[data-rm]"), ed = e.target.closest("[data-edit]");
        if (rm) { store.portfolio.remove(rm.dataset.rm); paintList(); analyze(); }
        if (ed) { const h = store.portfolio.holdings().find((x) => x.id === ed.dataset.edit); $("#pf-sym").value = h.symbol; $("#pf-qty").value = h.quantity; $("#pf-cost").value = h.avg_cost || ""; }
      });
      $("#pf-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const symbol = $("#pf-sym").value.trim().toUpperCase();
        const existing = store.portfolio.holdings().find((h) => h.symbol === symbol);
        store.portfolio.upsert({ ...(existing || {}), symbol, quantity: +$("#pf-qty").value, avg_cost: +$("#pf-cost").value || 0 });
        e.target.reset(); paintList(); analyze();
      });
      $("#pf-ai").addEventListener("click", () => {
        const hs = store.portfolio.holdings().slice(0, 4);
        if (!hs.length) { ui.toast("Add holdings first"); return; }
        ui.go(`#/ai/${hs.map((h) => encodeURIComponent(h.symbol)).join(",")}`);
      });
      $("#pf-run").addEventListener("click", () => analyze());
      let last = null;
      async function analyze() {
        const hs = store.portfolio.holdings().map(({ symbol, quantity, avg_cost }) => ({ symbol, quantity, avg_cost }));
        const out = $("#pf-out");
        if (!hs.length) { out.innerHTML = ""; return; }
        out.innerHTML = ui.skeletonGrid(4) + ui.skeleton(6, false);
        let a;
        try {
          a = await data.portfolio(hs, base).catch(async (err) => {
            if (/needs the live/.test(err.message)) return clientAnalysis(hs, base);
            throw err;
          });
        } catch (err) { if (ctx.alive()) out.innerHTML = ui.errorBox(err); return; }
        if (!ctx.alive()) return;
        last = a;
        out.innerHTML = results(a);
        out.querySelector("#pf-csv")?.addEventListener("click", () => ui.downloadCSV("portfolio.csv", last.holdings,
          ["symbol", "name", "currency", "quantity", "avg_cost", "price", "value", "weight_pct", "pnl", "pnl_pct", "sector", "country"]));
      }
      paintList();
      analyze();
    },
  };
})();
