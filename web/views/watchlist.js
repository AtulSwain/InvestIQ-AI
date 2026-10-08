/* Watchlists: several named lists with price, valuation, quality, next earnings, notebooks and
   alerts per stock. Data from the tracked universe; other symbols load their own report. */
(function () {
  const { esc } = fmt;
  const data = window.investiqData;

  function fromReport(r) {
    const m = Object.fromEntries(Object.entries(r.metrics || {}).map(([k, v]) => [k, v.value]));
    return { symbol: r.symbol, name: r.name, currency: r.currency, sector: r.fundamentals?.sector, valuation_verdict: r.valuation?.verdict, ...m };
  }

  window.views.watchlist = {
    title: "Watchlist",
    async render(el, arg, ctx) {
      let lists = store.watchlists.all();
      if (!lists.length) { store.watchlists.create("My watchlist"); lists = store.watchlists.all(); }
      let active = lists.find((l) => l.id === arg)?.id || lists[0].id;
      el.innerHTML = `<div class="page-head"><div><div class="crumbs">Monitor</div><h1>Watchlists</h1><p class="sub muted">Track ideas before you buy. Stored in this browser - export from the command palette (Ctrl K).</p></div>
          <div class="row"><button class="btn" id="wl-new">${ui.icon("plus")} New list</button></div></div>
        <div id="wl-tabs"></div>
        <div class="card section"><div class="card-head"><form id="wl-add" class="row" autocomplete="off"><input id="wl-q" type="text" placeholder="Add a stock…" style="min-width:220px"><button class="btn primary sm" type="submit">Add</button></form>
          <div class="row"><button class="btn sm" id="wl-cmp">${ui.icon("compare")} Compare</button><button class="btn sm" id="wl-ai">${ui.icon("ai")} Ask AI</button><button class="btn sm" id="wl-csv">${ui.icon("download")} CSV</button><button class="btn sm ghost" id="wl-ren">Rename</button><button class="btn sm danger" id="wl-del">Delete list</button></div></div>
          <div id="wl-sugg"></div><div id="wl-body"></div></div>
        <p class="disclaimer">Prices are delayed or end-of-day. Research tool, not investment advice.</p>`;
      const $ = (s) => el.querySelector(s);
      const cur = () => store.watchlists.get(active) || store.watchlists.all()[0];

      const [uni, earnings] = await Promise.all([data.universe().catch(() => ({ stocks: [] })), data.marketPart("earnings").catch(() => [])]);
      if (!ctx.alive()) return;
      const rowsBySym = Object.fromEntries((uni.stocks || []).map((s) => [s.symbol, s]));
      const earnBy = Object.fromEntries((earnings || []).map((e) => [e.symbol, e]));
      const extra = {}, pending = new Set();

      const paintTabs = () => {
        $("#wl-tabs").innerHTML = ui.tabs(store.watchlists.all().map((l) => [l.id, `${l.name} (${l.items.length})`]), active, "list");
      };
      $("#wl-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-list]"); if (b) { active = b.dataset.list; history.replaceState(null, "", `#/watchlist/${active}`); paint(); } });

      function paint() {
        paintTabs();
        const list = cur();
        if (!list.items.length) {
          $("#wl-body").innerHTML = ui.empty("This list is empty", "Add stocks above, star them on any research page, or pick from the Screener.", `<a class="btn" href="#/discover">Find ideas</a>`, "watchlist");
          return;
        }
        const alerts = store.alerts.all();
        const rows = list.items.map((i) => rowsBySym[i.symbol] || extra[i.symbol] || { symbol: i.symbol, name: i.name, _missing: true });
        $("#wl-body").innerHTML = `<div class="table-wrap"><table class="compact"><thead><tr><th class="l">Stock</th><th>Price</th><th>1D</th><th>1Y</th><th>P/E</th><th>ROE</th><th>Margin of safety</th><th>Score</th><th class="l">Valuation</th><th>Next earnings</th><th>Notes</th><th>Alerts</th><th></th></tr></thead><tbody>
          ${rows.map((r) => {
            const nb = store.workspace.forSymbol(r.symbol)[0];
            const nAl = alerts.filter((a) => a.symbol === r.symbol && a.active).length;
            const e = earnBy[r.symbol];
            return `<tr><td class="l"><a class="ticker" href="#/research/${encodeURIComponent(r.symbol)}">${esc(r.symbol)}</a> <span class="muted">${esc(r.name || "")}</span></td>
              ${r._missing ? `<td colspan="8" class="muted l">${extra[r.symbol] === null ? "Could not load - open the research page" : "Loading…"}</td>` : `
              <td>${ui.fmtUnit(r.price, "money", r.currency)}</td><td>${ui.chg(r.change_pct)}</td><td>${ui.chg(r.return_1y_pct, 1)}</td>
              <td>${ui.fmtUnit(r.pe, "x")} ${ui.sig(r.signals?.pe)}</td><td>${ui.fmtUnit(r.roe_pct, "pct")}</td><td>${ui.fmtUnit(r.margin_of_safety_pct, "pct")}</td><td>${ui.fmtUnit(r.score, "score")}</td>
              <td class="l">${esc(r.valuation_verdict || "—")}</td>`}
              <td>${e ? `${fmt.date(e.date)} <span class="muted">(${e.days_away}d)</span>` : "—"}</td>
              <td>${nb ? `<a href="#/workspace/${nb.id}">Open</a>` : `<button class="btn sm ghost" data-nb="${esc(r.symbol)}">+ New</button>`}</td>
              <td>${nAl ? `<a href="#/alerts">${nAl}</a>` : `<a href="#/alerts/new/${encodeURIComponent(r.symbol)}" class="muted">+ Add</a>`}</td>
              <td><button class="icon-btn" data-rm="${esc(r.symbol)}" aria-label="Remove ${esc(r.symbol)}">${ui.icon("x")}</button></td></tr>`;
          }).join("")}</tbody></table></div>
          <p class="prov">${uni.origin === "snapshot" ? `Daily snapshot ${fmt.date(uni.generated_at)}` : "Live data"} · added ${list.items.length} stock(s)</p>`;
        // Load stocks that are outside the tracked universe.
        rows.filter((r) => r._missing && extra[r.symbol] === undefined && !pending.has(r.symbol)).forEach((r) => {
          pending.add(r.symbol);
          data.report(r.symbol).then((rep) => { extra[r.symbol] = fromReport(rep); }).catch(() => { extra[r.symbol] = null; })
            .finally(() => { if (ctx.alive() && extra[r.symbol] !== undefined) paint(); });
        });
      }
      $("#wl-body").addEventListener("click", (e) => {
        const rm = e.target.closest("[data-rm]");
        if (rm) { store.watchlists.removeItem(active, rm.dataset.rm); paint(); return; }
        const nb = e.target.closest("[data-nb]");
        if (nb) { const n = store.workspace.create(nb.dataset.nb, cur().items.find((i) => i.symbol === nb.dataset.nb)?.name); ui.go(`#/workspace/${n.id}`); }
      });
      $("#wl-new").addEventListener("click", () => { const n = prompt("Name the new list", "Ideas"); if (n) { active = store.watchlists.create(n).id; paint(); } });
      $("#wl-ren").addEventListener("click", () => { const n = prompt("Rename list", cur().name); if (n) { store.watchlists.rename(active, n); paint(); } });
      $("#wl-del").addEventListener("click", () => {
        if (store.watchlists.all().length <= 1) { ui.toast("Keep at least one list"); return; }
        if (confirm(`Delete “${cur().name}”?`)) { store.watchlists.remove(active); active = store.watchlists.all()[0].id; paint(); }
      });
      $("#wl-cmp").addEventListener("click", () => { const s = cur().items.slice(0, 4).map((i) => encodeURIComponent(i.symbol)); if (s.length >= 2) ui.go(`#/compare/${s.join(",")}`); else ui.toast("Add at least two stocks to compare"); });
      $("#wl-ai").addEventListener("click", () => ui.go(`#/ai/${cur().items.slice(0, 4).map((i) => encodeURIComponent(i.symbol)).join(",")}`));
      $("#wl-csv").addEventListener("click", () => ui.downloadCSV(`watchlist-${cur().name}.csv`, cur().items.map((i) => ({ ...(rowsBySym[i.symbol] || extra[i.symbol] || {}), symbol: i.symbol, added: i.added })),
        ["symbol", "name", "price", "change_pct", "return_1y_pct", "pe", "roe_pct", "margin_of_safety_pct", "score", "valuation_verdict", "added"]));
      let timer;
      $("#wl-q").addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const v = $("#wl-q").value.trim();
          const res = v ? await data.search(v).catch(() => []) : [];
          $("#wl-sugg").innerHTML = res.slice(0, 6).map((s) => `<button type="button" class="chip" data-pick="${esc(s.symbol)}" data-name="${esc(s.name)}" style="margin:0 6px 8px 0"><span class="ticker">${esc(s.symbol)}</span> <span class="muted">${esc(s.name)}</span></button>`).join("");
        }, 200);
      });
      const add = (sym, name) => { store.watchlists.add(active, sym, name || sym); $("#wl-q").value = ""; $("#wl-sugg").innerHTML = ""; paint(); };
      $("#wl-sugg").addEventListener("click", (e) => { const b = e.target.closest("[data-pick]"); if (b) add(b.dataset.pick, b.dataset.name); });
      $("#wl-add").addEventListener("submit", (e) => { e.preventDefault(); const v = $("#wl-q").value.trim().toUpperCase(); if (v) add(v); });
      paint();
    },
  };
})();
