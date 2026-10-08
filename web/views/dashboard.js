/* Research dashboard: indices, watchlist performance, movers, sectors, news, earnings, economic
   events and insights built from the user's own watchlists, portfolio, notebooks and alerts.
   Every card loads on its own, so one slow source never blanks the page. */
(function () {
  const { esc } = fmt;
  const data = window.investiqData;

  function moverRow(s, key = "change_pct") {
    return `<div class="list-row" data-open="${esc(s.symbol)}">
      <span class="nm"><span class="ticker">${esc(s.symbol.replace(/\.NS$/, ""))}</span> <span class="muted">${esc(s.name)}</span></span>
      <span class="num">${fmt.n(s.last, s.last >= 1000 ? 0 : 2)}</span>
      <span class="num">${key === "volume_vs_avg" ? `<span class="badge">${fmt.n(s.volume_vs_avg, 1)}× vol</span>` : ui.chg(s[key])}</span></div>`;
  }

  function insights(movers, earnings) {
    const out = [];
    const stocks = movers?.stocks || [];
    const bySym = Object.fromEntries(stocks.map((s) => [s.symbol, s]));
    const wl = store.watchlists.symbols();
    const held = store.portfolio.holdings().map((h) => h.symbol);
    const mine = [...new Set([...wl, ...held])];
    const tracked = mine.map((s) => bySym[s]).filter(Boolean);
    if (tracked.length) {
      const best = [...tracked].sort((a, b) => b.change_pct - a.change_pct)[0];
      const worst = [...tracked].sort((a, b) => a.change_pct - b.change_pct)[0];
      const down = tracked.filter((s) => s.change_pct <= -2);
      out.push(["▲", `Best of your stocks today: ${ui.stockLink(best.symbol)} ${ui.chg(best.change_pct)}; weakest: ${ui.stockLink(worst.symbol)} ${ui.chg(worst.change_pct)}.`]);
      if (down.length) out.push(["!", `${down.length} of your stocks fell 2% or more today: ${down.map((s) => ui.stockLink(s.symbol)).join(", ")}. Check the News tab for a reason before reacting.`]);
      const near = tracked.filter((s) => s.high_52w && s.last >= s.high_52w * 0.98);
      if (near.length) out.push(["↑", `Near a 52-week high: ${near.map((s) => ui.stockLink(s.symbol)).join(", ")}.`]);
      const spikes = tracked.filter((s) => s.volume_vs_avg >= 1.8);
      if (spikes.length) out.push(["◎", `Unusual volume (1.8× average or more): ${spikes.map((s) => ui.stockLink(s.symbol)).join(", ")} - something may be happening.`]);
    }
    const soon = (earnings || []).filter((e) => mine.includes(e.symbol) && e.days_away <= 14);
    if (soon.length) out.push(["E", `Earnings within 2 weeks for ${soon.map((e) => `${ui.stockLink(e.symbol)} (${fmt.date(e.date)})`).join(", ")}. Review your thesis assumptions first.`]);
    const nbs = store.workspace.all();
    const conflicted = nbs.filter((n) => (n.checks || []).at(-1)?.status === "conflict");
    if (conflicted.length) out.push(["!", `${conflicted.length} thesis notebook(s) flagged a conflict at the last check: ${conflicted.map((n) => `<a href="#/workspace/${n.id}">${esc(n.title)}</a>`).join(", ")}.`]);
    const stale = nbs.filter((n) => !(n.checks || []).length || Date.now() - new Date(n.checks.at(-1).checked_at || n.checks.at(-1).saved).getTime() > 14 * 864e5);
    if (stale.length) out.push(["⟳", `${stale.length} notebook(s) not checked against new data in 2+ weeks. <a href="#/workspace">Open the workspace</a>.`]);
    for (const m of ["IN", "US"]) {
      const mv = movers?.movers?.[m];
      if (mv && mv.advancers + mv.decliners) out.push(["≈", `${m === "IN" ? "India" : "US"} breadth (tracked stocks): ${mv.advancers} up, ${mv.decliners} down.`]);
    }
    const sec = (movers?.sectors || []).filter((s) => s.change_pct != null).sort((a, b) => b.change_pct - a.change_pct);
    if (sec.length) out.push(["▤", `Strongest sector today: ${esc(sec[0].sector)} (${sec[0].market}) ${ui.chg(sec[0].change_pct)}; weakest: ${esc(sec.at(-1).sector)} (${sec.at(-1).market}) ${ui.chg(sec.at(-1).change_pct)}.`]);
    if (!mine.length) out.push(["+", 'Add stocks to a <a href="#/watchlist">watchlist</a> or your <a href="#/portfolio">portfolio</a> to get insights about them here.']);
    return out.length ? out.map(([i, t]) => `<div class="insight"><span class="ico">${i}</span><div>${t}</div></div>`).join("")
      : ui.empty("No insights yet", "Insights appear once market data loads.");
  }

  function sectorGrid(movers, market, period) {
    const key = { "1D": "change_pct", "1M": "month_pct", YTD: "ytd_pct", "1Y": "year_pct" }[period];
    const rows = (movers?.sectors || []).filter((s) => s.market === market).sort((a, b) => (b[key] ?? -1e9) - (a[key] ?? -1e9));
    if (!rows.length) return ui.empty("No sector data", "Sector performance needs the tracked-stock prices.");
    const scale = period === "1D" ? 2.5 : 15;
    return `<div class="heat-grid">${rows.map((s) => `<a class="heat-cell" style="${ui.heatBg(s[key], scale)}" href="#/markets/sector/${encodeURIComponent(s.market + ":" + s.sector)}" title="Best: ${esc(s.best || "")} · Worst: ${esc(s.worst || "")}">
      <div class="s">${esc(s.sector)}</div><div class="v ${s[key] >= 0 ? "up" : "down"}">${s[key] == null ? "—" : fmt.pct(s[key], 2)}</div>
      <div class="n">${s.count} stock${s.count > 1 ? "s" : ""}</div></a>`).join("")}</div>`;
  }

  window.views.dashboard = {
    title: "Dashboard",
    async render(el, arg, ctx) {
      const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      el.innerHTML = `
        <div class="page-head"><div><div class="crumbs">Discover</div><h1>Research dashboard</h1>
          <p class="sub muted">${today} · indices, your stocks, movers, sectors, news and events</p></div>
          <div class="row"><a class="btn" href="#/screener">${ui.icon("screener")} Screener</a><a class="btn primary" href="#/ai">${ui.icon("ai")} Ask AI</a></div></div>
        <section id="d-ticker" class="section"></section>
        <div class="grid grid-3 section">
          <div class="card span-2"><div class="card-head"><h2>Watchlist performance</h2><a class="btn sm" href="#/watchlist">Manage</a></div><div id="d-watch"></div></div>
          <div class="card"><div class="card-head"><h2>Insights for you</h2></div><div id="d-insights"></div></div>
        </div>
        <div class="grid grid-2 section">
          <div class="card"><div class="card-head"><h2>Market movers</h2><div class="row" id="d-mv-ctl">${ui.seg([["IN", "India"], ["US", "US"]], "IN", "mkt")}${ui.seg([["gainers", "Gainers"], ["losers", "Losers"], ["volume", "Volume"]], "gainers", "kind")}</div></div><div id="d-movers"></div></div>
          <div class="card"><div class="card-head"><h2>Sector performance</h2><div class="row" id="d-sec-ctl">${ui.seg([["IN", "India"], ["US", "US"]], "IN", "smkt")}${ui.seg([["1D", "1D"], ["1M", "1M"], ["YTD", "YTD"], ["1Y", "1Y"]], "1D", "per")}</div></div><div id="d-sectors"></div></div>
        </div>
        <div class="grid grid-3 section">
          <div class="card span-2"><div class="card-head"><h2>Important news</h2><a class="btn sm" href="#/news">All news</a></div><div id="d-news"></div></div>
          <div>
            <div class="card"><div class="card-head"><h2>Upcoming earnings</h2></div><div id="d-earn"></div></div>
            <div class="card" style="margin-top:12px"><div class="card-head"><h2>Economic events</h2><a class="btn sm" href="#/markets">Macro</a></div><div id="d-econ"></div></div>
          </div>
        </div>
        <p class="disclaimer">Prices may be delayed; tracked-universe movers cover InvestIQ's followed stocks only, not the whole exchange. Research tool, not investment advice.</p>`;

      const $ = (s) => el.querySelector(s);
      const state = { mkt: "IN", kind: "gainers", smkt: "IN", per: "1D", movers: null, earnings: null };

      // Indices & macro strip
      const paintTicker = (ov) => ov && ov.instruments?.length
        ? `<div class="ticker-strip">${ov.instruments.map(ui.tick).join("")}</div>${ui.srcNote(ov.source)}`
        : ui.empty("Indices unavailable", "The market overview hasn't been published yet.");
      ui.fill($("#d-ticker"), () => data.marketPart("overview", { onLive: (v) => ctx.alive() && ($("#d-ticker").innerHTML = paintTicker(v)) }), paintTicker, ctx, { lines: 1 });

      const paintMovers = () => {
        const mv = state.movers?.movers?.[state.mkt];
        if (!mv) return ui.empty("No movers", "Movers need today's prices for the tracked stocks.");
        const list = mv[state.kind] || [];
        return (list.length ? list.slice(0, 8).map((s) => moverRow(s, state.kind === "volume" ? "volume_vs_avg" : "change_pct")).join("") : `<p class="muted">None today.</p>`)
          + `<p class="prov">${mv.advancers} advancing · ${mv.decliners} declining · ${esc(state.movers.source?.provider_label || "")}${state.movers.generated_at ? " · " + ui.relTime(state.movers.generated_at) : ""}</p>`;
      };
      const paintWatch = () => {
        const syms = store.watchlists.symbols();
        if (!syms.length) {
          return ui.empty("Your watchlist is empty", "Star stocks from any research page, or start with a few popular names.",
            `<div class="chips" style="justify-content:center;margin-top:10px">${["RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "AAPL", "MSFT"].map((s) => `<button class="chip" data-add="${s}">${ui.icon("plus")} ${s.replace(".NS", "")}</button>`).join("")}</div>`, "watchlist");
        }
        const bySym = Object.fromEntries((state.movers?.stocks || []).map((s) => [s.symbol, s]));
        const rows = syms.map((s) => bySym[s] || { symbol: s });
        return `<div class="table-wrap"><table class="compact"><thead><tr><th class="l">Stock</th><th>Last</th><th>1D</th><th>1W</th><th>1M</th><th>YTD</th><th>1Y</th><th>vs 52W high</th><th>Trend (30d)</th></tr></thead><tbody>
          ${rows.map((s) => `<tr data-open="${esc(s.symbol)}" style="cursor:pointer"><td class="l"><span class="ticker">${esc(s.symbol)}</span> <span class="muted">${esc(s.name || "")}</span></td>
            ${s.last == null ? `<td colspan="8" class="muted l">Not in today's tracked universe - open to load</td>` : `
            <td>${fmt.n(s.last, s.last >= 1000 ? 0 : 2)}</td><td>${ui.chg(s.change_pct)}</td><td>${ui.chg(s.week_pct)}</td><td>${ui.chg(s.month_pct)}</td><td>${ui.chg(s.ytd_pct)}</td><td>${ui.chg(s.year_pct)}</td>
            <td>${s.high_52w ? fmt.pct((s.last / s.high_52w - 1) * 100, 1) : "—"}</td><td style="width:110px">${ui.sparkline(s.spark, { height: 22 })}</td>`}</tr>`).join("")}
          </tbody></table></div>`;
      };
      const bindWatch = () => $("#d-watch").querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => {
        store.watchlists.toggle(b.dataset.add, b.dataset.add);
        $("#d-watch").innerHTML = paintWatch();
        bindWatch();
        $("#d-insights").innerHTML = insights(state.movers, state.earnings);
      }));

      ui.bindChoice($("#d-mv-ctl"), "mkt", (v) => { state.mkt = v; $("#d-movers").innerHTML = paintMovers(); });
      ui.bindChoice($("#d-mv-ctl"), "kind", (v) => { state.kind = v; $("#d-movers").innerHTML = paintMovers(); });
      ui.bindChoice($("#d-sec-ctl"), "smkt", (v) => { state.smkt = v; $("#d-sectors").innerHTML = sectorGrid(state.movers, state.smkt, state.per); });
      ui.bindChoice($("#d-sec-ctl"), "per", (v) => { state.per = v; $("#d-sectors").innerHTML = sectorGrid(state.movers, state.smkt, state.per); });

      const paintAllMovers = (mv) => {
        state.movers = mv;
        $("#d-movers").innerHTML = paintMovers();
        $("#d-sectors").innerHTML = sectorGrid(mv, state.smkt, state.per);
        $("#d-watch").innerHTML = paintWatch();
        bindWatch();
        $("#d-insights").innerHTML = insights(state.movers, state.earnings);
      };
      ["#d-movers", "#d-sectors", "#d-watch", "#d-insights"].forEach((s) => { $(s).innerHTML = ui.skeleton(4, false); });
      data.marketPart("movers", { onLive: (v) => ctx.alive() && paintAllMovers(v) })
        .then((mv) => ctx.alive() && paintAllMovers(mv))
        .catch((err) => { if (!ctx.alive()) return; ["#d-movers", "#d-sectors"].forEach((s) => { $(s).innerHTML = ui.errorBox(err); }); paintAllMovers(null); });

      // News: watchlist/portfolio stocks first, then everything market-moving.
      ui.fill($("#d-news"), () => data.marketPart("news"), (items) => {
        if (!items || !items.length) return ui.empty("No recent news", "Headlines appear here when the news sources respond.", "", "news");
        const mine = new Set([...store.watchlists.symbols(), ...store.portfolio.holdings().map((h) => h.symbol)]);
        const weight = (n) => (mine.has(n.symbol) ? 2 : 0) + (n.price_move?.moved ? 1 : 0) + (["earnings", "m&a", "regulatory", "lawsuit", "analyst"].includes(n.category) ? 1 : 0);
        const sorted = [...items].sort((a, b) => weight(b) - weight(a) || String(b.published_at).localeCompare(String(a.published_at)));
        return sorted.slice(0, 9).map((n) => ui.newsItem(n, { showSymbol: true })).join("")
          + `<p class="prov">Ranked: your stocks first, then stories that coincided with a big price move, then earnings / deals / regulatory / analyst news. Categories by keyword rules.</p>`;
      }, ctx, { lines: 6 });

      ui.fill($("#d-earn"), () => data.marketPart("earnings"), (items) => {
        state.earnings = items || [];
        if (state.movers) $("#d-insights").innerHTML = insights(state.movers, state.earnings);
        if (!items || !items.length) return ui.empty("No dates published", "Upcoming earnings dates come from Yahoo Finance for the tracked stocks.", "", "reports");
        const mine = new Set(store.watchlists.symbols());
        return items.slice(0, 10).map((e) => `<div class="list-row" data-open="${esc(e.symbol)}">
          <span class="nm"><span class="ticker">${esc(e.symbol.replace(/\.NS$/, ""))}</span>${mine.has(e.symbol) ? ` <span class="badge">watchlist</span>` : ""}</span>
          <span class="muted num">${e.eps_estimate != null ? "EPS est " + fmt.n(e.eps_estimate, 2) : ""}</span>
          <span class="num">${fmt.date(e.date)} <span class="muted">(${e.days_away}d)</span></span></div>`).join("")
          + `<p class="prov">Yahoo Finance earnings calendar · EPS figures are analyst estimates</p>`;
      }, ctx);

      ui.fill($("#d-econ"), () => data.marketPart("macro"), (m) => {
        const cal = m?.economic_calendar;
        if (cal?.available && cal.events?.length) {
          return cal.events.slice(0, 8).map((e) => `<div class="list-row"><span class="nm">${esc(e.event)}</span><span class="muted">${esc(e.country || "")}</span><span class="num">${fmt.date(e.date)}</span></div>`).join("");
        }
        return `<p class="muted" style="font-size:12.5px">${esc(cal?.note || "No economic calendar source is configured.")}</p>
          <p style="font-size:12.5px">Key scheduled events to track yourself: RBI policy meetings, US FOMC meetings, India CPI (12th of the month), US CPI and jobs reports. See <a href="#/markets">Markets → Macro</a> for rates, currency and commodities.</p>`;
      }, ctx, { lines: 2 });
    },
  };
})();
