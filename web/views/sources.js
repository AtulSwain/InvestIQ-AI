/* Data sources: every exchange, provider, regulator and AI service InvestIQ uses - logo, what it
   is used for, access (free / optional key) and, on a live server, whether it is configured. */
(function () {
  const { esc } = fmt;
  const data = window.investiqData;

  window.views.sources = {
    title: "Data sources",
    async render(el, arg, ctx) {
      const card = (id, status) => {
        const b = brands.ALL[id];
        const st = status?.[id];
        const badge = b.access === "Always on" ? '<span class="badge good">Always on · free</span>'
          : st ? (st.configured ? '<span class="badge good">Configured</span>' : '<span class="badge">Not configured</span>')
          : b.access ? `<span class="badge">${esc(b.access)}</span>` : "";
        return `<div class="card src-card">${brands.logo(id, { size: 40 })}
          <div><div class="card-head" style="margin-bottom:2px"><strong>${b.url ? `<a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.name)} ${ui.icon("external")}</a>` : esc(b.name)}</strong>${badge}</div>
            <p style="font-size:12.5px;margin:2px 0 0;color:var(--text-secondary)">${esc(b.use)}</p>
            ${st && st.configured ? `<p class="prov">${st.calls_today ?? 0} calls today${st.daily_limit ? ` of ${st.daily_limit}` : ""}${st.last_error ? ` · last error ${esc(ui.relTime(st.last_error_at))}` : st.last_ok_at ? ` · last OK ${esc(ui.relTime(st.last_ok_at))}` : ""}</p>` : ""}</div></div>`;
      };
      const paint = (status, live) => {
        el.innerHTML = `<div class="page-head"><div><div class="crumbs">Build thesis</div><h1>Data sources</h1>
            <p class="sub muted">Where every number in InvestIQ comes from. The same logos appear next to prices, sections, news, filings and AI citations throughout the app.</p></div></div>
          ${brands.GROUPS.map(([g, label]) => `<h2 style="margin:18px 0 8px">${label}</h2>
            <div class="grid grid-2">${Object.keys(brands.ALL).filter((id) => brands.ALL[id].group === g && (id !== "demo" || live?.demo)).map((id) => card(id, status)).join("")}</div>`).join("")}
          <div class="card section" style="margin-top:18px"><h2>How to read the labels</h2>
            <p style="font-size:12.5px">Every metric is marked <span class="badge">Reported</span> (published by the company or exchange), <span class="badge">Estimate</span> (analyst or model forecast) or <span class="badge">Calculated</span> (derived by InvestIQ with a stated method). Hover any value for its source, period, currency and when it was fetched; each company's <em>Sources</em> tab lists everything.</p>
            <p class="prov">${live ? "Provider status from the live InvestIQ server." : "Provider status appears when connected to a live InvestIQ server."} Logos are each organisation's own site icon, loaded when you view the page (through Google's public favicon service); a lettered badge is shown if one can't load. Names and logos are trademarks of their respective owners and are shown only to identify data sources - no affiliation or endorsement is implied.</p></div>
          <p class="disclaimer">Prices may be delayed. Research tool, not investment advice.</p>`;
      };
      paint(null, null);
      const h = await data.liveHealth().catch(() => null);
      if (!ctx.alive() || !h) return;
      const status = Object.fromEntries((h.providers || []).map((p) => [p.id, p]));
      status.anthropic = { configured: !!h.ai?.configured };
      paint(status, h);
    },
  };
})();
