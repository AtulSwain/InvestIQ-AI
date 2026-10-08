/* Learn & glossary: every term used in the terminal in plain English, a short research workflow
   guide, and how InvestIQ labels data (reported / estimate / calculated). */
(function () {
  const { esc } = fmt;

  const WORKFLOW = [
    ["Discover", "#/discover", "Start from a ready-made screen, a sector, a market mover or the Screener."],
    ["Research", "#/research", "Open the company page: overview, financials, valuation, earnings, ownership, news, filings, peers, risk."],
    ["Investigate", "#/news", "Use News intelligence and the AI assistant to understand why the stock moved and what changed."],
    ["Compare", "#/compare", "Put the company next to its peers - the best value in each row is highlighted."],
    ["Value", "#/research", "Check the fair-value range, reverse DCF and scenarios on the Valuation tab."],
    ["Monitor", "#/alerts", "Add to a watchlist or portfolio and set alerts for price, metrics, news, earnings and insiders."],
    ["Build thesis", "#/workspace", "Write the thesis in a notebook, add measurable assumptions, and let the tracker flag conflicts."],
  ];

  window.views.learn = {
    title: "Learn & glossary",
    render(el) {
      const terms = glossary.all();
      el.innerHTML = `<div class="page-head"><div><div class="crumbs">Build thesis</div><h1>Learn & glossary</h1><p class="sub muted">${terms.length} terms in plain English, and how to use the terminal.</p></div></div>
        <div class="card section"><h2>The research workflow</h2><div class="grid grid-4">${WORKFLOW.map(([t, h, d], i) => `<a class="note-card" href="${h}" style="display:block;text-decoration:none;color:inherit"><div class="muted" style="font-size:11px">STEP ${i + 1}</div><strong>${t}</strong><p style="font-size:12.5px;margin:4px 0 0;color:var(--text-secondary)">${d}</p></a>`).join("")}</div></div>
        <div class="card section"><h2>How data is labelled</h2><div class="grid grid-3">
          <div><span class="badge">Reported</span><p style="font-size:12.5px">Taken from company filings or exchange prices as published (e.g. revenue, closing price).</p></div>
          <div><span class="badge">Estimate</span><p style="font-size:12.5px">Forecasts by analysts or InvestIQ's models (e.g. EPS estimates, fair value, scenarios). Can be wrong.</p></div>
          <div><span class="badge">Calculated</span><p style="font-size:12.5px">Derived by InvestIQ from reported data with a stated method (e.g. ROCE, CAGR, risk scores).</p></div></div>
          <p class="sub">Hover any metric to see its source, period, currency, status and when it was fetched. The Sources tab on every company page lists everything.</p></div>
        <div class="card section"><div class="card-head"><h2>Glossary</h2><input id="lg-q" type="search" placeholder="Filter terms…" style="min-width:220px"></div><div id="lg-list"></div></div>
        <p class="disclaimer">Educational content, not investment advice.</p>`;
      const paint = (q = "") => {
        const s = q.toLowerCase();
        const shown = terms.filter((t) => !s || (t.term + " " + (t.aka || []).join(" ") + " " + t.short).toLowerCase().includes(s));
        el.querySelector("#lg-list").innerHTML = shown.length ? `<div class="grid grid-2">${shown.map((t) => `<div class="note-card" style="cursor:default"><strong>${esc(t.term)}</strong>${t.aka?.length ? ` <span class="muted" style="font-size:11.5px">· ${esc(t.aka.join(", "))}</span>` : ""}
          <p style="font-size:12.5px;margin:4px 0 0">${esc(t.short)}</p>${t.good ? `<p class="muted" style="font-size:12px;margin:4px 0 0">${esc(t.good)}</p>` : ""}</div>`).join("")}</div>` : '<p class="muted">No matching terms.</p>';
      };
      el.querySelector("#lg-q").addEventListener("input", (e) => paint(e.target.value));
      paint();
    },
  };
})();
