/* News intelligence: headlines for the tracked universe (or your stocks), classified into
   earnings / M&A / regulatory / legal / insider / analyst / product / corporate / macro, linked to
   the price move on the day, filterable and searchable. */
(function () {
  const { esc } = fmt;
  const data = window.investiqData;

  window.views.news = {
    title: "News",
    async render(el, arg, ctx) {
      const st = { scope: arg === "mine" ? "mine" : "all", cat: "", moved: false, q: "" };
      el.innerHTML = `<div class="page-head"><div><div class="crumbs">Research</div><h1>News intelligence</h1><p class="sub muted">Classified headlines linked to each stock's price move that day.</p></div>
          <div id="nw-scope"></div></div>
        <div class="grid grid-3 section"><div class="span-2"><div class="card"><div class="filters" id="nw-filters"></div><div id="nw-list">${ui.skeleton(8, false)}</div></div></div>
          <div><div class="card"><h2>By category</h2><div id="nw-cats"></div></div><div class="card" style="margin-top:12px"><h2>Most mentioned</h2><div id="nw-top"></div></div></div></div>
        <p class="disclaimer">Headlines come from Yahoo Finance (and Finnhub for US stocks when configured). Categories use keyword rules and can be wrong; always read the source.</p>`;
      const $ = (s) => el.querySelector(s);
      $("#nw-scope").innerHTML = ui.seg([["all", "All tracked"], ["mine", "My stocks"]], st.scope, "scope");
      let items = [];
      const mine = () => [...new Set([...store.watchlists.symbols(), ...store.portfolio.holdings().map((h) => h.symbol)])];

      const paint = () => {
        const q = st.q.toLowerCase();
        const shown = items.filter((n) => (!st.cat || n.category === st.cat) && (!st.moved || n.price_move?.moved) && (!q || (n.title + " " + (n.summary || "") + " " + (n.symbol || "")).toLowerCase().includes(q)));
        $("#nw-list").innerHTML = shown.length ? shown.slice(0, 80).map((n) => ui.newsItem(n, { showSymbol: true })).join("") + (shown.length > 80 ? `<p class="prov">Showing 80 of ${shown.length}</p>` : "")
          : ui.empty("No headlines match", st.scope === "mine" && !mine().length ? 'Add stocks to a <a href="#/watchlist">watchlist</a> or your portfolio first.' : "Try another category or clear the search.", "", "news");
        const counts = items.reduce((o, n) => ({ ...o, [n.category]: (o[n.category] || 0) + 1 }), {});
        $("#nw-cats").innerHTML = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([c, k]) => `<div class="list-row" data-cat="${esc(c)}" style="${st.cat === c ? "background:var(--accent-soft)" : ""}"><span class="nm">${esc(ui.CAT_LABEL[c] || c)}</span><span></span><span class="num">${k}</span></div>`).join("") || '<p class="muted">—</p>';
        const bySym = items.reduce((o, n) => (n.symbol ? { ...o, [n.symbol]: (o[n.symbol] || 0) + 1 } : o), {});
        $("#nw-top").innerHTML = Object.entries(bySym).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s, k]) => `<div class="list-row" data-open="${esc(s)}"><span class="nm ticker">${esc(s)}</span><span></span><span class="num">${k}</span></div>`).join("") || '<p class="muted">—</p>';
      };
      $("#nw-filters").innerHTML = `<input id="nw-q" type="search" placeholder="Search headlines…" style="min-width:200px;flex:1">
        <select id="nw-cat" aria-label="Category"><option value="">All categories</option>${Object.entries(ui.CAT_LABEL).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select>
        <label class="toggle"><input type="checkbox" id="nw-moved"> Moved the stock (±2%)</label>`;
      $("#nw-q").addEventListener("input", (e) => { st.q = e.target.value; paint(); });
      $("#nw-cat").addEventListener("change", (e) => { st.cat = e.target.value; paint(); });
      $("#nw-moved").addEventListener("change", (e) => { st.moved = e.target.checked; paint(); });
      $("#nw-cats").addEventListener("click", (e) => { const r = e.target.closest("[data-cat]"); if (r) { st.cat = st.cat === r.dataset.cat ? "" : r.dataset.cat; $("#nw-cat").value = st.cat; paint(); } });

      const load = async () => {
        $("#nw-list").innerHTML = ui.skeleton(8, false);
        try {
          const syms = st.scope === "mine" ? mine() : null;
          items = st.scope === "mine" && !syms.length ? [] : await data.news(syms && syms.slice(0, 15));
          if (!ctx.alive()) return;
          paint();
        } catch (err) { if (ctx.alive()) $("#nw-list").innerHTML = ui.errorBox(err); }
      };
      ui.bindChoice($("#nw-scope"), "scope", (v) => { st.scope = v; load(); });
      await load();
    },
  };
})();
