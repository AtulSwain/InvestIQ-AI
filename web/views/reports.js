/* Reports: a one-click professional research report for any stock - executive summary, key
   metrics with provenance, financials, valuation, peers, risk, earnings, news, the user's thesis
   (if a notebook exists) and a full sources appendix. Print → "Save as PDF", or download Markdown.
   #/reports · #/reports/SYM[/nb:<notebookId>] */
(function () {
  const { esc } = fmt;
  const data = window.investiqData;
  const KEY_METRICS = ["price", "market_cap", "pe", "forward_pe", "pb", "ev_ebitda", "peg", "dividend_yield_pct", "fcf_yield_pct", "roe_pct", "roce_pct", "roic_pct",
    "net_margin_pct", "operating_margin_pct", "revenue_cagr_pct", "profit_cagr_pct", "debt_to_equity", "interest_coverage", "piotroski", "altman_z", "return_1y_pct",
    "cagr_5y_pct", "volatility_pct", "max_drawdown_pct", "beta", "fair_value", "margin_of_safety_pct", "score"];

  function picker(el) {
    const recent = store.recent.all(), nbs = store.workspace.all();
    el.innerHTML = `<div class="page-head"><div><div class="crumbs">Build thesis</div><h1>Reports</h1><p class="sub muted">One-click professional research reports. Print or save as PDF; every figure carries its source.</p></div></div>
      <div class="card section"><form id="rp-form" class="row" autocomplete="off"><input id="rp-q" placeholder="Stock, e.g. RELIANCE.NS or AAPL" style="flex:1;min-width:220px" required><button class="btn primary" type="submit">${ui.icon("reports")} Build report</button></form></div>
      ${nbs.length ? `<div class="card section"><h2>Reports with your thesis</h2><div class="chips">${nbs.map((n) => `<a class="chip" href="#/reports/${encodeURIComponent(n.symbol)}/nb:${n.id}">${esc(n.title)}</a>`).join("")}</div></div>` : ""}
      ${recent.length ? `<div class="card section"><h2>Recently researched</h2><div class="chips">${recent.map((r) => `<a class="chip" href="#/reports/${encodeURIComponent(r.symbol)}"><span class="ticker">${esc(r.symbol)}</span></a>`).join("")}</div></div>` : ""}`;
    el.querySelector("#rp-form").addEventListener("submit", (e) => { e.preventDefault(); ui.go(`#/reports/${encodeURIComponent(el.querySelector("#rp-q").value.trim())}`); });
  }

  function doc(r, nb, ai) {
    const cur = r.currency, f = r.fundamentals, v = r.valuation, sc = r.scorecard, ext = r.extended || {};
    const years = (r.financials.years || []).slice(-5);
    const m = (k) => r.metrics[k];
    const peers = r.peers?.peers?.length ? [r.peers.target, ...r.peers.peers] : null;
    const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    return `<article class="report-doc" id="rp-doc">
      <div class="card-head" style="align-items:flex-start"><div><div class="muted" style="font-size:12px;text-transform:uppercase;letter-spacing:.06em">InvestIQ equity research · ${esc(today)}</div>
        <h1>${esc(r.name)} <span class="muted" style="font-weight:400">(${esc(r.symbol)})</span></h1>
        <div class="muted" style="font-size:13px">${esc(f.exchange || r.market)} · ${esc(f.sector || "")}${f.industry ? " · " + esc(f.industry) : ""} · ${esc(cur)}</div></div>
        <div style="text-align:right"><div style="font-size:22px;font-weight:700">${fmt.money(r.quote.price, cur)}</div><div class="${fmt.signedClass(r.quote.change)}">${fmt.pct(r.quote.change_pct, 2)} · ${fmt.date(r.as_of)}</div></div></div>
      <div class="grid grid-4" style="margin-top:14px">
        <div class="kpi"><div class="label">InvestIQ score</div><div class="value">${sc.overall ?? "—"}/10</div><div class="muted" style="font-size:12px">${esc(sc.rating)}</div></div>
        <div class="kpi"><div class="label">Valuation</div><div class="value" style="font-size:15px">${esc(v.verdict)}</div><div class="muted" style="font-size:12px">Fair value ${v.fair_value ? fmt.money(v.fair_value.mid, cur, 0) : "—"}</div></div>
        <div class="kpi"><div class="label">Risk profile</div><div class="value" style="font-size:15px">${esc(r.risk_profile?.level || r.risk.risk_level)}</div><div class="muted" style="font-size:12px">${r.risk_profile ? fmt.n(r.risk_profile.overall, 1) + "/10" : ""}</div></div>
        <div class="kpi"><div class="label">Buy checklist</div><div class="value">${r.checklist.passed}/${r.checklist.evaluated}</div><div class="muted" style="font-size:12px">${esc(r.checklist.verdict)}</div></div>
      </div>

      <h2>1. Executive summary</h2>
      ${ai ? `<div class="callout info" style="margin-bottom:8px">AI-generated summary with citations (${esc(ai.model || "")}). Sources are listed at the end of this section.</div>${ui.aiAnswer(ai, "rpai")}` : `<p>${esc(r.summary)}</p>`}
      <div class="grid grid-2"><div><h3>Strengths</h3><ul>${sc.strengths.map((s) => `<li>${esc(s)}</li>`).join("") || "<li>None stood out</li>"}</ul></div>
        <div><h3>Risks</h3><ul>${sc.risks.map((s) => `<li>${esc(s)}</li>`).join("") || "<li>None stood out</li>"}</ul></div></div>

      ${f.description ? `<h2>2. Business overview</h2><p>${esc(f.description)}</p>` : ""}

      <h2>3. Key metrics</h2>
      <table class="compact"><thead><tr><th class="l">Metric</th><th>Value</th><th class="l">Period</th><th class="l">Type · source</th></tr></thead><tbody>
        ${KEY_METRICS.filter((k) => m(k)).map((k) => `<tr><td class="l">${esc(m(k).label)}</td><td>${ui.fmtUnit(m(k).value, m(k).unit, m(k).currency)} ${ui.sig(m(k).signal)}</td><td class="l">${esc(m(k).period || "")}</td><td class="l muted" style="font-size:11px">${esc(ui.provText(m(k), r))}</td></tr>`).join("")}
      </tbody></table>

      <h2>4. Financial performance</h2>
      ${years.length ? `<table class="compact"><thead><tr><th class="l">Fiscal year</th><th>Revenue</th><th>Growth</th><th>Net income</th><th>Net margin</th><th>ROE</th><th>ROCE</th><th>FCF</th><th>D/E</th></tr></thead><tbody>
        ${years.map((y) => `<tr><td class="l">${esc(y.fiscal_year_end)}</td><td>${fmt.big(y.revenue, cur)}</td><td>${fmt.pct(y.revenue_growth_pct, 1)}</td><td>${fmt.big(y.net_income, cur)}</td><td>${fmt.pct(y.net_margin_pct, 1, false)}</td><td>${fmt.pct(y.roe_pct, 1, false)}</td><td>${fmt.pct(y.roce_pct, 1, false)}</td><td>${fmt.big(y.free_cash_flow, cur)}</td><td>${fmt.n(y.debt_to_equity, 2)}</td></tr>`).join("")}
      </tbody></table><p class="prov">Annual reported statements. Revenue CAGR ${fmt.pct(f.revenue_cagr_pct)} · profit CAGR ${fmt.pct(f.profit_cagr_pct)}.</p>` : "<p>Financial statements not available.</p>"}
      ${(ext.quarterly || []).length ? `<h3>Recent quarters</h3><table class="compact"><thead><tr><th class="l">Quarter</th><th>Revenue</th><th>YoY</th><th>Net income</th><th>YoY</th><th>Net margin</th></tr></thead><tbody>
        ${ext.quarterly.slice(-4).reverse().map((q) => `<tr><td class="l">${fmt.date(q.period_end)}</td><td>${fmt.big(q.revenue, cur)}</td><td>${fmt.pct(q.revenue_yoy_pct, 1)}</td><td>${fmt.big(q.net_income, cur)}</td><td>${fmt.pct(q.net_income_yoy_pct, 1)}</td><td>${fmt.pct(q.net_margin_pct, 1, false)}</td></tr>`).join("")}</tbody></table>` : ""}

      <h2>5. Valuation</h2>
      <p><strong>${esc(v.verdict)}</strong>${v.fair_value ? ` - blended fair value ${fmt.money(v.fair_value.mid, cur)} (range ${fmt.money(v.fair_value.low, cur, 0)} – ${fmt.money(v.fair_value.high, cur, 0)}), margin of safety ${fmt.pct(v.margin_of_safety_pct)}.` : ""}
        ${v.reverse_dcf ? ` Reverse DCF: the price implies ${fmt.pct(v.reverse_dcf.implied_growth_pct, 1, false)} annual growth versus ${fmt.pct(v.reverse_dcf.assumed_growth_pct, 1, false)} assumed. ${esc(v.reverse_dcf.reading || "")}` : ""}</p>
      <table class="compact"><thead><tr><th class="l">Method</th><th>Value</th><th>vs price</th></tr></thead><tbody>${v.methods.map((x) => `<tr><td class="l">${esc(x.method)}</td><td>${fmt.money(x.value, cur)}</td><td>${fmt.pct(x.upside_pct)}</td></tr>`).join("")}</tbody></table>
      <p class="prov">Estimates, not facts. Growth ${fmt.pct(v.growth_assumption_pct, 1, false)}, discount rate ${fmt.pct(v.discount_rate_pct, 0, false)}. ${esc(v.note || "")}</p>

      ${peers ? `<h2>6. Peer comparison</h2><table class="compact"><thead><tr><th class="l">Company</th><th>P/E</th><th>EV/EBITDA</th><th>ROE</th><th>Net margin</th><th>Rev CAGR</th><th>D/E</th><th>1Y</th><th>Score</th></tr></thead><tbody>
        ${peers.map((p, i) => `<tr ${i ? "" : 'style="font-weight:600"'}><td class="l">${esc(p.symbol)} <span class="muted">${esc(p.name)}</span></td><td>${fmt.n(p.pe, 1)}</td><td>${fmt.n(p.ev_ebitda, 1)}</td><td>${fmt.pct(p.roe_pct, 1, false)}</td><td>${fmt.pct(p.net_margin_pct, 1, false)}</td><td>${fmt.pct(p.revenue_cagr_pct, 1)}</td><td>${fmt.n(p.debt_to_equity, 2)}</td><td>${fmt.pct(p.return_1y_pct, 1)}</td><td>${fmt.n(p.score, 1)}</td></tr>`).join("")}</tbody></table>
        <p class="prov">${esc(r.peers.method || "")}</p>` : ""}

      <h2>7. Risk assessment</h2>
      ${r.risk_profile ? `<table class="compact"><thead><tr><th class="l">Dimension</th><th>Score</th><th class="l">Evidence</th></tr></thead><tbody>${r.risk_profile.dimensions.map((d) => `<tr><td class="l">${esc(d.dimension)}</td><td>${d.score == null ? "n/a" : `${fmt.n(d.score, 1)} · ${esc(d.level)}`}</td><td class="l wrap" style="font-size:11.5px">${(d.evidence || []).map(esc).join("; ") || esc(d.note || "")}</td></tr>`).join("")}</tbody></table>` : ""}
      <p>Volatility ${fmt.pct(m("volatility_pct")?.value, 1, false)}, worst historical fall ${fmt.pct(m("max_drawdown_pct")?.value, 1)}, beta ${fmt.n(m("beta")?.value, 2)}.</p>

      <h2>8. Earnings & analysts</h2>
      ${(ext.earnings?.history || []).length ? `<table class="compact"><thead><tr><th class="l">Reported</th><th>EPS est.</th><th>EPS actual</th><th>Surprise</th></tr></thead><tbody>${ext.earnings.history.slice(0, 4).map((h) => `<tr><td class="l">${fmt.date(h.date)}</td><td>${fmt.n(h.eps_estimate, 2)}</td><td>${fmt.n(h.eps_actual, 2)}</td><td>${fmt.pct(h.surprise_pct, 1)}</td></tr>`).join("")}</tbody></table>` : "<p>No earnings history available.</p>"}
      ${ext.earnings?.upcoming?.[0] ? `<p>Next report: <strong>${fmt.date(ext.earnings.upcoming[0].date)}</strong>.</p>` : ""}
      ${f.analyst?.analysts ? `<p>${f.analyst.analysts} analysts · consensus “${esc(f.analyst.recommendation || "n/a")}” · targets ${fmt.money(f.analyst.target_low, cur, 0)} – ${fmt.money(f.analyst.target_high, cur, 0)} (estimates).</p>` : ""}

      ${(ext.news || []).length ? `<h2>9. Recent developments</h2><ul>${ext.news.slice(0, 6).map((n) => `<li>${fmt.date((n.published_at || "").slice(0, 10))} · <span class="badge">${esc(ui.CAT_LABEL[n.category] || n.category)}</span> ${n.url ? `<a href="${esc(n.url)}">${esc(n.title)}</a>` : esc(n.title)} <span class="muted">(${esc(n.publisher || "")})</span></li>`).join("")}</ul>` : ""}

      ${nb ? `<h2>10. Investment thesis (analyst notes)</h2>
        ${[["thesis", "Thesis"], ["bull", "Bull case"], ["bear", "Bear case"], ["risks", "Key risks"], ["catalysts", "Catalysts"]].filter(([k]) => nb[k]).map(([k, l]) => `<h3>${l}</h3><p style="white-space:pre-wrap">${esc(nb[k])}</p>`).join("")}
        ${nb.assumptions?.length ? `<h3>Tracked assumptions</h3><ul>${nb.assumptions.map((a) => `<li>${esc(r.metrics[a.metric]?.label || a.metric)} ${esc(a.op)} ${esc(a.value)} - now ${fmt.n(r.metrics[a.metric]?.value, 2)}</li>`).join("")}</ul>` : ""}
        ${nb.checks?.length ? `<p>Last thesis check: <strong>${esc(nb.checks.at(-1).status)}</strong> - ${esc(nb.checks.at(-1).headline)}</p>` : ""}` : ""}

      <h2>Appendix: sources & methodology</h2>
      <table class="compact"><thead><tr><th class="l">Data</th><th class="l">Provider</th><th>As of</th><th>Fetched</th><th>Type</th></tr></thead><tbody>
        ${[...(r.sources || []), ...(ext.sources || [])].filter((s) => s.provider !== "investiq").map((s) => `<tr><td class="l">${esc(s.dataset)}</td><td class="l">${esc(s.provider_label)}</td><td>${esc(s.as_of || "—")}</td><td>${esc((s.fetched_at || "").slice(0, 16).replace("T", " "))}</td><td>${esc(s.status)}</td></tr>`).join("")}
      </tbody></table>
      <ul class="method-list" style="font-size:11.5px">${(r.sources || []).filter((s) => s.provider === "investiq").map((s) => `<li><strong>${esc(s.dataset.replace(/^method_/, "").replace(/_/g, " "))}</strong>: ${esc(s.methodology || "")}</li>`).join("")}</ul>
      <p class="disclaimer">${esc(r.disclaimer)}</p>
    </article>`;
  }

  function toMarkdown(el) {
    const node = el.querySelector("#rp-doc").cloneNode(true);
    node.querySelectorAll("h1").forEach((h) => { h.textContent = "# " + h.textContent; });
    node.querySelectorAll("h2").forEach((h) => { h.textContent = "\n## " + h.textContent; });
    node.querySelectorAll("h3").forEach((h) => { h.textContent = "\n### " + h.textContent; });
    node.querySelectorAll("li").forEach((li) => { li.textContent = "- " + li.textContent.trim(); });
    node.querySelectorAll("tr").forEach((tr) => { tr.textContent = "| " + [...tr.children].map((c) => c.textContent.trim().replace(/\s+/g, " ")).join(" | ") + " |"; });
    return node.innerText.replace(/\n{3,}/g, "\n\n");
  }

  window.views.reports = {
    title: "Reports",
    async render(el, arg, ctx) {
      if (!arg) return picker(el);
      const [sym, opt] = arg.split("/");
      const nb = opt?.startsWith("nb:") ? store.workspace.get(opt.slice(3)) : store.workspace.forSymbol(sym)[0] || null;
      el.innerHTML = ui.skeleton(10, true);
      let r;
      try { r = await data.report(sym); } catch (err) { if (ctx.alive()) el.innerHTML = ui.errorBox(err); return; }
      if (!ctx.alive()) return;
      ctx.setTitle(`${r.symbol} report`);
      let ai = null;
      const paint = () => {
        el.innerHTML = `<div class="page-head no-print"><div><div class="crumbs"><a href="#/reports">Reports</a></div><h1>${esc(r.name)} research report</h1>
            <p class="sub muted">${nb ? `Includes your notebook “${esc(nb.title)}”. ` : ""}Use Print → “Save as PDF” for a PDF.</p></div>
          <div class="row"><button class="btn" id="rp-ai">${ui.icon("ai")} ${ai ? "AI summary added" : "Add AI summary"}</button><button class="btn" id="rp-md">${ui.icon("download")} Markdown</button><button class="btn primary" id="rp-print">${ui.icon("print")} Print / PDF</button></div></div>
          ${doc(r, nb, ai)}`;
        el.querySelector("#rp-print").addEventListener("click", () => window.print());
        el.querySelector("#rp-md").addEventListener("click", () => ui.download(`${r.symbol}-investiq-report.md`, toMarkdown(el), "text/markdown"));
        el.querySelector("#rp-ai").disabled = !!ai;
        el.querySelector("#rp-ai").addEventListener("click", async () => {
          const b = el.querySelector("#rp-ai");
          b.disabled = true; b.textContent = "Writing AI summary…";
          try { ai = await data.aiSummary(r.symbol); if (ctx.alive()) paint(); } catch (err) { if (ctx.alive()) { ui.toast("AI summary unavailable", err.message, 8000); b.disabled = false; b.textContent = "Add AI summary"; } }
        });
      };
      paint();
    },
  };
})();
