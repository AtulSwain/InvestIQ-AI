/* InvestIQ single-page app: hash routing, search, report + compare views. */
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const app = $("#app");
  const { esc } = fmt;

  /* ---------------- storage (per-browser conveniences) ---------------- */
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
    },
  };
  const watchlist = {
    all: () => store.get("investiq.watchlist", []),
    has: (sym) => watchlist.all().some((w) => w.symbol === sym),
    toggle(sym, name) {
      const list = watchlist.all();
      const i = list.findIndex((w) => w.symbol === sym);
      if (i >= 0) list.splice(i, 1); else list.push({ symbol: sym, name });
      store.set("investiq.watchlist", list);
    },
  };

  /* ---------------- theme ---------------- */
  const savedTheme = store.get("investiq.theme", null);
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;
  $("#theme-toggle").addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set("investiq.theme", next);
    route(); // re-render charts with the new palette
  });

  /* ---------------- api ---------------- */
  const cache = new Map();
  async function api(path) {
    if (cache.has(path)) return cache.get(path);
    const res = await fetch(path);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.detail || `Request failed (${res.status})`);
    cache.set(path, body);
    return body;
  }

  fetch("/api/health").then((r) => r.json()).then((h) => { $("#demo-banner").hidden = !h.demo; }).catch(() => {});

  /* ---------------- search ---------------- */
  const input = $("#search-input");
  const list = $("#search-results");
  let results = [];
  let active = -1;
  let timer;

  function renderResults() {
    list.hidden = !results.length;
    list.innerHTML = results.map((r, i) => `
      <li role="option" data-i="${i}" aria-selected="${i === active}">
        <span><span class="sym">${esc(r.symbol)}</span> <span class="muted">${esc(r.name)}</span></span>
        <span class="exch">${esc(r.exchange)}</span>
      </li>`).join("");
  }
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { results = []; renderResults(); return; }
    timer = setTimeout(async () => {
      try { results = (await api(`/api/search?q=${encodeURIComponent(q)}`)).results; } catch { results = []; }
      active = -1;
      renderResults();
    }, 200);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { active = Math.min(active + 1, results.length - 1); renderResults(); e.preventDefault(); }
    if (e.key === "ArrowUp") { active = Math.max(active - 1, 0); renderResults(); e.preventDefault(); }
    if (e.key === "Escape") { results = []; renderResults(); }
  });
  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li");
    if (li) openStock(results[+li.dataset.i].symbol);
  });
  $("#search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const pick = results[active] || null;
    const q = pick ? pick.symbol : input.value.trim();
    if (q) openStock(q);
  });
  input.addEventListener("blur", () => setTimeout(() => { list.hidden = true; }, 150));

  function openStock(q) {
    results = []; renderResults(); input.value = ""; input.blur();
    location.hash = `#/stock/${encodeURIComponent(q)}`;
  }

  /* ---------------- router ---------------- */
  function route() {
    const hash = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
    const [view, arg] = [hash.split("/")[0], hash.split("/").slice(1).join("/")];
    document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === (view || "home")));
    charts.destroyAll();
    if (view === "stock" && arg) return renderStock(arg);
    if (view === "compare") return renderCompare(arg);
    renderHome();
  }
  window.addEventListener("hashchange", () => { window.scrollTo(0, 0); route(); });

  /* ---------------- home ---------------- */
  const POPULAR = ["RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "BHARTIARTL", "ITC", "SBIN", "LT", "TATAMOTORS", "AAPL", "MSFT", "NVDA"];

  function renderHome() {
    const wl = watchlist.all();
    app.innerHTML = `
      <section class="hero">
        <h1>Research any stock in one place</h1>
        <p>Search a company to get 1-year and 10-year performance, the biggest rises and falls,
           market value, rough fair-value estimates, risk and bull/base/bear scenarios for the future.</p>
        <div class="chips">${POPULAR.map((s) => `<button class="chip" data-open="${s}">${s}</button>`).join("")}</div>
      </section>
      ${wl.length ? `
      <section class="card section">
        <h2>Your watchlist</h2>
        <div class="chips" style="justify-content:flex-start">
          ${wl.map((w) => `<button class="chip" data-open="${esc(w.symbol)}">${esc(w.symbol)} <span class="muted">${esc(w.name || "")}</span></button>`).join("")}
        </div>
        ${wl.length >= 2 ? `<p class="sub" style="margin-top:12px"><a href="#/compare/${wl.slice(0, 5).map((w) => encodeURIComponent(w.symbol)).join(",")}">Compare your watchlist →</a></p>` : ""}
      </section>` : ""}
      <section class="grid grid-3 features">
        ${[
          ["Performance", "Returns over 1 week to 20 years, CAGR, year-by-year results vs the index, and what ₹10,000 or a monthly SIP would have become."],
          ["Rises & falls", "Every major crash with peak, bottom and recovery date, biggest single-day moves, volatility and drawdown chart."],
          ["Market value", "Market cap, P/E, P/B, EPS, ROE, debt, margins, dividend yield and multi-year revenue & profit trends."],
          ["Fair value", "Graham number, Graham growth formula, DCF, earnings multiple and analyst targets blended into a fair-value range."],
          ["Future scenarios", "Bear / base / bull price ranges for 1-10 years, probability of loss, and an investment calculator."],
          ["Scorecard", "0-10 scores for performance, valuation, quality, momentum and safety, with strengths and risks in plain English."],
        ].map(([t, d]) => `<div class="card"><h2>${t}</h2><p>${d}</p></div>`).join("")}
      </section>`;
    bindOpen();
  }

  function bindOpen(root = app) {
    root.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openStock(b.dataset.open)));
  }

  function loading(msg) {
    app.innerHTML = `<div class="loading"><div class="spinner"></div>${esc(msg)}</div>`;
  }
  function showError(err) {
    app.innerHTML = `<div class="error card"><h2>Couldn't load that</h2><p>${esc(err.message || err)}</p>
      <p class="muted">Tip: Indian stocks use the NSE code (e.g. RELIANCE, TCS) or add .NS / .BO. US stocks use the plain ticker (AAPL).</p>
      <p><a href="#/">Back to home</a></p></div>`;
  }

  /* ---------------- stock report ---------------- */
  const RANGES = [["1M", 1], ["6M", 6], ["YTD", "ytd"], ["1Y", 12], ["3Y", 36], ["5Y", 60], ["10Y", 120], ["MAX", null]];

  function rangeStart(lastDate, months) {
    const d = new Date(lastDate + "T00:00:00");
    if (months === null) return "0000-00-00";
    if (months === "ytd") return `${d.getFullYear()}-01-01`;
    d.setMonth(d.getMonth() - months);
    return d.toISOString().slice(0, 10);
  }

  async function renderStock(query) {
    loading(`Researching ${query}…`);
    let r;
    try { r = await api(`/api/report/${encodeURIComponent(query)}`); } catch (err) { return showError(err); }
    if (!location.hash.includes(encodeURIComponent(query)) && !location.hash.includes(query)) return; // navigated away
    document.title = `${r.symbol} · InvestIQ`;

    const cur = r.currency;
    const f = r.fundamentals;
    const q = r.quote;
    const perf = r.performance;
    const risk = r.risk;
    const val = r.valuation;
    const proj = r.projection;
    const sc = r.scorecard;
    const trailing = Object.fromEntries(perf.trailing.map((t) => [t.period, t]));
    const benchName = charts.indexName(r.benchmark);
    const beta = (risk.beta && (risk.beta["3Y"] || risk.beta["1Y"])) || {};

    app.innerHTML = `
      <section class="card">
        <div class="stock-head">
          <div>
            <h1>${esc(r.name)}</h1>
            <div class="meta">${esc(r.symbol)} · ${esc(f.exchange || r.market)} ${f.sector ? "· " + esc(f.sector) : ""} ${f.industry ? "· " + esc(f.industry) : ""}</div>
          </div>
          <div>
            <div class="price">${fmt.money(q.price, cur)}</div>
            <div class="delta ${fmt.signedClass(q.change)}">${q.change >= 0 ? "▲" : "▼"} ${fmt.money(Math.abs(q.change), cur)} (${fmt.pct(q.change_pct, 2)}) <span class="muted" style="font-weight:400">· as of ${fmt.date(r.as_of)}</span></div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn" id="wl-btn"></button>
            <a class="btn" href="#/compare/${encodeURIComponent(r.symbol)}">Compare</a>
          </div>
        </div>
      </section>

      <nav class="section-nav" aria-label="Report sections">
        ${[["overview", "Overview"], ["chart", "Chart"], ["performance", "Performance"], ["falls", "Rises & falls"], ["fundamentals", "Fundamentals"], ["valuation", "Fair value"], ["future", "Future"], ["technicals", "Technicals"]]
          .map(([id, t]) => `<a href="#" data-jump="${id}">${t}</a>`).join("")}
      </nav>

      <section id="overview" class="grid grid-2 section" style="margin-top:4px">
        <div class="card">
          <h2>InvestIQ verdict</h2>
          <p class="sub">Automated summary of everything below</p>
          <p class="summary">${esc(r.summary)}</p>
          <div class="grid grid-2" style="margin-top:14px;gap:12px">
            <div><h3 style="margin-top:0">Strengths</h3><ul class="pill-list">${(sc.strengths.length ? sc.strengths : ["None stood out"]).map((s) => `<li><span class="icon good">+</span>${esc(s)}</li>`).join("")}</ul></div>
            <div><h3 style="margin-top:0">Risks</h3><ul class="pill-list">${(sc.risks.length ? sc.risks : ["None stood out"]).map((s) => `<li><span class="icon bad">!</span>${esc(s)}</li>`).join("")}</ul></div>
          </div>
        </div>
        <div class="card">
          <h2>Scorecard</h2>
          <div class="score-ring">
            <div class="score-num">${sc.overall ?? "—"}<span class="muted" style="font-size:18px">/10</span></div>
            <div><div class="score-rating">${esc(sc.rating)}</div><div class="muted" style="font-size:13px">Weighted: performance 25%, quality 25%, valuation 20%, safety 20%, momentum 10%</div></div>
          </div>
          <div class="score-bars">
            ${Object.entries(sc.scores).map(([k, v]) => `
              <div class="score-bar"><span style="text-transform:capitalize">${k}</span>
                <div class="track"><div class="fill" style="width:${(v ?? 0) * 10}%"></div></div>
                <span class="val">${v ?? "—"}</span></div>`).join("")}
          </div>
        </div>
      </section>

      <section class="card section">
        <h2>Key numbers</h2>
        <div class="stats" style="margin-top:10px">
          ${stat("Market cap", fmt.big(f.market_cap, cur), f.market_cap_category)}
          ${stat("P/E", fmt.n(f.pe, 1))}
          ${stat("P/B", fmt.n(f.pb, 2))}
          ${stat("EPS", fmt.money(f.eps, cur))}
          ${stat("Dividend yield", fmt.pct(f.dividend_yield_pct, 2, false))}
          ${stat("ROE", fmt.pct(f.roe_pct, 1, false))}
          ${stat("Debt / equity", fmt.n(f.debt_to_equity, 2))}
          ${stat("Profit margin", fmt.pct(f.profit_margin_pct, 1, false))}
          ${stat("52W high", fmt.money(risk.week52.high, cur), fmt.pct(risk.week52.pct_from_high) + " from high")}
          ${stat("52W low", fmt.money(risk.week52.low, cur), fmt.pct(risk.week52.pct_from_low) + " from low")}
          ${stat("1Y return", fmt.pct(trailing["1Y"]?.total_return_pct))}
          ${stat("10Y CAGR", fmt.pct(trailing["10Y"]?.cagr_pct))}
          ${stat("Beta (3Y)", fmt.n(beta.beta, 2), "vs " + benchName)}
          ${stat("Risk level", esc(risk.risk_level))}
          ${stat("All-time high", fmt.money(perf.all_time_high.price, cur), fmt.date(perf.all_time_high.date))}
          ${stat("Fair value (mid)", val.fair_value ? fmt.money(val.fair_value.mid, cur) : "—", esc(val.verdict))}
        </div>
      </section>

      <section id="chart" class="card section">
        <h2>Price history</h2>
        <p class="sub">Adjusted for splits and dividends · data since ${fmt.date(perf.history_start)} (${perf.history_years} years)</p>
        <div class="toolbar">
          <div class="seg" id="range-seg">${RANGES.map(([l]) => `<button type="button" data-range="${l}">${l}</button>`).join("")}</div>
          <label class="toggle"><input type="checkbox" id="t-sma50"> <span class="swatch" style="background:var(--series-3)"></span> SMA 50</label>
          <label class="toggle"><input type="checkbox" id="t-sma200"> <span class="swatch" style="background:var(--series-4)"></span> SMA 200</label>
          ${r.benchmark_chart ? `<label class="toggle"><input type="checkbox" id="t-index"> vs ${benchName} (rebased to 100)</label>` : ""}
        </div>
        <div class="chart-box tall"><canvas id="price-chart" aria-label="Price chart"></canvas></div>
        <div class="legend" id="price-legend"></div>
        <p class="sub" id="range-return" style="margin-top:8px"></p>
      </section>

      <section id="performance" class="section grid grid-2">
        <div class="card">
          <h2>Returns</h2>
          <p class="sub">Total return and annualised (CAGR) vs ${benchName}</p>
          <div class="table-wrap"><table>
            <thead><tr><th>Period</th><th>Return</th><th>CAGR</th><th>${benchName}</th></tr></thead>
            <tbody>${perf.trailing.map((t) => `<tr><td>${t.period}</td><td>${fmt.pctSpan(t.total_return_pct)}</td><td>${t.cagr_pct == null ? "—" : fmt.pct(t.cagr_pct)}</td><td>${fmt.pct(t.benchmark_return_pct)}</td></tr>`).join("")}</tbody>
          </table></div>
        </div>
        <div class="card">
          <h2>What your money would be worth</h2>
          <p class="sub">${fmt.money(10000, cur, 0)} invested once, N years ago</p>
          <div class="table-wrap"><table>
            <thead><tr><th>Invested</th><th>Worth today</th><th>Gain</th></tr></thead>
            <tbody>${perf.growth_of_10k.map((g) => `<tr><td>${g.years} year${g.years > 1 ? "s" : ""} ago</td><td>${fmt.money(g.value, cur, 0)}</td><td>${fmt.pctSpan((g.value / g.invested - 1) * 100, 0)}</td></tr>`).join("")}</tbody>
          </table></div>
          <h3>Monthly SIP of ${fmt.money(5000, cur, 0)}</h3>
          <div class="table-wrap"><table>
            <thead><tr><th>Duration</th><th>Invested</th><th>Worth today</th><th>XIRR</th></tr></thead>
            <tbody>${perf.sip_backtests.map((s) => `<tr><td>${s.years} year${s.years > 1 ? "s" : ""}</td><td>${fmt.money(s.invested, cur, 0)}</td><td>${fmt.money(s.value, cur, 0)}</td><td>${fmt.pctSpan(s.xirr_pct)}</td></tr>`).join("")}</tbody>
          </table></div>
        </div>
      </section>

      <section class="card section">
        <h2>Year-by-year returns</h2>
        <p class="sub">Calendar-year return vs ${benchName} · * partial year</p>
        <div class="legend"><span><span class="swatch" style="background:var(--series-1);height:10px"></span> ${esc(r.symbol)}</span><span><span class="swatch" style="background:var(--axis);height:10px"></span> ${benchName}</span></div>
        <div class="chart-box"><canvas id="year-chart" aria-label="Calendar year returns"></canvas></div>
      </section>

      <section id="falls" class="section grid grid-2">
        <div class="card">
          <h2>Falls from peak (drawdown)</h2>
          <p class="sub">How far below its previous high the stock was on each day. Now: ${fmt.pct(risk.current_drawdown_pct)}</p>
          <div class="chart-box short"><canvas id="dd-chart" aria-label="Drawdown chart"></canvas></div>
        </div>
        <div class="card">
          <h2>Risk metrics</h2>
          <p class="sub">Risk-free rate assumed ${fmt.pct(risk.risk_free_rate_pct, 1, false)}</p>
          <div class="table-wrap"><table>
            <thead><tr><th>Window</th><th>Annual return</th><th>Volatility</th><th>Max fall</th><th>Sharpe</th></tr></thead>
            <tbody>${Object.entries(risk.windows).map(([k, w]) => `<tr><td>${k}</td><td>${fmt.pct(w.annual_return_pct)}</td><td>${fmt.pct(w.volatility_pct, 1, false)}</td><td>${fmt.pct(w.max_drawdown_pct)}</td><td>${fmt.n(w.sharpe, 2)}</td></tr>`).join("")}</tbody>
          </table></div>
          <p class="sub" style="margin-top:10px">Beta: ${Object.entries(risk.beta || {}).map(([k, b]) => `${k} ${fmt.n(b.beta, 2)}`).join(" · ") || "—"} (1.0 = moves with ${benchName})</p>
        </div>
      </section>

      <section class="card section">
        <h2>Biggest crashes and recoveries</h2>
        <p class="sub">Largest peak-to-bottom falls of 10% or more</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Peak</th><th class="l">Bottom</th><th>Fall</th><th>Time to bottom</th><th>Recovered</th><th>Time under water</th></tr></thead>
          <tbody>${risk.drawdown_episodes.map((e) => `<tr>
            <td>${fmt.date(e.peak_date)} <span class="muted">${fmt.money(e.peak_price, cur, 0)}</span></td>
            <td class="l">${fmt.date(e.trough_date)} <span class="muted">${fmt.money(e.trough_price, cur, 0)}</span></td>
            <td class="down">${fmt.pct(e.depth_pct)}</td>
            <td>${fmt.duration(e.days_to_bottom)}</td>
            <td>${e.recovered ? fmt.date(e.recovery_date) : '<span class="badge">Not yet</span>'}</td>
            <td>${fmt.duration(e.days_underwater)}</td></tr>`).join("") || '<tr><td colspan="6" class="muted">No falls of 10% or more</td></tr>'}</tbody>
        </table></div>
        <div class="grid grid-2" style="margin-top:8px">
          ${movesTable("Biggest one-day rises (last year)", perf.biggest_moves_1y.top_gains)}
          ${movesTable("Biggest one-day falls (last year)", perf.biggest_moves_1y.top_falls)}
        </div>
      </section>

      <section id="fundamentals" class="section grid grid-2">
        <div class="card">
          <h2>Revenue & profit</h2>
          <p class="sub">Annual statements · revenue CAGR ${fmt.pct(f.revenue_cagr_pct)} · profit CAGR ${fmt.pct(f.profit_cagr_pct)}</p>
          ${f.statements.length ? `
            <div class="legend"><span><span class="swatch" style="background:var(--series-1);height:10px"></span> Revenue</span><span><span class="swatch" style="background:var(--series-2);height:10px"></span> Net income</span></div>
            <div class="chart-box short"><canvas id="fin-chart" aria-label="Revenue and profit"></canvas></div>` : '<p class="muted">Financial statements not available for this symbol.</p>'}
        </div>
        <div class="card">
          <h2>Financial health</h2>
          <div class="table-wrap"><table><tbody>
            ${row("Forward P/E", fmt.n(f.forward_pe, 1))}
            ${row("PEG ratio", fmt.n(f.peg, 2))}
            ${row("Book value / share", fmt.money(f.book_value_per_share, cur))}
            ${row("Operating margin", fmt.pct(f.operating_margin_pct, 1, false))}
            ${row("Return on assets", fmt.pct(f.roa_pct, 1, false))}
            ${row("Current ratio", fmt.n(f.current_ratio, 2))}
            ${row("Total debt", fmt.big(f.total_debt, cur))}
            ${row("Cash", fmt.big(f.total_cash, cur))}
            ${row("Free cash flow", fmt.big(f.free_cash_flow, cur))}
            ${row("Revenue growth (latest)", fmt.pct(f.revenue_growth_pct))}
            ${row("Earnings growth (latest)", fmt.pct(f.earnings_growth_pct))}
            ${row("Employees", f.employees ? fmt.n(f.employees, 0) : "—")}
          </tbody></table></div>
        </div>
      </section>
      ${f.description ? `<section class="card section"><h2>About the company</h2><p style="color:var(--text-secondary);margin:6px 0 0">${esc(f.description)}</p>${f.website ? `<p><a href="${esc(f.website)}" target="_blank" rel="noopener">${esc(f.website)}</a></p>` : ""}</section>` : ""}

      <section id="valuation" class="card section">
        <h2>Fair value estimate</h2>
        <p class="sub">Growth assumption ${fmt.pct(val.growth_assumption_pct, 1, false)}${val.discount_rate_pct ? ` · discount rate ${fmt.pct(val.discount_rate_pct, 0, false)}` : ""}</p>
        ${val.fair_value ? `
          <div><span class="verdict">${esc(val.verdict)}</span> <span class="muted">· margin of safety ${fmt.pct(val.margin_of_safety_pct)}</span></div>
          ${fairRange(val.fair_value, q.price, cur)}` : `<p class="muted">${esc(val.verdict)}</p>`}
        <div class="table-wrap"><table>
          <thead><tr><th>Method</th><th>Value</th><th>vs price</th><th style="text-align:left">How it works</th></tr></thead>
          <tbody>${val.methods.map((m) => `<tr><td>${esc(m.method)}</td><td>${fmt.money(m.value, cur)}</td><td>${fmt.pctSpan(m.upside_pct)}</td><td class="wrap">${esc(m.note)}</td></tr>`).join("")}</tbody>
        </table></div>
        ${f.analyst.analysts ? `<p class="sub" style="margin-top:10px">Analysts (${f.analyst.analysts}): target ${fmt.money(f.analyst.target_low, cur, 0)} – ${fmt.money(f.analyst.target_high, cur, 0)}, consensus “${esc(f.analyst.recommendation || "n/a")}”.</p>` : ""}
        <p class="disclaimer">${esc(val.note || "")}</p>
      </section>

      <section id="future" class="section grid grid-2">
        <div class="card">
          <h2>Future price scenarios</h2>
          <p class="sub">Expected return ${fmt.pct(proj.assumptions.expected_return_pct, 1, false)}/yr (own ${proj.assumptions.lookback_years}y history ${fmt.pct(proj.assumptions.historical_cagr_pct)} blended with market ${fmt.pct(proj.assumptions.long_run_market_return_pct, 0, false)}) · volatility ${fmt.pct(proj.assumptions.volatility_pct, 0, false)}</p>
          <div class="legend"><span><span class="swatch" style="background:var(--series-1)"></span> Base (median)</span><span><span class="swatch" style="background:var(--band);height:10px"></span> Bear–bull range (10th–90th percentile)</span></div>
          <div class="chart-box"><canvas id="fan-chart" aria-label="Future scenarios"></canvas></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Horizon</th><th>Bear</th><th>Base</th><th>Bull</th><th>Chance of loss</th></tr></thead>
            <tbody>${proj.horizons.map((h) => `<tr><td>${h.years} year${h.years > 1 ? "s" : ""}</td>
              <td>${fmt.money(h.bear.price, cur, 0)} <span class="muted">${fmt.pct(h.bear.cagr_pct)}/yr</span></td>
              <td>${fmt.money(h.base.price, cur, 0)} <span class="muted">${fmt.pct(h.base.cagr_pct)}/yr</span></td>
              <td>${fmt.money(h.bull.price, cur, 0)} <span class="muted">${fmt.pct(h.bull.cagr_pct)}/yr</span></td>
              <td>${fmt.pct(proj.probability_of_loss_pct[h.years + "Y"], 0, false)}</td></tr>`).join("")}</tbody>
          </table></div>
          <p class="disclaimer">${esc(proj.note)}</p>
        </div>
        <div class="card">
          <h2>Investment planner</h2>
          <p class="sub">Project a lump sum and/or monthly SIP using this stock's scenario returns</p>
          <div class="calc">
            <label>Lump sum (${fmt.sym(cur).trim() || cur})<input id="c-lump" type="number" min="0" step="1000" value="${cur === "INR" ? 100000 : 1000}"></label>
            <label>Monthly SIP (${fmt.sym(cur).trim() || cur})<input id="c-sip" type="number" min="0" step="500" value="${cur === "INR" ? 5000 : 100}"></label>
            <label>Years<input id="c-years" type="number" min="1" max="40" value="10"></label>
          </div>
          <div class="calc-out" id="calc-out"></div>
          <p class="sub" style="margin-top:12px">Uses the 10-year bear / base / bull annual rates: ${fmt.pct(proj.scenario_rates_pct.bear)}, ${fmt.pct(proj.scenario_rates_pct.base)}, ${fmt.pct(proj.scenario_rates_pct.bull)}.</p>
        </div>
      </section>

      <section id="technicals" class="section grid grid-2">
        <div class="card">
          <h2>Technical signals</h2>
          <p class="sub">Trend: <strong>${esc(r.technicals.trend)}</strong> · ${r.technicals.bullish_signals} bullish / ${r.technicals.bearish_signals} bearish</p>
          <div class="table-wrap"><table>
            <thead><tr><th>Indicator</th><th>Value</th><th>Signal</th><th style="text-align:left">Meaning</th></tr></thead>
            <tbody>${r.technicals.signals.map((s) => `<tr><td>${esc(s.indicator)}</td><td>${typeof s.value === "number" ? fmt.n(s.value, 2) : esc(s.value)}</td><td class="stance-${s.stance}">${stanceLabel(s.stance)}</td><td class="wrap">${esc(s.note)}</td></tr>`).join("")}</tbody>
          </table></div>
        </div>
        <div class="card">
          <h2>Support & resistance</h2>
          <p class="sub">Price levels where buying or selling has recently kicked in</p>
          <div class="table-wrap"><table><tbody>
            ${row("Resistance (6M high)", fmt.money(r.technicals.levels.resistance_6m, cur))}
            ${row("Resistance (3M high)", fmt.money(r.technicals.levels.resistance_3m, cur))}
            ${row("Pivot R1", fmt.money(r.technicals.levels.r1, cur))}
            ${row("Pivot", fmt.money(r.technicals.levels.pivot, cur))}
            ${row("Pivot S1", fmt.money(r.technicals.levels.s1, cur))}
            ${row("Support (3M low)", fmt.money(r.technicals.levels.support_3m, cur))}
            ${row("Support (6M low)", fmt.money(r.technicals.levels.support_6m, cur))}
            ${row("Volume (20d vs 90d avg)", fmt.pct(r.technicals.volume_trend_pct))}
          </tbody></table></div>
        </div>
      </section>

      <p class="disclaimer">${esc(r.disclaimer)}</p>`;

    // watchlist button
    const wlBtn = $("#wl-btn");
    const paintWl = () => { wlBtn.textContent = watchlist.has(r.symbol) ? "★ In watchlist" : "☆ Add to watchlist"; };
    wlBtn.addEventListener("click", () => { watchlist.toggle(r.symbol, r.name); paintWl(); });
    paintWl();

    // section jump links (hash is used by the router)
    app.querySelectorAll("[data-jump]").forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault();
      document.getElementById(a.dataset.jump).scrollIntoView({ behavior: "smooth" });
    }));

    // price chart + controls
    const prefs = store.get("investiq.chart", { range: "1Y", sma50: false, sma200: true, vsIndex: false });
    const ctl = { sma50: $("#t-sma50"), sma200: $("#t-sma200"), vsIndex: $("#t-index") };
    Object.entries(ctl).forEach(([k, el]) => { if (el) el.checked = !!prefs[k]; });
    const drawPrice = () => {
      const opts = { sma50: ctl.sma50.checked, sma200: ctl.sma200.checked, vsIndex: ctl.vsIndex ? ctl.vsIndex.checked : false };
      ctl.sma50.disabled = ctl.sma200.disabled = opts.vsIndex;
      store.set("investiq.chart", { range: prefs.range, ...opts });
      document.querySelectorAll("#range-seg button").forEach((b) => b.classList.toggle("on", b.dataset.range === prefs.range));
      const months = RANGES.find(([l]) => l === prefs.range)[1];
      const start = rangeStart(r.as_of, months);
      charts.price($("#price-chart"), r, start, opts);
      const legend = opts.vsIndex
        ? [["--series-1", r.symbol], ["--series-2", benchName]]
        : [["--series-1", "Close"], ...(opts.sma50 ? [["--series-3", "SMA 50"]] : []), ...(opts.sma200 ? [["--series-4", "SMA 200"]] : [])];
      $("#price-legend").innerHTML = legend.length > 1 ? legend.map(([c, l]) => `<span><span class="swatch" style="background:var(${c})"></span> ${esc(l)}</span>`).join("") : "";
      const i0 = Math.max(0, r.chart.dates.findIndex((d) => d >= start));
      const first = r.chart.close[i0];
      const hi = Math.max(...r.chart.close.slice(i0));
      const lo = Math.min(...r.chart.close.slice(i0));
      $("#range-return").innerHTML = `${prefs.range}: ${fmt.pctSpan((q.price / first - 1) * 100)} · high ${fmt.money(hi, cur)} · low ${fmt.money(lo, cur)}`;
    };
    $("#range-seg").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (b) { prefs.range = b.dataset.range; drawPrice(); }
    });
    Object.values(ctl).forEach((el) => el && el.addEventListener("change", drawPrice));
    drawPrice();

    charts.yearBars($("#year-chart"), perf.calendar_years, benchName);
    charts.drawdown($("#dd-chart"), risk.drawdown_chart);
    if (f.statements.length) charts.financials($("#fin-chart"), f.statements, cur);
    charts.fan($("#fan-chart"), proj, cur);

    // planner
    const calc = () => {
      const lump = +$("#c-lump").value || 0;
      const sip = +$("#c-sip").value || 0;
      const years = Math.min(40, Math.max(1, +$("#c-years").value || 1));
      const invested = lump + sip * 12 * years;
      const out = ["bear", "base", "bull"].map((k) => {
        const rate = (proj.scenario_rates_pct[k] || 0) / 100;
        const m = Math.pow(1 + rate, 1 / 12) - 1;
        const fvLump = lump * Math.pow(1 + rate, years);
        const n = years * 12;
        const fvSip = m === 0 ? sip * n : sip * ((Math.pow(1 + m, n) - 1) / m) * (1 + m);
        return [k, fvLump + fvSip];
      });
      $("#calc-out").innerHTML = out.map(([k, v]) => `
        <div class="box"><div class="label">${k}</div><div class="value">${fmt.big(v, cur)}</div>
        <div class="${fmt.signedClass(v - invested)}" style="font-size:13px">${fmt.pct((v / invested - 1) * 100, 0)} on ${fmt.big(invested, cur)}</div></div>`).join("");
    };
    ["#c-lump", "#c-sip", "#c-years"].forEach((s) => $(s).addEventListener("input", calc));
    calc();
  }

  function stat(label, value, sub) {
    return `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="muted" style="font-size:12px">${sub}</div>` : ""}</div>`;
  }
  function row(label, value) { return `<tr><td>${label}</td><td>${value}</td></tr>`; }
  function stanceLabel(s) { return { bullish: "▲ Bullish", bearish: "▼ Bearish", neutral: "● Neutral" }[s] || s; }
  function movesTable(title, rows) {
    return `<div><h3>${title}</h3><div class="table-wrap"><table><tbody>${rows.map((m) => `<tr><td>${fmt.date(m.date)}</td><td>${fmt.pctSpan(m.change_pct, 2)}</td></tr>`).join("")}</tbody></table></div></div>`;
  }
  function fairRange(fv, price, cur) {
    const lo = Math.min(fv.low, price) * 0.9;
    const hi = Math.max(fv.high, price) * 1.1;
    const x = (v) => ((v - lo) / (hi - lo)) * 100;
    return `<div class="range" role="img" aria-label="Fair value range ${fmt.money(fv.low, cur)} to ${fmt.money(fv.high, cur)}, price ${fmt.money(price, cur)}">
      <div class="rail"></div>
      <div class="fv" style="left:${x(fv.low)}%;width:${x(fv.high) - x(fv.low)}%"></div>
      <div class="marker" style="left:${x(price)}%"><span>Price ${fmt.money(price, cur, 0)}</span></div>
      <div class="marker mid" style="left:${x(fv.mid)}%"><span>Fair ${fmt.money(fv.mid, cur, 0)}</span></div>
    </div>
    <p class="sub">Estimated range ${fmt.money(fv.low, cur, 0)} – ${fmt.money(fv.high, cur, 0)}</p>`;
  }

  /* ---------------- compare ---------------- */
  async function renderCompare(arg) {
    const symbols = (arg || "").split(",").map((s) => s.trim()).filter(Boolean);
    app.innerHTML = `
      <section class="card">
        <h2>Compare stocks</h2>
        <p class="sub">Add 2 to 5 stocks to compare returns, risk, valuation and scores side by side</p>
        <form id="cmp-form" class="toolbar" autocomplete="off">
          <div class="chips" style="justify-content:flex-start;margin:0">${symbols.map((s, i) => `<button type="button" class="chip" data-rm="${i}">${esc(s)}<span class="x">×</span></button>`).join("")}</div>
          <input id="cmp-input" class="chip" style="cursor:text;min-width:200px" placeholder="Add symbol, e.g. TCS" ${symbols.length >= 5 ? "disabled" : ""}>
          <button class="btn primary" type="submit" ${symbols.length >= 5 ? "disabled" : ""}>Add</button>
        </form>
      </section>
      <div id="cmp-body"></div>`;
    const go = (list) => { location.hash = "#/compare/" + list.map(encodeURIComponent).join(","); };
    $("#cmp-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const v = $("#cmp-input").value.trim().toUpperCase();
      if (v && !symbols.includes(v)) go([...symbols, v]);
    });
    app.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => go(symbols.filter((_, i) => i !== +b.dataset.rm))));
    const body = $("#cmp-body");
    if (symbols.length < 2) {
      body.innerHTML = `<p class="muted" style="text-align:center;margin-top:32px">Add at least two stocks. Try <a href="#/compare/RELIANCE,TCS,HDFCBANK">RELIANCE, TCS, HDFCBANK</a>.</p>`;
      return;
    }
    body.innerHTML = `<div class="loading"><div class="spinner"></div>Comparing ${symbols.length} stocks…</div>`;
    let data;
    try { data = await api(`/api/compare?symbols=${symbols.map(encodeURIComponent).join(",")}`); } catch (err) { body.innerHTML = `<div class="error">${esc(err.message)}</div>`; return; }
    const ok = data.stocks.filter((s) => !s.error);
    const bad = data.stocks.filter((s) => s.error);
    const metrics = [
      ["Price", (s) => fmt.money(s.price, s.currency)],
      ["Market cap", (s) => fmt.big(s.market_cap, s.currency)],
      ["1Y return", (s) => fmt.pctSpan(s.return_1y_pct)],
      ["5Y CAGR", (s) => fmt.pct(s.cagr_5y_pct)],
      ["10Y CAGR", (s) => fmt.pct(s.cagr_10y_pct)],
      ["Volatility (1Y)", (s) => fmt.pct(s.volatility_1y_pct, 1, false)],
      ["Max drawdown", (s) => fmt.pct(s.max_drawdown_pct)],
      ["P/E", (s) => fmt.n(s.pe, 1)],
      ["P/B", (s) => fmt.n(s.pb, 2)],
      ["ROE", (s) => fmt.pct(s.roe_pct, 1, false)],
      ["Debt / equity", (s) => fmt.n(s.debt_to_equity, 2)],
      ["Dividend yield", (s) => fmt.pct(s.dividend_yield_pct, 2, false)],
      ["Fair value (mid)", (s) => fmt.money(s.fair_value_mid, s.currency)],
      ["Valuation", (s) => esc(s.valuation_verdict)],
      ["InvestIQ score", (s) => `<strong>${s.score ?? "—"}</strong> <span class="muted">${esc(s.rating)}</span>`],
    ];
    let range = "5Y";
    body.innerHTML = `
      ${bad.length ? `<p class="down">Could not load: ${bad.map((b) => esc(b.query)).join(", ")}</p>` : ""}
      <section class="card section">
        <h2>Growth of 100</h2>
        <p class="sub">Each stock rebased to 100 at the start of the period</p>
        <div class="toolbar"><div class="seg" id="cmp-seg">${["1Y", "3Y", "5Y", "10Y", "MAX"].map((l) => `<button type="button" data-range="${l}">${l}</button>`).join("")}</div></div>
        <div class="legend">${ok.map((s, i) => `<span><span class="swatch" style="background:var(${charts.SERIES[i]})"></span> ${esc(s.symbol)}</span>`).join("")}</div>
        <div class="chart-box tall"><canvas id="cmp-chart" aria-label="Comparison chart"></canvas></div>
      </section>
      <section class="card section">
        <div class="table-wrap"><table>
          <thead><tr><th>Metric</th>${ok.map((s) => `<th><a href="#/stock/${encodeURIComponent(s.symbol)}">${esc(s.symbol)}</a></th>`).join("")}</tr></thead>
          <tbody>${metrics.map(([label, f]) => `<tr><td>${label}</td>${ok.map((s) => `<td>${f(s)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table></div>
      </section>
      <p class="disclaimer">${esc(data.disclaimer)}</p>`;
    const draw = () => {
      document.querySelectorAll("#cmp-seg button").forEach((b) => b.classList.toggle("on", b.dataset.range === range));
      const last = ok.map((s) => s.chart.dates[s.chart.dates.length - 1]).sort().pop();
      const months = { "1Y": 12, "3Y": 36, "5Y": 60, "10Y": 120, MAX: null }[range];
      // MAX: start where every stock has data so they share a base date.
      const start = months === null ? ok.map((s) => s.chart.dates[0]).sort().pop() : rangeStart(last, months);
      charts.compare($("#cmp-chart"), ok, start);
    };
    $("#cmp-seg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { range = b.dataset.range; draw(); } });
    if (ok.length) draw();
  }

  route();
})();
