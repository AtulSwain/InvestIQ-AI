/* Markets: indices, sector intelligence (with drill-down into a sector's stocks) and the macro
   dashboard (rates, currency, commodities, volatility, US economic series, rate sensitivity). */
(function () {
  const { esc } = fmt;
  const data = window.investiqData;

  const instRow = (t) => `<tr><td class="l"><strong>${esc(t.name)}</strong> <span class="muted">${esc(t.symbol)}</span></td>
    <td>${fmt.n(t.last, Math.abs(t.last) >= 1000 ? 0 : 2)}</td><td>${ui.chg(t.change_pct)}</td><td>${ui.chg(t.week_pct)}</td><td>${ui.chg(t.month_pct)}</td>
    <td>${ui.chg(t.ytd_pct)}</td><td>${ui.chg(t.year_pct)}</td>
    <td>${t.high_52w ? fmt.pct((t.last / t.high_52w - 1) * 100, 1) : "—"}</td><td style="width:120px">${ui.sparkline(t.spark, { height: 22 })}</td></tr>`;
  const instTable = (rows) => rows.length ? `<div class="table-wrap"><table class="compact"><thead><tr><th class="l">Instrument</th><th>Last</th><th>1D</th><th>1W</th><th>1M</th><th>YTD</th><th>1Y</th><th>vs 52W high</th><th>60 days</th></tr></thead>
    <tbody>${rows.map(instRow).join("")}</tbody></table></div>` : ui.empty("No data", "Nothing published for this group.");

  function indices(ov) {
    if (!ov) return ui.empty("Market overview unavailable", "Indices haven't been published yet.");
    const idx = ov.instruments.filter((i) => i.group === "index");
    return `<div class="ticker-strip section">${idx.map(ui.tick).join("")}</div>
      <div class="card"><h2>Indices</h2>${instTable(idx)}${ui.srcNote(ov.source)}</div>`;
  }

  function sectors(mv, market) {
    const rows = (mv?.sectors || []).filter((s) => s.market === market).sort((a, b) => (b.ytd_pct ?? -1e9) - (a.ytd_pct ?? -1e9));
    if (!rows.length) return ui.empty("No sector data", "Sector performance needs today's tracked-stock prices.");
    return `<div class="card"><div class="card-head"><h2>Sector performance · ${market === "IN" ? "India" : "US"}</h2></div>
      <div class="table-wrap"><table class="compact"><thead><tr><th class="l">Sector</th><th>Stocks</th><th>1D</th><th>1W</th><th>1M</th><th>YTD</th><th>1Y</th><th class="l">Leader / laggard today</th></tr></thead><tbody>
      ${rows.map((s) => `<tr style="cursor:pointer" data-sector="${esc(s.market + ":" + s.sector)}"><td class="l"><strong>${esc(s.sector)}</strong></td><td>${s.count}</td>
        <td style="${ui.heatBg(s.change_pct, 2.5)}">${fmt.pct(s.change_pct, 2)}</td><td>${ui.chg(s.week_pct)}</td><td style="${ui.heatBg(s.month_pct, 12)}">${fmt.pct(s.month_pct, 1)}</td>
        <td style="${ui.heatBg(s.ytd_pct, 25)}">${fmt.pct(s.ytd_pct, 1)}</td><td>${ui.chg(s.year_pct, 1)}</td>
        <td class="l">${s.best ? ui.stockLink(s.best) : "—"} / ${s.worst ? ui.stockLink(s.worst) : "—"}</td></tr>`).join("")}
      </tbody></table></div><p class="prov">${esc(mv.method || "")} ${ui.srcNote(mv.source).replace(/<\/?p[^>]*>/g, "")}</p></div>`;
  }

  function sectorDetail(mv, key) {
    const [market, ...rest] = key.split(":");
    const name = rest.join(":");
    const sec = (mv?.sectors || []).find((s) => s.market === market && s.sector === name);
    if (!sec) return ui.empty("Sector not found", `No tracked stocks in “${esc(name)}”.`, `<a class="btn" href="#/markets/sectors">All sectors</a>`);
    const bySym = Object.fromEntries((mv.stocks || []).map((s) => [s.symbol, s]));
    const rows = sec.members.map((s) => bySym[s]).filter(Boolean).sort((a, b) => b.ytd_pct - a.ytd_pct);
    return `<div class="crumbs"><a href="#/markets/sectors">Sectors</a> / ${esc(market)}</div>
      <div class="grid grid-4 section">${[["1D", sec.change_pct], ["1M", sec.month_pct], ["YTD", sec.ytd_pct], ["1Y", sec.year_pct]].map(([l, v]) => `<div class="kpi"><div class="label">${l} (equal-weighted)</div><div class="value">${ui.chg(v)}</div></div>`).join("")}</div>
      <div class="card"><div class="card-head"><h2>${esc(name)} · ${rows.length} tracked stocks</h2>
        <a class="btn sm" href="#/compare/${rows.slice(0, 4).map((r) => encodeURIComponent(r.symbol)).join(",")}">${ui.icon("compare")} Compare top 4</a></div>
      <div class="table-wrap"><table class="compact"><thead><tr><th class="l">Stock</th><th>Last</th><th>1D</th><th>1M</th><th>YTD</th><th>1Y</th><th>vs 52W high</th><th>Vol vs avg</th><th>Trend</th></tr></thead><tbody>
      ${rows.map((s) => `<tr data-open="${esc(s.symbol)}" style="cursor:pointer"><td class="l"><span class="ticker">${esc(s.symbol)}</span> <span class="muted">${esc(s.name)}</span></td>
        <td>${fmt.n(s.last, 2)}</td><td>${ui.chg(s.change_pct)}</td><td>${ui.chg(s.month_pct)}</td><td>${ui.chg(s.ytd_pct)}</td><td>${ui.chg(s.year_pct)}</td>
        <td>${fmt.pct((s.last / s.high_52w - 1) * 100, 1)}</td><td>${fmt.n(s.volume_vs_avg, 1)}×</td><td style="width:110px">${ui.sparkline(s.spark, { height: 22 })}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="prov">Sector classification: InvestIQ's GICS-style map for tracked stocks. Open the Screener for valuation and quality columns.</p></div>`;
  }

  function macro(m) {
    if (!m) return ui.empty("Macro data unavailable", "The macro snapshot hasn't been published yet.");
    const g = (grp) => m.market_indicators.filter((i) => i.group === grp);
    const us = m.us_macro || {};
    return `
      <div class="grid grid-2 section">
        <div class="card"><h2>Rates & volatility</h2>${instTable([...g("rates"), ...g("volatility")])}</div>
        <div class="card"><h2>Currency & commodities</h2>${instTable([...g("fx"), ...g("commodity")])}</div>
      </div>
      <div class="grid grid-2 section">
        <div class="card"><h2>US economy</h2>
          ${us.available && us.series?.length ? `<div class="table-wrap"><table class="compact"><thead><tr><th class="l">Series</th><th>Latest</th><th>Previous</th><th>Date</th><th>History</th></tr></thead><tbody>
            ${us.series.map((s) => `<tr><td class="l">${esc(s.label)} <span class="muted">${esc(s.frequency || "")}</span></td><td>${fmt.n(s.value, 2)}${s.unit === "percent" ? "%" : ""}</td>
              <td>${fmt.n(s.previous, 2)}</td><td>${fmt.date(s.date)}</td><td style="width:110px">${ui.sparkline(s.history.map((h) => h.value), { height: 22, up: s.value >= (s.previous ?? s.value) })}</td></tr>`).join("")}
            </tbody></table></div>${ui.srcNote(us.source)}` : `<p class="muted" style="font-size:12.5px">${esc(us.note || "Not configured.")}</p>`}
        </div>
        <div class="card"><h2>India economy</h2><p class="muted" style="font-size:12.5px">${esc(m.india_macro?.note || "")}</p>
          <p style="font-size:12.5px">Market-implied signals above: <strong>USD/INR</strong> (rupee strength), <strong>India VIX</strong> (expected NIFTY volatility), <strong>Brent</strong> (India imports most of its oil).</p>
          <div class="chips">${brands.chip("rbi")}${brands.chip("mospi")}${brands.chip("sebi")}</div></div>
      </div>
      <div class="card section"><h2>How macro moves sectors</h2>
        <div class="table-wrap"><table class="compact"><thead><tr><th class="l">If…</th><th class="l">Tends to help</th><th class="l">Tends to hurt</th><th class="l">Why</th></tr></thead><tbody>
        ${m.sensitivity.map((s) => `<tr><td class="l"><strong>${esc(s.driver)}</strong></td><td class="l wrap up">${s.helps.map(esc).join("<br>")}</td><td class="l wrap down">${s.hurts.map(esc).join("<br>")}</td><td class="l wrap">${esc(s.why)}</td></tr>`).join("")}
        </tbody></table></div><p class="prov">General tendencies from economic reasoning, not a forecast; individual companies differ.</p></div>
      <div class="card section"><h2>Economic calendar</h2><p class="muted" style="font-size:12.5px">${esc(m.economic_calendar?.note || "")}</p></div>`;
  }

  window.views.markets = {
    title: "Markets",
    async render(el, arg, ctx) {
      const [tab0, ...rest] = (arg || "indices").split("/");
      const sectorKey = tab0 === "sector" ? rest.join("/") : null;
      const tab = sectorKey ? "sectors" : tab0;
      el.innerHTML = `<div class="page-head"><div><div class="crumbs">Discover</div><h1>Markets</h1><p class="sub muted">Indices, sector intelligence and the macro backdrop</p></div></div>
        ${ui.tabs([["indices", "Indices"], ["sectors", "Sectors"], ["macro", "Macro"]], tab)}<div id="m-body"></div>
        <p class="disclaimer">Prices may be delayed. Sector figures are equal-weighted averages of InvestIQ's tracked stocks, not official sector indices.</p>`;
      el.querySelector(".tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) ui.go(`#/markets/${b.dataset.tab}`); });
      const body = el.querySelector("#m-body");
      if (tab === "indices") {
        await ui.fill(body, () => data.marketPart("overview", { onLive: (v) => ctx.alive() && (body.innerHTML = indices(v)) }), indices, ctx);
      } else if (tab === "sectors") {
        let market = "IN";
        const paint = (mv) => sectorKey ? sectorDetail(mv, sectorKey)
          : `<div class="row section">${ui.seg([["IN", "India"], ["US", "US"]], market, "mk")}</div>${sectors(mv, market)}`;
        const mv = await ui.fill(body, () => data.marketPart("movers"), paint, ctx, { lines: 8 });
        if (!mv) return;
        body.addEventListener("click", (e) => {
          const b = e.target.closest("[data-mk]");
          if (b) { market = b.dataset.mk; body.innerHTML = paint(mv); return; }
          const tr = e.target.closest("[data-sector]");
          if (tr && !e.target.closest("a")) ui.go(`#/markets/sector/${encodeURIComponent(tr.dataset.sector)}`);
        });
        if (sectorKey) ctx.setTitle(sectorKey.split(":").slice(1).join(":"));
      } else {
        await ui.fill(body, () => data.marketPart("macro"), macro, ctx, { lines: 8 });
      }
    },
  };
})();
