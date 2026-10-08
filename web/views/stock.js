/* Research: the company page - the centre of the terminal.
   #/research            -> search landing (recent, watchlist, popular)
   #/research/SYM[/tab]  -> tabs: overview, financials, valuation, earnings, ownership, news,
                            filings, peers, risk, performance, ai, sources
   Every metric shows its source / period / status on hover; every section names its source. */
(function () {
  const { esc } = fmt;
  const { T, why } = glossary;
  const data = window.investiqData;

  const TABS = [["overview", "Overview"], ["financials", "Financials"], ["valuation", "Valuation"], ["earnings", "Earnings"],
    ["ownership", "Ownership & dividends"], ["news", "News"], ["filings", "Filings"], ["peers", "Peers"], ["risk", "Risk"],
    ["performance", "Performance & technicals"], ["ai", "AI analysis"], ["sources", "Sources"]];
  const RANGES = [["1M", 1], ["6M", 6], ["YTD", "ytd"], ["1Y", 12], ["2Y", 24], ["5Y", 60], ["10Y", 120], ["MAX", null]];

  function rangeStart(lastDate, months) {
    const d = new Date(lastDate + "T00:00:00");
    if (months === null) return "0000-00-00";
    if (months === "ytd") return `${d.getFullYear()}-01-01`;
    d.setMonth(d.getMonth() - months);
    return d.toISOString().slice(0, 10);
  }
  const stat = (label, value, sub, key) => `<div class="stat"><div class="label">${T(label, key)}</div><div class="value">${value}</div>${sub ? `<div class="meta">${sub}</div>` : ""}</div>`;
  const row = (label, value, key) => `<tr><td>${T(label, key)}</td><td>${value}</td></tr>`;
  const stanceLabel = (s) => ({ bullish: "▲ Bullish", bearish: "▼ Bearish", neutral: "● Neutral" }[s] || s);
  const extSrc = (r, id) => {
    const s = (r.extended?.sources || []).find((x) => x.id === id) || (r.sources || []).find((x) => x.id === id);
    return s ? ui.srcNote(s) : "";
  };

  function fairRange(fv, price, cur) {
    const lo = Math.min(fv.low, price) * 0.9;
    const hi = Math.max(fv.high, price) * 1.1;
    const x = (v) => ((v - lo) / (hi - lo)) * 100;
    return `<div class="range" role="img" aria-label="Fair value range ${fmt.money(fv.low, cur)} to ${fmt.money(fv.high, cur)}, price ${fmt.money(price, cur)}">
      <div class="rail"></div><div class="fv" style="left:${x(fv.low)}%;width:${x(fv.high) - x(fv.low)}%"></div>
      <div class="marker" style="left:${x(price)}%"><span>Price ${fmt.money(price, cur, 0)}</span></div>
      <div class="marker mid" style="left:${x(fv.mid)}%"><span>Fair ${fmt.money(fv.mid, cur, 0)}</span></div></div>
    <p class="sub">Estimated range ${fmt.money(fv.low, cur, 0)} – ${fmt.money(fv.high, cur, 0)}</p>`;
  }

  /* ================= header ================= */
  function header(r) {
    const f = r.fundamentals, q = r.quote, cur = r.currency;
    const o = r.chart.ohlc;
    const li = o && o.dates.length ? o.dates.length - 1 : -1;
    return `<section class="card">
      <div class="stock-head">
        <div><div class="crumbs"><a href="#/research">Research</a> / ${esc(f.sector || r.market)}</div>
          <h1>${esc(r.name)}</h1>
          <div class="meta"><span class="ticker">${esc(r.symbol)}</span> · ${(() => { const b = brands.forExchange(f.exchange, r.symbol); return b ? `<span class="with-logo" title="Listed on ${esc(brands.ALL[b].name)}">${brands.logo(b, { size: 14 })}</span> ` : ""; })()}${esc(f.exchange || r.market)}${f.industry ? " · " + esc(f.industry) : ""} · ${esc(cur)}${f.market_cap_category ? " · " + esc(f.market_cap_category) : ""}</div></div>
        <div><div class="price">${fmt.money(q.price, cur)}</div>
          <div class="delta ${fmt.signedClass(q.change)}">${q.change >= 0 ? "▲" : "▼"} ${fmt.money(Math.abs(q.change), cur)} (${fmt.pct(q.change_pct, 2)})</div></div>
        <div class="row no-print">
          <button class="btn" id="s-wl"></button>
          <a class="btn" href="#/compare/${encodeURIComponent(r.symbol)}">${ui.icon("compare")} Compare</a>
          <button class="btn" id="s-nb">${ui.icon("workspace")} Notebook</button>
          <a class="btn" href="#/alerts/new/${encodeURIComponent(r.symbol)}">${ui.icon("alerts")} Alert</a>
          <a class="btn" href="#/reports/${encodeURIComponent(r.symbol)}">${ui.icon("reports")} Report</a>
        </div>
      </div>
      <div class="ohlc" id="s-ohlc">${li >= 0 ? ohlcRow(o, li, r) : ""}</div>
      <div class="data-badges">${sections.freshness(r)}</div>
    </section>`;
  }
  function ohlcRow(o, i, r) {
    const cur = r.currency;
    const vi = r.chart.dates.lastIndexOf(o.dates[i]);
    const vol = vi >= 0 ? r.chart.volume[vi] : null;
    return `<span>${fmt.date(o.dates[i])}</span><span>O <b>${fmt.money(o.open[i], cur)}</b></span><span>H <b>${fmt.money(o.high[i], cur)}</b></span>
      <span>L <b>${fmt.money(o.low[i], cur)}</b></span><span>C <b>${fmt.money(o.close[i], cur)}</b></span>${vol != null ? `<span>Vol <b>${fmt.n(vol, 0)}</b></span>` : ""}
      <span>52W <b>${fmt.money(r.risk.week52.low, cur, 0)} – ${fmt.money(r.risk.week52.high, cur, 0)}</b></span>`;
  }

  /* ================= tabs ================= */
  const METRIC_GROUPS = [
    ["Valuation", ["market_cap", "pe", "forward_pe", "pb", "ps", "ev_ebitda", "peg", "fcf_yield_pct", "dividend_yield_pct", "fair_value", "margin_of_safety_pct"]],
    ["Profitability", ["roe_pct", "roce_pct", "roic_pct", "gross_margin_pct", "operating_margin_pct", "net_margin_pct", "eps"]],
    ["Growth", ["revenue_cagr_pct", "profit_cagr_pct", "revenue_growth_pct", "implied_growth_pct"]],
    ["Financial health", ["debt_to_equity", "current_ratio", "interest_coverage", "free_cash_flow", "piotroski", "altman_z"]],
    ["Market & risk", ["return_1y_pct", "cagr_5y_pct", "cagr_10y_pct", "volatility_pct", "max_drawdown_pct", "beta", "rsi", "score"]],
  ];

  function tabOverview(r) {
    const sc = r.scorecard, f = r.fundamentals, ext = r.extended || {};
    const up = ext.earnings?.upcoming?.[0];
    return `
      <section class="card section">
        <div class="card-head"><h2>Price chart</h2><div class="row" id="c-ctl">${ui.seg([["line", "Line"], ["candles", "Candles"]], "line", "mode")}</div></div>
        ${sections.srcLine(r, "chart")}
        <div class="toolbar">
          <div class="seg" id="range-seg">${RANGES.map(([l]) => `<button type="button" data-range="${l}">${l}</button>`).join("")}</div>
          <label class="toggle"><input type="checkbox" id="t-sma50"> <span class="swatch" style="background:var(--series-3)"></span> SMA 50</label>
          <label class="toggle"><input type="checkbox" id="t-sma200"> <span class="swatch" style="background:var(--series-4)"></span> SMA 200</label>
          ${r.benchmark_chart ? `<label class="toggle"><input type="checkbox" id="t-index"> vs ${charts.indexName(r.benchmark)} (rebased)</label>` : ""}
        </div>
        <div class="chart-box tall"><canvas id="price-chart" aria-label="Price chart"></canvas></div>
        <div class="chart-box" style="height:70px"><canvas id="vol-chart" aria-label="Volume"></canvas></div>
        <p class="sub" id="range-return" style="margin-top:6px"></p>
      </section>
      <section class="grid grid-3 section">
        <div class="card span-2"><h2>InvestIQ summary</h2>${why("A rule-based summary of the whole report. For a cited AI write-up, open the AI analysis tab.")}
          <p class="summary">${esc(r.summary)}</p>
          <div class="grid grid-2" style="gap:12px;margin-top:8px">
            <div><h3 style="margin-top:0">Strengths</h3><ul class="pill-list">${(sc.strengths.length ? sc.strengths : ["None stood out"]).map((s) => `<li><span class="icon good">+</span>${esc(s)}</li>`).join("")}</ul></div>
            <div><h3 style="margin-top:0">Risks</h3><ul class="pill-list">${(sc.risks.length ? sc.risks : ["None stood out"]).map((s) => `<li><span class="icon bad">!</span>${esc(s)}</li>`).join("")}</ul></div>
          </div>
          <div style="margin-top:10px"><a class="btn sm" href="#" data-goto="ai">${ui.icon("ai")} AI investment summary with citations</a></div></div>
        <div class="card"><h2>${T("Scorecard", "scorecard")}</h2>
          <div class="score-ring"><div class="score-num">${sc.overall ?? "—"}<span class="muted" style="font-size:16px">/10</span></div>
            <div><div class="score-rating">${esc(sc.rating)}</div><div class="muted" style="font-size:12px">Performance 25% · quality 25% · valuation 20% · safety 20% · momentum 10%</div></div></div>
          <div class="score-bars">${Object.entries(sc.scores).map(([k, v]) => `<div class="score-bar"><span style="text-transform:capitalize">${T(k[0].toUpperCase() + k.slice(1), "score_" + k)}</span>
            <div class="track"><div class="fill" style="width:${(v ?? 0) * 10}%"></div></div><span class="val">${v ?? "—"}</span></div>`).join("")}</div>
          <p class="sub">Valuation: <strong>${esc(r.valuation.verdict)}</strong> · Risk: <strong>${esc(r.risk_profile?.level || r.risk.risk_level)}</strong> · Checklist ${r.checklist.passed}/${r.checklist.evaluated}</p></div>
      </section>
      <section class="card section"><div class="card-head"><h2>Key metrics</h2><span class="muted" style="font-size:12px">Hover a value for source, period and status · badges use InvestIQ thresholds</span></div>
        ${METRIC_GROUPS.map(([g, keys]) => `<h3>${g}</h3><div class="stats">${keys.map((k) => ui.metricStat(r, k)).join("")}</div>`).join("")}
      </section>
      <section class="grid grid-3 section">
        <div class="card span-2"><div class="card-head"><h2>Latest news</h2><a class="btn sm" href="#" data-goto="news">All news</a></div>
          ${(ext.news || []).slice(0, 5).map((n) => ui.newsItem(n)).join("") || ui.empty("No recent news", "No headlines from the news sources for this company.", "", "news")}</div>
        <div class="card"><h2>Events</h2>
          <table class="compact"><tbody>
            ${row("Next earnings", up ? `${fmt.date(up.date)}${up.eps_estimate != null ? ` <span class="muted">EPS est ${fmt.n(up.eps_estimate, 2)}</span>` : ""}` : "—")}
            ${row("Ex-dividend date", ext.earnings?.ex_dividend_date ? fmt.date(ext.earnings.ex_dividend_date) : "—")}
            ${row("Analysts", f.analyst?.analysts ? `${f.analyst.analysts} · ${esc(f.analyst.recommendation || "n/a")}` : "—")}
            ${row("Target range", f.analyst?.target_low ? `${fmt.money(f.analyst.target_low, r.currency, 0)} – ${fmt.money(f.analyst.target_high, r.currency, 0)}` : "—")}
            ${row("Employees", f.employees ? fmt.n(f.employees, 0) : "—")}
          </tbody></table></div>
      </section>
      ${f.description ? `<section class="card section"><h2>About the company</h2><p style="color:var(--text-secondary);margin:6px 0 0;font-size:13px">${esc(f.description)}</p>${f.website ? `<p><a href="${esc(f.website)}" target="_blank" rel="noopener">${esc(f.website)} ${ui.icon("external")}</a></p>` : ""}</section>` : ""}`;
  }

  function bindChart(el, r) {
    const $ = (s) => el.querySelector(s);
    const cur = r.currency, q = r.quote;
    const prefs = store.get("chart", { range: "1Y", sma50: false, sma200: true, vsIndex: false, mode: "line" });
    const ctl = { sma50: $("#t-sma50"), sma200: $("#t-sma200"), vsIndex: $("#t-index") };
    Object.entries(ctl).forEach(([k, c]) => { if (c) c.checked = !!prefs[k]; });
    const hasOhlc = !!(r.chart.ohlc && r.chart.ohlc.dates.length);
    const draw = () => {
      const months = RANGES.find(([l]) => l === prefs.range)[1];
      const start = rangeStart(r.as_of, months);
      const candleOk = hasOhlc && r.chart.ohlc.dates[0] <= start;
      const mode = prefs.mode === "candles" && candleOk ? "candles" : "line";
      $("#c-ctl").querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
      el.querySelectorAll("#range-seg button").forEach((b) => b.classList.toggle("on", b.dataset.range === prefs.range));
      const opts = { sma50: ctl.sma50.checked, sma200: ctl.sma200.checked, vsIndex: ctl.vsIndex ? ctl.vsIndex.checked : false };
      ctl.sma50.disabled = ctl.sma200.disabled = opts.vsIndex || mode === "candles";
      if (ctl.vsIndex) ctl.vsIndex.disabled = mode === "candles";
      store.set("chart", { ...prefs, ...opts });
      const i0 = Math.max(0, r.chart.dates.findIndex((d) => d >= start));
      if (mode === "candles") {
        const o = r.chart.ohlc;
        const j0 = Math.max(0, o.dates.findIndex((d) => d >= start));
        charts.candles($("#price-chart"), o, j0, cur, (i) => { const h = document.getElementById("s-ohlc"); if (h) h.innerHTML = ohlcRow(o, i, r); });
        const vols = o.dates.slice(j0).map((d) => r.chart.volume[r.chart.dates.lastIndexOf(d)]);
        charts.volume($("#vol-chart"), o.dates.slice(j0), vols, o.close.slice(j0), true);
      } else {
        charts.price($("#price-chart"), r, start, opts);
        charts.volume($("#vol-chart"), r.chart.dates.slice(i0), r.chart.volume.slice(i0), r.chart.close.slice(i0), false);
      }
      const first = r.chart.close[i0];
      const slice = r.chart.close.slice(i0);
      $("#range-return").innerHTML = `${prefs.range}: ${fmt.pctSpan((q.price / first - 1) * 100)} · high ${fmt.money(Math.max(...slice), cur)} · low ${fmt.money(Math.min(...slice), cur)}${prefs.mode === "candles" && mode !== "candles" ? ' · <span class="muted">candles cover the last 2 years - showing a line</span>' : ""}`;
    };
    $("#range-seg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { prefs.range = b.dataset.range; draw(); } });
    ui.bindChoice($("#c-ctl"), "mode", (m) => { prefs.mode = m; draw(); });
    Object.values(ctl).forEach((c) => c && c.addEventListener("change", draw));
    draw();
  }

  function tabFinancials(r) {
    const f = r.fundamentals, cur = r.currency;
    const qs = r.extended?.quarterly || [];
    return `
      <section class="section grid grid-2">
        <div class="card"><h2>Revenue & profit</h2>${sections.srcLine(r, "financials")}
          <p class="sub">Annual statements · revenue CAGR ${fmt.pct(f.revenue_cagr_pct)} · profit CAGR ${fmt.pct(f.profit_cagr_pct)}</p>
          ${f.statements.length ? `<div class="legend"><span><span class="swatch" style="background:var(--series-1);height:10px"></span> Revenue</span><span><span class="swatch" style="background:var(--series-2);height:10px"></span> Net income</span></div>
            <div class="chart-box short"><canvas id="fin-chart" aria-label="Revenue and profit"></canvas></div>` : ui.empty("No statements", "Financial statements are not available for this symbol.")}</div>
        <div class="card"><h2>Financial health</h2>${sections.srcLine(r, "fundamentals")}
          <div class="stats">${["debt_to_equity", "current_ratio", "interest_coverage", "free_cash_flow", "piotroski", "altman_z", "roic_pct", "roce_pct"].map((k) => ui.metricStat(r, k)).join("")}</div>
          <div class="table-wrap"><table class="compact"><tbody>
            ${row("Total debt", fmt.big(f.total_debt, cur))}${row("Cash", fmt.big(f.total_cash, cur))}
            ${row("Book value / share", fmt.money(f.book_value_per_share, cur))}${row("Return on assets", fmt.pct(f.roa_pct, 1, false))}
            ${row("Revenue growth (latest)", fmt.pct(f.revenue_growth_pct), "revenue")}${row("Earnings growth (latest)", fmt.pct(f.earnings_growth_pct), "net_income")}
          </tbody></table></div></div>
      </section>
      <section class="card section"><div class="card-head"><h2>Quarterly results</h2>${qs.length ? `<button class="btn sm" id="q-csv">${ui.icon("download")} CSV</button>` : ""}</div>
        ${qs.length ? `<div class="table-wrap"><table class="compact"><thead><tr><th class="l">Quarter ended</th><th>Revenue</th><th>Rev YoY</th><th>Net income</th><th>NI YoY</th><th>Op. margin</th><th>Net margin</th><th>EPS</th><th>FCF</th></tr></thead><tbody>
          ${[...qs].reverse().map((x) => `<tr><td class="l">${fmt.date(x.period_end)}</td><td>${fmt.big(x.revenue, cur)}</td><td>${ui.chg(x.revenue_yoy_pct, 1)}</td><td>${fmt.big(x.net_income, cur)}</td>
            <td>${ui.chg(x.net_income_yoy_pct, 1)}</td><td>${fmt.pct(x.operating_margin_pct, 1, false)}</td><td>${fmt.pct(x.net_margin_pct, 1, false)}</td><td>${fmt.n(x.eps, 2)}</td><td>${fmt.big(x.free_cash_flow, cur)}</td></tr>`).join("")}
          </tbody></table></div>${extSrc(r, "quarterly") || '<p class="prov">Quarterly statements · Yahoo Finance · reported figures</p>'}`
          : ui.empty("No quarterly data", "Quarterly statements were not available from the data source.")}
      </section>
      ${sections.financials(r)}`;
  }

  function tabValuation(r) {
    const val = r.valuation, q = r.quote, cur = r.currency, f = r.fundamentals, proj = r.projection;
    return `
      <section class="card section"><h2>${T("Fair value estimate", "fair_value")}</h2>${sections.srcLine(r, "valuation")}
        <p class="sub">Growth assumption ${fmt.pct(val.growth_assumption_pct, 1, false)}${val.discount_rate_pct ? ` · discount rate ${fmt.pct(val.discount_rate_pct, 0, false)}` : ""} · <span class="badge">Calculated</span></p>
        ${val.fair_value ? `<div><span class="verdict">${esc(val.verdict)}</span> <span class="muted">· ${T("margin of safety", "margin_of_safety")} ${fmt.pct(val.margin_of_safety_pct)}</span></div>${fairRange(val.fair_value, q.price, cur)}` : `<p class="muted">${esc(val.verdict)}</p>`}
        <div class="table-wrap"><table><thead><tr><th class="l">Method</th><th>Value</th><th>vs price</th><th class="l">How it works</th></tr></thead>
          <tbody>${val.methods.map((m) => `<tr><td class="l">${T(m.method)}</td><td>${fmt.money(m.value, cur)}</td><td>${fmt.pctSpan(m.upside_pct)}</td><td class="wrap l">${esc(m.note)}</td></tr>`).join("")}</tbody></table></div>
        ${f.analyst?.analysts ? `<p class="sub" style="margin-top:10px">Analysts (${f.analyst.analysts}): target ${fmt.money(f.analyst.target_low, cur, 0)} – ${fmt.money(f.analyst.target_high, cur, 0)}, consensus “${esc(f.analyst.recommendation || "n/a")}” <span class="badge">Estimate</span></p>` : ""}
        <p class="disclaimer">${esc(val.note || "")}</p></section>
      <section class="card section"><h2>Multiples</h2><div class="stats">${["pe", "forward_pe", "pb", "ps", "peg", "ev_ebitda", "ev_sales", "earnings_yield_pct", "fcf_yield_pct", "dividend_yield_pct", "implied_growth_pct"].map((k) => ui.metricStat(r, k)).join("")}</div></section>
      ${sections.valuationExtra(r)}
      <section class="section grid grid-2">
        <div class="card"><h2>Future price scenarios</h2>${sections.srcLine(r, "projection")}
          <p class="sub">Expected return ${fmt.pct(proj.assumptions.expected_return_pct, 1, false)}/yr · volatility ${fmt.pct(proj.assumptions.volatility_pct, 0, false)} · <span class="badge">Estimate</span></p>
          <div class="chart-box"><canvas id="fan-chart" aria-label="Future scenarios"></canvas></div>
          <div class="table-wrap"><table class="compact"><thead><tr><th>Horizon</th><th>${T("Bear", "bear_bull")}</th><th>Base</th><th>Bull</th><th>${T("Chance of loss")}</th></tr></thead>
            <tbody>${proj.horizons.map((h) => `<tr><td>${h.years}Y</td><td>${fmt.money(h.bear.price, cur, 0)}</td><td>${fmt.money(h.base.price, cur, 0)}</td><td>${fmt.money(h.bull.price, cur, 0)}</td><td>${fmt.pct(proj.probability_of_loss_pct[h.years + "Y"], 0, false)}</td></tr>`).join("")}</tbody></table></div>
          <p class="disclaimer">${esc(proj.note)}</p></div>
        <div class="card"><h2>Investment planner</h2><p class="sub">Lump sum and/or monthly SIP at this stock's scenario returns</p>
          <div class="calc"><label>Lump sum<input id="c-lump" type="number" min="0" step="1000" value="${cur === "INR" ? 100000 : 1000}"></label>
            <label>Monthly SIP<input id="c-sip" type="number" min="0" step="500" value="${cur === "INR" ? 5000 : 100}"></label>
            <label>Years<input id="c-years" type="number" min="1" max="40" value="10"></label></div>
          <div class="calc-out" id="calc-out"></div>
          <p class="sub">10-year bear / base / bull rates: ${fmt.pct(proj.scenario_rates_pct.bear)}, ${fmt.pct(proj.scenario_rates_pct.base)}, ${fmt.pct(proj.scenario_rates_pct.bull)}.</p></div>
      </section>
      ${sections.decision(r)}`;
  }
  function bindValuation(el, r) {
    const $ = (s) => el.querySelector(s);
    const proj = r.projection, cur = r.currency;
    charts.fan($("#fan-chart"), proj, cur);
    const calc = () => {
      const lump = +$("#c-lump").value || 0, sip = +$("#c-sip").value || 0;
      const years = Math.min(40, Math.max(1, +$("#c-years").value || 1));
      const invested = lump + sip * 12 * years;
      $("#calc-out").innerHTML = ["bear", "base", "bull"].map((k) => {
        const rate = (proj.scenario_rates_pct[k] || 0) / 100, m = Math.pow(1 + rate, 1 / 12) - 1, n = years * 12;
        const v = lump * Math.pow(1 + rate, years) + (m === 0 ? sip * n : sip * ((Math.pow(1 + m, n) - 1) / m) * (1 + m));
        return `<div class="box"><div class="label">${k}</div><div class="value">${fmt.big(v, cur)}</div><div class="${fmt.signedClass(v - invested)}" style="font-size:12px">${invested ? fmt.pct((v / invested - 1) * 100, 0) : "—"} on ${fmt.big(invested, cur)}</div></div>`;
      }).join("");
    };
    ["#c-lump", "#c-sip", "#c-years"].forEach((s) => $(s).addEventListener("input", calc));
    calc();
  }

  function tabEarnings(r) {
    const e = r.extended?.earnings || {}, an = r.extended?.analyst || {}, cur = r.currency;
    const hist = e.history || [];
    const up = e.upcoming?.[0];
    const beats = hist.filter((h) => h.surprise_pct != null && h.surprise_pct >= 0).length;
    const scored = hist.filter((h) => h.surprise_pct != null).length;
    const trend = an.trend?.[0];
    const estTable = (rows, title, money) => rows?.length ? `<h3>${title}</h3><div class="table-wrap"><table class="compact"><thead><tr><th class="l">Period</th><th>Average</th><th>Low</th><th>High</th><th>Year ago</th><th>Growth</th><th>Analysts</th></tr></thead><tbody>
      ${rows.map((x) => `<tr><td class="l">${esc(x.period)}</td><td>${money ? fmt.big(x.avg, cur) : fmt.n(x.avg, 2)}</td><td>${money ? fmt.big(x.low, cur) : fmt.n(x.low, 2)}</td><td>${money ? fmt.big(x.high, cur) : fmt.n(x.high, 2)}</td><td>${money ? fmt.big(x.year_ago, cur) : fmt.n(x.year_ago, 2)}</td><td>${ui.chg(x.growth_pct, 1)}</td><td>${x.analysts ?? "—"}</td></tr>`).join("")}</tbody></table></div>` : "";
    return `
      <div class="grid grid-4 section">
        <div class="kpi"><div class="label">Next report</div><div class="value">${up ? fmt.date(up.date) : "—"}</div><div class="muted" style="font-size:12px">${up?.eps_estimate != null ? "EPS est " + fmt.n(up.eps_estimate, 2) : ""}</div></div>
        <div class="kpi"><div class="label">Beat rate</div><div class="value">${scored ? `${beats}/${scored}` : "—"}</div><div class="muted" style="font-size:12px">quarters at or above EPS estimate</div></div>
        <div class="kpi"><div class="label">Next-quarter revenue est.</div><div class="value">${fmt.big(e.revenue_estimate_next, cur)}</div><div class="muted" style="font-size:12px">analyst consensus · estimate</div></div>
        <div class="kpi"><div class="label">Analyst ratings</div><div class="value">${trend ? `${(trend.strongBuy || 0) + (trend.buy || 0)} buy · ${trend.hold || 0} hold · ${(trend.sell || 0) + (trend.strongSell || 0)} sell` : "—"}</div></div>
      </div>
      <section class="section grid grid-2">
        <div class="card"><h2>EPS: estimate vs actual</h2>
          ${hist.length ? `<div class="chart-box short"><canvas id="eps-chart" aria-label="EPS surprise"></canvas></div>
            <div class="table-wrap"><table class="compact"><thead><tr><th class="l">Reported</th><th>Estimate</th><th>Actual</th><th>Surprise</th></tr></thead><tbody>
            ${hist.map((h) => `<tr><td class="l">${fmt.date(h.date)}</td><td>${fmt.n(h.eps_estimate, 2)}</td><td>${fmt.n(h.eps_actual, 2)}</td><td>${h.surprise_pct == null ? "—" : `<span class="badge ${h.surprise_pct >= 0 ? "good" : "bad"}">${h.surprise_pct >= 0 ? "Beat" : "Miss"} ${fmt.pct(h.surprise_pct, 1)}</span>`}</td></tr>`).join("")}
            </tbody></table></div>` : ui.empty("No earnings history", "The data source returned no earnings dates for this company.")}
          ${extSrc(r, "earnings")}</div>
        <div class="card"><h2>Analyst actions</h2>
          ${an.actions?.length ? `<div class="table-wrap"><table class="compact"><thead><tr><th class="l">Date</th><th class="l">Firm</th><th class="l">Action</th><th>Target</th></tr></thead><tbody>
            ${an.actions.slice(0, 12).map((a) => `<tr><td class="l">${fmt.date(a.date)}</td><td class="l">${esc(a.firm || "")}</td><td class="l"><span class="${a.action === "down" ? "down" : a.action === "up" ? "up" : ""}">${esc(a.from_grade ? `${a.from_grade} → ${a.to_grade}` : a.to_grade || a.action || "")}</span></td><td>${a.price_target ? fmt.money(a.price_target, cur, 0) : "—"}</td></tr>`).join("")}
            </tbody></table></div>` : ui.empty("No analyst actions", "No recent upgrades or downgrades were reported.")}
          ${an.targets && Object.keys(an.targets).length ? `<p class="sub">Price targets: low ${fmt.money(an.targets.low, cur, 0)} · mean ${fmt.money(an.targets.mean, cur, 0)} · high ${fmt.money(an.targets.high, cur, 0)} <span class="badge">Estimate</span></p>` : ""}
          ${extSrc(r, "analyst")}</div>
      </section>
      ${e.eps_estimates?.length || e.revenue_estimates?.length ? `<section class="card section"><h2>Consensus estimates</h2>${estTable(e.eps_estimates, "EPS", false)}${estTable(e.revenue_estimates, "Revenue", true)}<p class="prov">Analyst estimates (not reported results)</p></section>` : ""}`;
  }
  function bindEarnings(el, r) {
    const hist = (r.extended?.earnings?.history || []).filter((h) => h.surprise_pct != null).slice().reverse();
    const c = el.querySelector("#eps-chart");
    if (c && hist.length) charts.bars(c, hist.map((h) => fmt.date(h.date)), hist.map((h) => h.surprise_pct), "EPS surprise", (v) => fmt.pct(v, 1), true);
  }

  function tabOwnership(r) {
    const o = r.extended?.ownership || {}, cur = r.currency;
    const ins = o.insider_transactions || [];
    const buys = ins.filter((t) => /buy|purchase/i.test(t.transaction + " " + t.text)).length;
    const sells = ins.filter((t) => /sale|sell/i.test(t.transaction + " " + t.text)).length;
    const holders = (rows, title) => rows?.length ? `<div class="card"><h2>${title}</h2><div class="table-wrap"><table class="compact"><thead><tr><th class="l">Holder</th><th>% held</th><th>Shares</th><th>Change</th><th>Reported</th></tr></thead><tbody>
      ${rows.map((h) => `<tr><td class="l">${esc(h.holder)}</td><td>${fmt.pct(h.pct_held, 2, false)}</td><td>${fmt.n(h.shares, 0)}</td><td>${ui.chg(h.pct_change, 1)}</td><td>${fmt.date(h.date)}</td></tr>`).join("")}</tbody></table></div>${extSrc(r, "ownership")}</div>` : "";
    return `
      ${sections.dividends(r)}
      <div class="grid grid-4 section">
        <div class="kpi"><div class="label">Insiders / promoters</div><div class="value">${fmt.pct(o.major?.insiders_pct ?? r.fundamentals.insiders_pct, 1, false)}</div></div>
        <div class="kpi"><div class="label">Institutions</div><div class="value">${fmt.pct(o.major?.institutions_pct ?? r.fundamentals.institutions_pct, 1, false)}</div></div>
        <div class="kpi"><div class="label">Institutional holders</div><div class="value">${o.major?.institutions_count ? fmt.n(o.major.institutions_count, 0) : "—"}</div></div>
        <div class="kpi"><div class="label">Insider trades (recent)</div><div class="value">${ins.length ? `<span class="up">${buys} buy</span> · <span class="down">${sells} sell</span>` : "—"}</div></div>
      </div>
      <section class="section grid grid-2">${holders(o.institutions, "Top institutions")}${holders(o.funds, "Top mutual funds")}</section>
      <section class="card section"><h2>Insider activity</h2>
        ${ins.length ? `<div class="table-wrap"><table class="compact"><thead><tr><th class="l">Date</th><th class="l">Insider</th><th class="l">Role</th><th class="l">Transaction</th><th>Shares</th><th>Value</th></tr></thead><tbody>
          ${ins.map((t) => `<tr><td class="l">${fmt.date(t.date)}</td><td class="l">${esc(t.insider || "")}</td><td class="l">${esc(t.position || "")}</td><td class="l wrap">${esc(t.transaction || t.text || "")}</td><td>${fmt.n(t.shares, 0)}</td><td>${t.value ? fmt.big(t.value, cur) : "—"}</td></tr>`).join("")}
          </tbody></table></div>` : ui.empty("No insider transactions", r.market === "IN" ? "Indian insider (SAST/PIT) disclosures are published on NSE/BSE - see the Filings tab links." : "No recent insider transactions were reported.")}
        ${extSrc(r, "ownership")}</section>`;
  }

  function tabNews(r) {
    const items = r.extended?.news || [];
    const cats = [...new Set(items.map((n) => n.category))];
    const moves = r.extended?.moves || [];
    return `
      <section class="section grid grid-3">
        <div class="card span-2"><div class="card-head"><h2>News</h2><div class="chips" id="n-cats"><button class="chip on" data-cat="">All</button>${cats.map((c) => `<button class="chip" data-cat="${esc(c)}">${esc(ui.CAT_LABEL[c] || c)}</button>`).join("")}</div></div>
          <div id="n-list">${items.map((n) => ui.newsItem(n)).join("") || ui.empty("No news", "No headlines were returned for this company.", "", "news")}</div>
          ${extSrc(r, "news")}<p class="prov">Categories assigned by keyword rules; "stock ±x% that day" links each story to that day's price move.</p></div>
        <div class="card"><h2>Why did it move?</h2>${why("The biggest one-day moves of the past year, with the headlines published around each date.")}
          ${moves.length ? moves.map((m) => `<div class="news-item"><div class="meta"><strong>${fmt.date(m.date)}</strong> ${ui.chg(m.change_pct)}</div>
            ${m.headlines.length ? m.headlines.map((h) => `<div style="font-size:12.5px">${h.url ? `<a href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.title)}</a>` : esc(h.title)} <span class="badge">${esc(ui.CAT_LABEL[h.category] || h.category)}</span></div>`).join("")
              : '<div class="muted" style="font-size:12px">No headline found near this date - possibly market-wide or unreported.</div>'}</div>`).join("") : '<p class="muted">No large moves matched to news.</p>'}
          <a class="btn sm" href="#" data-goto="ai" style="margin-top:8px">${ui.icon("ai")} Ask AI why it moved</a></div>
      </section>`;
  }
  function bindNews(el, r) {
    const box = el.querySelector("#n-cats");
    if (!box) return;
    ui.bindChoice(box, "cat", (cat) => {
      const items = (r.extended?.news || []).filter((n) => !cat || n.category === cat);
      el.querySelector("#n-list").innerHTML = items.map((n) => ui.newsItem(n)).join("") || '<p class="muted">None.</p>';
    });
  }

  function tabFilings(r) {
    const fl = r.extended?.filings || {};
    return `<section class="card section"><h2>Filings & announcements</h2>
      ${fl.items?.length ? `<div class="table-wrap"><table class="compact"><thead><tr><th class="l">Date</th><th class="l">Type</th><th class="l">Title</th><th class="l">Exhibits</th></tr></thead><tbody>
        ${fl.items.map((x) => `<tr><td class="l">${fmt.date(x.date)}</td><td class="l"><span class="badge">${esc(x.type || "")}</span></td><td class="l wrap"><span class="with-logo">${brands.logo("sec", { size: 14 })}${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title || x.type)}</a>` : esc(x.title || "")}</span></td>
          <td class="l">${(x.exhibits || []).map((ex) => `<a href="${esc(ex.url)}" target="_blank" rel="noopener">${esc(ex.name)}</a>`).join(", ")}</td></tr>`).join("")}</tbody></table></div>` : ""}
      ${fl.note ? `<p class="muted" style="font-size:12.5px">${esc(fl.note)}</p>` : ""}
      ${fl.links?.length ? `<h3>Official sources</h3><div class="chips">${fl.links.map((l) => `<a class="chip with-logo" href="${esc(l.url)}" target="_blank" rel="noopener">${brands.forUrl(l.url, { size: 14 })} ${esc(l.label)} ${ui.icon("external")}</a>`).join("")}</div>` : ""}
      ${!fl.items?.length && !fl.links?.length ? ui.empty("No filings", "No filings source is available for this listing.") : ""}
      ${extSrc(r, "filings")}</section>`;
  }

  const PEER_COLS = [["price", "Price", "money"], ["market_cap", "Mkt cap", "big"], ["pe", "P/E", "x"], ["pb", "P/B", "x"], ["ev_ebitda", "EV/EBITDA", "x"],
    ["roe_pct", "ROE", "pct"], ["roce_pct", "ROCE", "pct"], ["net_margin_pct", "Net margin", "pct"], ["revenue_cagr_pct", "Rev CAGR", "pct"],
    ["debt_to_equity", "D/E", "n"], ["dividend_yield_pct", "Div yield", "pct"], ["return_1y_pct", "1Y", "pct"], ["margin_of_safety_pct", "MoS", "pct"], ["score", "Score", "score"]];
  function peerTable(p) {
    const rows = [p.target, ...p.peers];
    return `<div class="table-wrap"><table class="compact"><thead><tr><th class="l">Company</th>${PEER_COLS.map(([, l]) => `<th>${l}</th>`).join("")}</tr></thead><tbody>
      ${rows.map((x, i) => `<tr ${i ? `data-open="${esc(x.symbol)}" style="cursor:pointer"` : 'style="background:var(--accent-soft)"'}><td class="l"><span class="ticker">${esc(x.symbol)}</span> <span class="muted">${esc(x.name)}</span></td>
        ${PEER_COLS.map(([k, , u]) => `<td>${ui.fmtUnit(x[k], u, x.currency)}${x.signals?.[k] ? ` <span class="sig-dot ${x.signals[k]}" title="${x.signals[k]}"></span>` : ""}</td>`).join("")}</tr>`).join("")}
      </tbody></table></div>`;
  }
  function peerBody(p, r) {
    if (!p.peers?.length) return ui.empty("No peers found", "No other tracked stocks share this company's sector and market.");
    const ranks = p.positioning?.ranks || {};
    const LBL = Object.fromEntries(PEER_COLS.map(([k, l]) => [k, l]));
    return `${peerTable(p)}
      <div class="row" style="margin:10px 0"><a class="btn sm" href="#/compare/${[p.target, ...p.peers].slice(0, 4).map((x) => encodeURIComponent(x.symbol)).join(",")}">${ui.icon("compare")} Compare side by side</a></div>
      <h3>Competitive positioning</h3>
      <div class="table-wrap"><table class="compact"><thead><tr><th class="l">Metric</th><th>${esc(r.symbol)}</th><th>Peer median</th><th>Rank</th></tr></thead><tbody>
        ${Object.entries(ranks).map(([k, v]) => `<tr><td class="l">${esc(LBL[k] || k.replace(/_/g, " "))}</td><td>${ui.fmtUnit(v.value, k === "market_cap" || k === "revenue" ? "big" : k.endsWith("_pct") ? "pct" : "n", r.currency)}</td><td>${ui.fmtUnit(v.peer_median, k === "market_cap" || k === "revenue" ? "big" : k.endsWith("_pct") ? "pct" : "n", r.currency)}</td>
          <td><span class="badge ${v.rank === 1 ? "good" : v.rank === v.of ? "bad" : ""}">${v.rank} of ${v.of}</span></td></tr>`).join("")}
      </tbody></table></div>
      ${p.positioning?.share_of_peer_revenue_pct != null ? `<p class="sub">Share of tracked peer revenue: <strong>${fmt.pct(p.positioning.share_of_peer_revenue_pct, 1, false)}</strong>. ${esc(p.positioning.note || "")}</p>` : ""}
      <p class="prov">${esc(p.method || "")} · rank 1 = best (lowest for valuation multiples and debt)</p>`;
  }

  function tabRisk(r) {
    const rp = r.risk_profile, risk = r.risk, cur = r.currency;
    const lvlCls = (l) => ({ Low: "good", Moderate: "warn", Elevated: "warn", High: "bad" }[l] || "");
    return `
      ${rp ? `<section class="card section"><div class="card-head"><h2>Risk profile</h2><span class="badge ${lvlCls(rp.level)}">${esc(rp.level)} · ${fmt.n(rp.overall, 1)}/10</span></div>
        <p class="sub">0 = low risk, 10 = high risk. ${esc(rp.method)}</p>
        <div class="grid grid-2">${rp.dimensions.map((d) => `<div class="note-card" style="cursor:default"><div class="card-head" style="margin-bottom:4px"><strong>${esc(d.dimension)}</strong>
          ${d.score == null ? '<span class="badge">Not assessed</span>' : `<span class="badge ${lvlCls(d.level)}">${esc(d.level)} · ${fmt.n(d.score, 1)}</span>`}</div>
          ${d.score != null ? `<div class="score-bar" style="grid-template-columns:1fr"><div class="track"><div class="fill" style="width:${d.score * 10}%;background:var(${{ Low: "--up-text", Moderate: "--warning", Elevated: "--serious" }[d.level] || "--down-text"})"></div></div></div>` : ""}
          <ul class="method-list" style="margin:6px 0 0">${(d.evidence || []).map((e) => `<li>${esc(e)}</li>`).join("")}${d.note ? `<li class="muted">${esc(d.note)}</li>` : ""}</ul></div>`).join("")}</div></section>` : ""}
      <section class="section grid grid-2">
        <div class="card"><h2>${T("Falls from peak (drawdown)", "drawdown")}</h2>
          <p class="sub">${risk.current_drawdown_pct ? `Now ${fmt.pct(Math.abs(risk.current_drawdown_pct), 1, false)} below its all-time high` : "At its all-time high"}</p>
          <div class="chart-box short"><canvas id="dd-chart" aria-label="Drawdown chart"></canvas></div></div>
        <div class="card"><h2>Risk metrics</h2>${sections.srcLine(r, "risk")}
          <div class="table-wrap"><table class="compact"><thead><tr><th>Window</th><th>${T("CAGR")}</th><th>${T("Volatility")}</th><th>${T("Max fall")}</th><th>${T("Sharpe")}</th><th>${T("Sortino")}</th><th>${T("VaR 95%", "var")}</th></tr></thead>
            <tbody>${Object.entries(risk.windows).map(([k, w]) => `<tr><td>${k}</td><td>${fmt.pct(w.annual_return_pct)}</td><td>${fmt.pct(w.volatility_pct, 1, false)}</td><td>${fmt.pct(w.max_drawdown_pct)}</td><td>${fmt.n(w.sharpe, 2)}</td><td>${fmt.n(w.sortino, 2)}</td><td>${fmt.pct(w.var_95_daily_pct, 1)}</td></tr>`).join("")}</tbody></table></div>
          <p class="sub">${T("Beta")}: ${Object.entries(risk.beta || {}).map(([k, b]) => `${k} ${fmt.n(b.beta, 2)}`).join(" · ") || "—"} vs ${charts.indexName(r.benchmark)}</p></div>
      </section>
      <section class="card section"><h2>Biggest crashes and recoveries</h2>
        <div class="table-wrap"><table class="compact"><thead><tr><th class="l">Peak</th><th class="l">Bottom</th><th>Fall</th><th>Time to bottom</th><th>Recovered</th><th>Under water</th></tr></thead>
          <tbody>${risk.drawdown_episodes.map((e) => `<tr><td class="l">${fmt.date(e.peak_date)} <span class="muted">${fmt.money(e.peak_price, cur, 0)}</span></td><td class="l">${fmt.date(e.trough_date)} <span class="muted">${fmt.money(e.trough_price, cur, 0)}</span></td>
            <td class="down">${fmt.pct(e.depth_pct)}</td><td>${fmt.duration(e.days_to_bottom)}</td><td>${e.recovered ? fmt.date(e.recovery_date) : '<span class="badge">Not yet</span>'}</td><td>${fmt.duration(e.days_underwater)}</td></tr>`).join("") || '<tr><td colspan="6" class="muted">No falls of 10% or more</td></tr>'}</tbody></table></div></section>`;
  }

  function tabPerformance(r) {
    const perf = r.performance, cur = r.currency, t = r.technicals, bench = charts.indexName(r.benchmark);
    const moves = (title, rows) => `<div><h3>${title}</h3><div class="table-wrap"><table class="compact"><tbody>${rows.map((m) => `<tr><td class="l">${fmt.date(m.date)}</td><td>${fmt.pctSpan(m.change_pct, 2)}</td></tr>`).join("")}</tbody></table></div></div>`;
    return `
      <section class="section grid grid-2">
        <div class="card"><h2>Returns</h2>${sections.srcLine(r, "performance")}
          <div class="table-wrap"><table class="compact"><thead><tr><th>Period</th><th>${T("Return", "total_return")}</th><th>${T("CAGR")}</th><th>${esc(bench)}</th></tr></thead>
            <tbody>${perf.trailing.map((x) => `<tr><td>${x.period}</td><td>${fmt.pctSpan(x.total_return_pct)}</td><td>${x.cagr_pct == null ? "—" : fmt.pct(x.cagr_pct)}</td><td>${fmt.pct(x.benchmark_return_pct)}</td></tr>`).join("")}</tbody></table></div></div>
        <div class="card"><h2>What your money would be worth</h2>
          <div class="table-wrap"><table class="compact"><thead><tr><th>${fmt.money(10000, cur, 0)} invested</th><th>Worth today</th><th>Gain</th></tr></thead>
            <tbody>${perf.growth_of_10k.map((g) => `<tr><td>${g.years}Y ago</td><td>${fmt.money(g.value, cur, 0)}</td><td>${fmt.pctSpan((g.value / g.invested - 1) * 100, 0)}</td></tr>`).join("")}</tbody></table></div>
          <h3>${T("Monthly SIP", "sip")} of ${fmt.money(5000, cur, 0)}</h3>
          <div class="table-wrap"><table class="compact"><thead><tr><th>Duration</th><th>Invested</th><th>Worth</th><th>${T("XIRR")}</th></tr></thead>
            <tbody>${perf.sip_backtests.map((s) => `<tr><td>${s.years}Y</td><td>${fmt.money(s.invested, cur, 0)}</td><td>${fmt.money(s.value, cur, 0)}</td><td>${fmt.pctSpan(s.xirr_pct)}</td></tr>`).join("")}</tbody></table></div></div>
      </section>
      <section class="card section"><h2>Year-by-year vs ${esc(bench)}</h2><div class="chart-box"><canvas id="year-chart" aria-label="Calendar year returns"></canvas></div>
        <div class="grid grid-2" style="margin-top:8px">${moves("Biggest one-day rises (1Y)", perf.biggest_moves_1y.top_gains)}${moves("Biggest one-day falls (1Y)", perf.biggest_moves_1y.top_falls)}</div></section>
      ${sections.breakdown(r)}
      <section class="section grid grid-2">
        <div class="card"><h2>Technical signals</h2>${sections.srcLine(r, "technicals")}
          <p class="sub">${T("Trend")}: <strong>${esc(t.trend)}</strong> · ${t.bullish_signals} bullish / ${t.bearish_signals} bearish</p>
          <div class="table-wrap"><table class="compact"><thead><tr><th class="l">Indicator</th><th>Value</th><th>Signal</th><th class="l">Meaning</th></tr></thead>
            <tbody>${t.signals.map((s) => `<tr><td class="l">${T(s.indicator)}</td><td>${typeof s.value === "number" ? fmt.n(s.value, 2) : esc(s.value)}</td><td class="stance-${s.stance}">${stanceLabel(s.stance)}</td><td class="wrap l">${esc(s.note)}</td></tr>`).join("")}</tbody></table></div></div>
        <div class="card"><h2>${T("Support", "support")} & ${T("resistance", "resistance")}</h2>
          <div class="table-wrap"><table class="compact"><tbody>
            ${row("Resistance (6M high)", fmt.money(t.levels.resistance_6m, cur))}${row("Resistance (3M high)", fmt.money(t.levels.resistance_3m, cur))}
            ${row("Pivot R1", fmt.money(t.levels.r1, cur))}${row("Pivot", fmt.money(t.levels.pivot, cur))}${row("Pivot S1", fmt.money(t.levels.s1, cur))}
            ${row("Support (3M low)", fmt.money(t.levels.support_3m, cur))}${row("Support (6M low)", fmt.money(t.levels.support_6m, cur))}
            ${row("Volume (20d vs 90d avg)", fmt.pct(t.volume_trend_pct))}</tbody></table></div></div>
      </section>`;
  }

  const AI_PROMPTS = ["Why did this stock move recently?", "Analyze the latest earnings.", "Is this stock overvalued?", "What are the biggest risks?",
    "How does it compare with its peers?", "What would have to go right for the bull case?"];
  function tabAI(r) {
    return `<section class="card section"><div class="card-head"><h2>AI investment summary</h2><span id="ai-status" class="muted" style="font-size:12px"></span></div>
        <div id="ai-summary">${ui.loading("Checking AI availability…")}</div></section>
      <section class="card section"><h2>Ask about ${esc(r.symbol)}</h2>
        <div class="chips" id="ai-chips">${AI_PROMPTS.map((p) => `<button class="chip" data-q="${esc(p)}">${esc(p)}</button>`).join("")}</div>
        <form id="ai-form" class="row" style="margin-top:10px"><input id="ai-q" type="text" placeholder="Ask a research question…" style="flex:1;min-width:200px" maxlength="2000">
          <label class="toggle"><input type="checkbox" id="ai-web" checked> Web search</label><button class="btn primary" type="submit">Ask</button></form>
        <div id="ai-thread" class="chat" style="margin-top:12px"></div>
        <p class="prov">Answers cite this report's data (each metric with its source) and, with web search on, recent web pages. AI can be wrong - check the cited sources.</p></section>`;
  }
  function bindAI(el, r, ctx) {
    const $ = (s) => el.querySelector(s);
    const save = (question, res) => {
      const id = store.workspace.attach(r.symbol, r.name, "ai", { question, answer: res });
      ui.toast("Saved to notebook", `${r.symbol} research notebook`);
      return id;
    };
    const fallback = (reason) => `<p class="callout">${esc(reason)}</p>
      <h3>Rule-based summary (no AI)</h3><p class="summary">${esc(r.summary)}</p>
      <p class="sub">Strengths: ${r.scorecard.strengths.map(esc).join("; ") || "—"}<br>Risks: ${r.scorecard.risks.map(esc).join("; ") || "—"}</p>`;
    data.aiStatus().then((st) => {
      if (!ctx.alive()) return;
      $("#ai-status").textContent = st.available ? `Model: ${st.model}` : "AI unavailable";
      if (!st.available) {
        $("#ai-summary").innerHTML = fallback(st.reason);
        $("#ai-form").querySelectorAll("input,button").forEach((x) => { x.disabled = true; });
        $("#ai-chips").querySelectorAll("button").forEach((x) => { x.disabled = true; });
        return;
      }
      $("#ai-summary").innerHTML = `<p class="muted" style="font-size:12.5px">Structured summary (business, financials, valuation, earnings, risks, bull/bear case) built only from this page's data and cited news.</p>
        <button class="btn primary" id="ai-gen">${ui.icon("ai")} Generate AI summary</button>`;
      $("#ai-gen").addEventListener("click", async () => {
        $("#ai-summary").innerHTML = ui.loading("Writing a cited summary - this can take up to a minute…");
        try {
          const res = await data.aiSummary(r.symbol);
          if (!ctx.alive()) return;
          $("#ai-summary").innerHTML = ui.aiAnswer(res, "sum") + `<button class="btn sm" id="ai-save-sum">${ui.icon("workspace")} Save to notebook</button>`;
          $("#ai-save-sum").addEventListener("click", () => save("AI investment summary", res));
        } catch (err) { if (ctx.alive()) $("#ai-summary").innerHTML = ui.errorBox(err); }
      });
    });
    let n = 0;
    const ask = async (question) => {
      if (!question.trim()) return;
      const i = ++n;
      const box = document.createElement("div");
      box.innerHTML = `<div class="q">${esc(question)}</div><div class="a">${ui.loading("Researching…")}</div>`;
      $("#ai-thread").prepend(box);
      try {
        const res = await data.aiAsk(question, [r.symbol], $("#ai-web").checked);
        if (!ctx.alive()) return;
        box.querySelector(".a").innerHTML = ui.aiAnswer(res, `q${i}`) + `<button class="btn sm" data-save>${ui.icon("workspace")} Save to notebook</button>`;
        box.querySelector("[data-save]").addEventListener("click", () => save(question, res));
      } catch (err) { if (ctx.alive()) box.querySelector(".a").innerHTML = ui.errorBox(err); }
    };
    $("#ai-form").addEventListener("submit", (e) => { e.preventDefault(); ask($("#ai-q").value); $("#ai-q").value = ""; });
    $("#ai-chips").addEventListener("click", (e) => { const b = e.target.closest("[data-q]"); if (b) ask(b.dataset.q); });
  }

  function tabSources(r) {
    const STATUS = { actual: "Reported", estimate: "Estimate", derived: "Calculated" };
    const ms = Object.entries(r.metrics || {});
    return `${sections.quality(r)}
      <section class="card section"><div class="card-head"><h2>Metric provenance</h2><button class="btn sm" id="m-csv">${ui.icon("download")} CSV</button></div>
        <div class="table-wrap"><table class="compact"><thead><tr><th class="l">Metric</th><th>Value</th><th class="l">Period</th><th>Currency</th><th>Type</th><th class="l">Source · as of</th></tr></thead><tbody>
        ${ms.map(([, m]) => `<tr><td class="l">${esc(m.label)}</td><td>${ui.fmtUnit(m.value, m.unit, m.currency)} ${ui.sig(m.signal)}</td><td class="l">${esc(m.period || "—")}</td><td>${esc(m.currency || "—")}</td>
          <td><span class="badge">${STATUS[m.status] || esc(m.status)}</span></td><td class="l">${(() => { const src = (r.sources || []).find((x) => x.id === m.source); const b = src && brands.forProvider(src.provider); return b ? brands.logo(b, { size: 12 }) + " " : ""; })()}${esc(ui.provText(m, r))}</td></tr>`).join("")}</tbody></table></div></section>
      ${sections.sources(r)}
      ${(r.extended?.sources || []).length ? `<section class="card section"><h2>Extended data sources</h2><div class="table-wrap"><table class="compact"><thead><tr><th class="l">Dataset</th><th class="l">Provider</th><th>Fetched</th><th class="l">Method</th></tr></thead><tbody>
        ${r.extended.sources.map((s) => `<tr><td class="l">${esc(s.dataset)}</td><td class="l">${esc(s.provider_label)}</td><td>${esc((s.fetched_at || "").replace("T", " ").slice(0, 16))}</td><td class="l wrap">${esc(s.methodology || "")}</td></tr>`).join("")}</tbody></table></div></section>` : ""}`;
  }

  /* ================= page ================= */
  function landing(el) {
    const recent = store.recent.all(), wl = store.watchlists.symbols();
    const popular = ["RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS", "ITC.NS", "AAPL", "MSFT", "NVDA", "GOOGL"];
    const chips = (list) => `<div class="chips">${list.map((s) => `<a class="chip" href="#/research/${encodeURIComponent(s)}"><span class="ticker">${esc(s)}</span></a>`).join("")}</div>`;
    el.innerHTML = `<div class="page-head"><div><div class="crumbs">Research</div><h1>Company research</h1><p class="sub muted">Search any listed company - India (NSE/BSE) or US.</p></div></div>
      <div class="card section"><form id="r-form" class="row"><input id="r-q" type="text" placeholder="Company or ticker - e.g. Reliance, TCS, AAPL" style="flex:1;min-width:220px;font-size:15px;padding:10px 12px" autocomplete="off" autofocus>
        <button class="btn primary" type="submit">${ui.icon("search")} Research</button></form><div id="r-sugg" style="margin-top:8px"></div></div>
      ${recent.length ? `<div class="card section"><h2>Recently researched</h2>${chips(recent.map((x) => x.symbol))}</div>` : ""}
      ${wl.length ? `<div class="card section"><h2>Your watchlist</h2>${chips(wl)}</div>` : ""}
      <div class="card section"><h2>Popular</h2>${chips(popular)}</div>`;
    const q = el.querySelector("#r-q");
    let timer;
    q.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const v = q.value.trim();
        if (!v) { el.querySelector("#r-sugg").innerHTML = ""; return; }
        const res = await data.search(v).catch(() => []);
        el.querySelector("#r-sugg").innerHTML = res.slice(0, 8).map((s) => `<div class="list-row" data-open="${esc(s.symbol)}"><span class="nm">${(() => { const b = brands.forExchange(s.exchange, s.symbol); return b ? brands.logo(b, { size: 14 }) + " " : ""; })()}<span class="ticker">${esc(s.symbol)}</span> <span class="muted">${esc(s.name)}</span></span><span class="muted">${esc(s.exchange || "")}</span><span></span></div>`).join("");
      }, 200);
    });
    el.querySelector("#r-form").addEventListener("submit", (e) => { e.preventDefault(); if (q.value.trim()) ui.go(`#/research/${encodeURIComponent(q.value.trim())}`); });
  }

  const BODY = { overview: tabOverview, financials: tabFinancials, valuation: tabValuation, earnings: tabEarnings, ownership: tabOwnership,
    news: tabNews, filings: tabFilings, peers: () => `<section class="card section"><h2>Peers</h2><div id="peer-body">${ui.skeleton(5, false)}</div></section>`,
    risk: tabRisk, performance: tabPerformance, ai: tabAI, sources: tabSources };

  function paint(el, r, tab, ctx) {
    charts.destroyAll();
    ctx.setTitle(`${r.symbol} · ${r.name}`);
    el.innerHTML = `<div>${header(r)}${tab === "overview" ? sections.quality(r) : ""}
      <div class="tabs" role="tablist" style="margin-top:12px">${TABS.map(([id, l]) => `<button type="button" class="tab${id === tab ? " on" : ""}" role="tab" aria-selected="${id === tab}" data-tab="${id}">${l}</button>`).join("")}</div>
      <div id="s-body"></div><p class="disclaimer">${esc(r.disclaimer)}</p></div>`;
    const root = el.firstElementChild; // listeners go on this page-owned node, not the persistent #app
    const wl = el.querySelector("#s-wl");
    const paintWl = () => { wl.innerHTML = `${ui.icon("star")} ${store.watchlists.has(r.symbol) ? "Watching" : "Watch"}`; wl.classList.toggle("primary", store.watchlists.has(r.symbol)); };
    wl.addEventListener("click", () => { const on = store.watchlists.toggle(r.symbol, r.name); paintWl(); ui.toast(on ? "Added to watchlist" : "Removed from watchlist", r.symbol); });
    paintWl();
    el.querySelector("#s-nb").addEventListener("click", () => {
      const nb = store.workspace.forSymbol(r.symbol)[0] || store.workspace.create(r.symbol, r.name);
      ui.go(`#/workspace/${nb.id}`);
    });
    el.querySelector(".tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) showTab(b.dataset.tab); });
    const showTab = (t) => {
      tab = t;
      history.replaceState(null, "", `#/research/${encodeURIComponent(r.symbol)}${t === "overview" ? "" : "/" + t}`);
      el.querySelectorAll(".tabs [data-tab]").forEach((b) => { b.classList.toggle("on", b.dataset.tab === t); b.setAttribute("aria-selected", b.dataset.tab === t); });
      charts.destroyAll();
      const body = el.querySelector("#s-body");
      body.innerHTML = BODY[t](r);
      bindTab(body, r, t, ctx);
    };
    root.addEventListener("click", (e) => {
      const g = e.target.closest("[data-goto], [data-jump]");
      if (!g) return;
      e.preventDefault();
      showTab(g.dataset.goto || "sources");
      el.querySelector(".tabs").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    showTab(tab);
  }

  function bindTab(body, r, t, ctx) {
    const f = r.fundamentals;
    if (t === "overview") bindChart(body, r);
    if (t === "financials") {
      if (f.statements.length) charts.financials(body.querySelector("#fin-chart"), f.statements, r.currency);
      body.querySelector("#q-csv")?.addEventListener("click", () => ui.downloadCSV(`${r.symbol}-quarterly.csv`, r.extended.quarterly));
    }
    if (t === "valuation") bindValuation(body, r);
    if (t === "earnings") bindEarnings(body, r);
    if (t === "news") bindNews(body, r);
    if (t === "risk") charts.drawdown(body.querySelector("#dd-chart"), r.risk.drawdown_chart);
    if (t === "performance") charts.yearBars(body.querySelector("#year-chart"), r.performance.calendar_years, charts.indexName(r.benchmark));
    if (t === "ai") bindAI(body, r, ctx);
    if (t === "sources") body.querySelector("#m-csv")?.addEventListener("click", () => ui.downloadCSV(`${r.symbol}-metrics.csv`,
      Object.entries(r.metrics).map(([k, m]) => ({ key: k, ...m, provenance: ui.provText(m, r) }))));
    if (t === "peers") {
      ui.fill(body.querySelector("#peer-body"), () => data.peers(r), (p) => peerBody(p, r), ctx, { lines: 6 });
    }
    sections.bind(r);
  }

  window.views.research = {
    title: "Research",
    async render(el, arg, ctx) {
      if (!arg) { landing(el); return; }
      const parts = arg.split("/");
      const last = parts.at(-1);
      const tab = parts.length > 1 && BODY[last] ? last : "overview";
      const query = tab === last && parts.length > 1 ? parts.slice(0, -1).join("/") : arg;
      el.innerHTML = `${ui.skeleton(2, false)}${ui.skeleton(4, true)}<p class="muted" style="text-align:center">Researching ${esc(query)}… a full live report can take 10-30 seconds.</p>`;
      let current = tab;
      const onLive = (live) => {
        if (!ctx.alive()) return;
        const y = window.scrollY;
        const active = el.querySelector(".tab.on")?.dataset.tab || current;
        paint(el, live, active, ctx);
        window.scrollTo(0, y);
        ui.toast("Live data loaded", `${live.symbol} updated from the live server`);
      };
      let r;
      try { r = await data.report(query, { onLive }); } catch (err) {
        if (!ctx.alive()) return;
        el.innerHTML = ui.errorBox(err, true);
        el.querySelector("[data-retry]").addEventListener("click", () => ctx.route());
        return;
      }
      if (!ctx.alive()) return;
      store.recent.add(r.symbol, r.name);
      paint(el, r, current, ctx);
    },
  };
})();
