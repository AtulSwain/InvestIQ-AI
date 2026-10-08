/* Screener: filter the tracked universe on any calculated metric, sort, save screens, export CSV,
   and send picks to Compare or a watchlist. #/screener/<presetId> opens a Discover preset. */
(function () {
  const { esc } = fmt;
  const data = window.investiqData;

  // key, label, unit (for display), default op
  const FIELDS = [
    ["price", "Price", "money"], ["change_pct", "Change today", "pct"], ["market_cap", "Market cap", "big"],
    ["pe", "P/E", "x"], ["pb", "P/B", "x"], ["ps", "P/S", "x"], ["ev_ebitda", "EV/EBITDA", "x"], ["fcf_yield_pct", "FCF yield", "pct"],
    ["dividend_yield_pct", "Dividend yield", "pct"], ["roe_pct", "ROE", "pct"], ["roce_pct", "ROCE", "pct"], ["net_margin_pct", "Net margin", "pct"],
    ["revenue_cagr_pct", "Revenue CAGR", "pct"], ["profit_cagr_pct", "Profit CAGR", "pct"], ["debt_to_equity", "Debt/equity", "n"],
    ["piotroski", "Piotroski", "score"], ["return_1y_pct", "1Y return", "pct"], ["cagr_5y_pct", "5Y CAGR", "pct"], ["volatility_pct", "Volatility", "pct"],
    ["max_drawdown_pct", "Max drawdown", "pct"], ["beta", "Beta", "n"], ["margin_of_safety_pct", "Margin of safety", "pct"], ["score", "Score", "score"],
  ];
  const LABEL = Object.fromEntries(FIELDS.map(([k, l]) => [k, l]));
  const UNIT = Object.fromEntries(FIELDS.map(([k, , u]) => [k, u]));
  const COLS = ["price", "change_pct", "market_cap", "pe", "pb", "ev_ebitda", "roe_pct", "roce_pct", "net_margin_pct", "revenue_cagr_pct", "debt_to_equity", "dividend_yield_pct", "return_1y_pct", "margin_of_safety_pct", "score"];

  window.views.screener = {
    title: "Screener",
    async render(el, arg, ctx) {
      const { PRESETS, applyScreen } = window.screenPresets;
      const preset = PRESETS.find((p) => p.id === arg);
      const saved = arg?.startsWith("saved:") ? store.screens.all().find((s) => s.id === arg.slice(6)) : null;
      const st = {
        market: saved?.filters.market || "ALL", sector: saved?.filters.sector || "",
        filters: (saved?.filters.rules || preset?.filters || [["roe_pct", ">=", 15]]).map((f) => [...f]),
        sort: saved?.filters.sort || preset?.sort || ["score", "desc"], picked: new Set(),
      };
      el.innerHTML = `<div class="page-head"><div><div class="crumbs">Discover</div><h1>Screener</h1>
          <p class="sub muted">${preset ? `Preset: <strong>${esc(preset.name)}</strong> - ${esc(preset.why)}` : saved ? `Saved screen: <strong>${esc(saved.name)}</strong>` : "Filter the tracked universe on InvestIQ's calculated metrics."}</p></div>
          <div class="row"><select id="sc-load" aria-label="Load a screen"><option value="">Load screen…</option>
            <optgroup label="Presets">${PRESETS.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</optgroup>
            <optgroup label="Saved" id="sc-saved"></optgroup></select></div></div>
        <div class="card section"><div class="filters" id="sc-top"></div><div id="sc-rules"></div>
          <div class="row" style="margin-top:8px"><button class="btn sm" id="sc-add">${ui.icon("plus")} Add filter</button>
          <span class="spacer"></span><button class="btn sm" id="sc-save">Save screen</button><button class="btn sm" id="sc-csv">${ui.icon("download")} CSV</button></div></div>
        <div class="card section"><div class="card-head"><h2 id="sc-count">Results</h2><div class="row"><button class="btn sm" id="sc-cmp" disabled>${ui.icon("compare")} Compare selected</button><button class="btn sm" id="sc-wl" disabled>${ui.icon("star")} Watch selected</button></div></div>
          <div id="sc-table">${ui.skeleton(8, false)}</div></div>
        <p class="disclaimer">Screens use calculated metrics from public data; banks, insurers and loss-making companies are often mis-measured by generic ratios. A screen is a starting point for research, not a recommendation.</p>`;
      const $ = (s) => el.querySelector(s);
      const paintSaved = () => { $("#sc-saved").innerHTML = store.screens.all().map((s) => `<option value="saved:${s.id}">${esc(s.name)}</option>`).join(""); };
      paintSaved();
      $("#sc-load").addEventListener("change", (e) => { if (e.target.value) ui.go(`#/screener/${e.target.value}`); });

      let uni;
      try { uni = await data.universe(); } catch (err) { if (ctx.alive()) { $("#sc-table").innerHTML = ui.errorBox(err, true); $("#sc-table [data-retry]").addEventListener("click", () => ctx.route()); } return; }
      if (!ctx.alive()) return;
      const sectors = [...new Set(uni.stocks.map((s) => s.sector).filter(Boolean))].sort();

      const paintTop = () => {
        $("#sc-top").innerHTML = `${ui.seg([["ALL", "All markets"], ["IN", "India"], ["US", "US"]], st.market, "mkt")}
          <select id="sc-sector" aria-label="Sector"><option value="">All sectors</option>${sectors.map((s) => `<option ${s === st.sector ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>`;
        $("#sc-sector").addEventListener("change", (e) => { st.sector = e.target.value; run(); });
      };
      ui.bindChoice($("#sc-top"), "mkt", (v) => { st.market = v; run(); });
      const paintRules = () => {
        $("#sc-rules").innerHTML = st.filters.map(([k, op, v], i) => `<div class="filters" data-i="${i}">
          <select data-f="k" aria-label="Metric">${FIELDS.map(([fk, l]) => `<option value="${fk}" ${fk === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
          <select data-f="op" aria-label="Operator">${[">=", "<=", ">", "<"].map((o) => `<option ${o === op ? "selected" : ""}>${o}</option>`).join("")}</select>
          <input data-f="v" type="number" step="any" value="${esc(v)}" style="width:110px" aria-label="Value"><span class="muted" style="font-size:12px">${UNIT[k] === "pct" ? "%" : UNIT[k] === "x" ? "×" : ""}</span>
          <button class="icon-btn" data-del aria-label="Remove filter">${ui.icon("x")}</button></div>`).join("") || '<p class="muted" style="font-size:12.5px">No filters - showing every tracked stock.</p>';
      };
      $("#sc-rules").addEventListener("input", (e) => {
        const box = e.target.closest("[data-i]");
        if (!box) return;
        const i = +box.dataset.i, f = e.target.dataset.f;
        if (f === "k") st.filters[i][0] = e.target.value;
        if (f === "op") st.filters[i][1] = e.target.value;
        if (f === "v") st.filters[i][2] = e.target.value === "" ? null : +e.target.value;
        if (f === "k") paintRules();
        run();
      });
      $("#sc-rules").addEventListener("click", (e) => {
        const b = e.target.closest("[data-del]");
        if (!b) return;
        st.filters.splice(+b.closest("[data-i]").dataset.i, 1);
        paintRules(); run();
      });
      $("#sc-add").addEventListener("click", () => { st.filters.push(["pe", "<=", 25]); paintRules(); run(); });

      let rows = [];
      function run() {
        const active = st.filters.filter(([, , v]) => v != null && !Number.isNaN(v));
        rows = applyScreen(uni.stocks.filter((r) => !st.sector || r.sector === st.sector), active, st.sort, st.market);
        $("#sc-count").textContent = `${rows.length} of ${uni.stocks.length} stocks`;
        $("#sc-table").innerHTML = rows.length ? `<div class="table-wrap"><table class="compact"><thead><tr><th></th><th class="l">Company</th><th class="l">Sector</th>
          ${COLS.map((k) => `<th data-sort="${k}" style="cursor:pointer" title="Sort">${esc(LABEL[k])}${st.sort[0] === k ? (st.sort[1] === "desc" ? " ↓" : " ↑") : ""}</th>`).join("")}</tr></thead><tbody>
          ${rows.map((r) => `<tr><td><input type="checkbox" data-pick="${esc(r.symbol)}" ${st.picked.has(r.symbol) ? "checked" : ""} aria-label="Select ${esc(r.symbol)}"></td>
            <td class="l"><a href="#/research/${encodeURIComponent(r.symbol)}" class="ticker">${esc(r.symbol)}</a> <span class="muted">${esc(r.name)}</span></td><td class="l muted">${esc(r.sector || "")}</td>
            ${COLS.map((k) => `<td>${k === "change_pct" ? ui.chg(r[k]) : ui.fmtUnit(r[k], UNIT[k], r.currency)}${r.signals?.[k] ? ` <span class="sig-dot ${r.signals[k]}" title="${r.signals[k]}"></span>` : ""}</td>`).join("")}</tr>`).join("")}
          </tbody></table></div><p class="prov">${uni.origin === "snapshot" ? `Daily snapshot ${fmt.date(uni.generated_at)}` : `Live · computed ${ui.relTime(uni.generated_at)}`} · dots: green good, amber okay, red weak (InvestIQ thresholds)</p>`
          : ui.empty("No matches", "Loosen a filter or switch market.", "", "screener");
        $("#sc-cmp").disabled = st.picked.size < 2;
        $("#sc-wl").disabled = !st.picked.size;
      }
      $("#sc-table").addEventListener("click", (e) => {
        const th = e.target.closest("[data-sort]");
        if (th) { st.sort = [th.dataset.sort, st.sort[0] === th.dataset.sort && st.sort[1] === "desc" ? "asc" : "desc"]; run(); }
      });
      $("#sc-table").addEventListener("change", (e) => {
        const c = e.target.closest("[data-pick]");
        if (!c) return;
        if (c.checked) { if (st.picked.size >= 4) { c.checked = false; ui.toast("Compare up to 4 stocks"); return; } st.picked.add(c.dataset.pick); } else st.picked.delete(c.dataset.pick);
        $("#sc-cmp").disabled = st.picked.size < 2;
        $("#sc-wl").disabled = !st.picked.size;
      });
      $("#sc-cmp").addEventListener("click", () => ui.go(`#/compare/${[...st.picked].map(encodeURIComponent).join(",")}`));
      $("#sc-wl").addEventListener("click", () => {
        const id = store.watchlists.all()[0]?.id || store.watchlists.create("My watchlist").id;
        st.picked.forEach((s) => store.watchlists.add(id, s, uni.stocks.find((x) => x.symbol === s)?.name));
        ui.toast(`Added ${st.picked.size} to watchlist`);
      });
      $("#sc-save").addEventListener("click", () => {
        const name = prompt("Name this screen", preset?.name || saved?.name || "My screen");
        if (!name) return;
        store.screens.save(name, { rules: st.filters, market: st.market, sector: st.sector, sort: st.sort });
        paintSaved();
        ui.toast("Screen saved", name);
      });
      $("#sc-csv").addEventListener("click", () => ui.downloadCSV(`investiq-screen-${new Date().toISOString().slice(0, 10)}.csv`, rows,
        ["symbol", "name", "market", "sector", "currency", ...COLS, "as_of"]));
      paintTop(); paintRules(); run();
    },
  };
})();
