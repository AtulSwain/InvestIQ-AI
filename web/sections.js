/* Deeper report sections: buy checklist & trade plan, extra valuation,
   financial breakdown, returns breakdown and dividends. Each function returns
   HTML; bind() wires up charts and inputs once the HTML is in the page. */
(function () {
  const { esc } = fmt;
  const { T, tip, why } = glossary; // (i) tooltips + "What this tells you" captions
  const $ = (sel) => document.querySelector(sel);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const passIcon = (p) => p === true ? '<span class="icon good" aria-label="pass">✓</span>'
    : p === false ? '<span class="icon bad" aria-label="fail">✗</span>'
    : '<span class="icon muted" aria-label="no data">–</span>';

  function heat(v, scale = 12) {
    if (v == null) return "";
    const a = Math.min(Math.abs(v) / scale, 1) * 55;
    return `background:color-mix(in srgb, var(${v >= 0 ? "--pos" : "--neg"}) ${a.toFixed(0)}%, transparent)`;
  }

  /* ---------- 1. Should I buy? ---------- */
  function decision(r) {
    const c = r.checklist;
    const p = r.trade_plan;
    const cur = r.currency;
    const cats = [...new Set(c.items.map((i) => i.category))];
    return `
    <section id="decision" class="section grid grid-2">
      <div class="card">
        <h2>${T("Buy checklist", "checklist")}</h2>
        ${why("How many of the basic tests a careful investor runs before buying this stock passes.")}
        <div class="check-head tone-${c.tone}">
          <div class="check-score">${c.passed}<span class="muted">/${c.evaluated}</span></div>
          <div><strong>${esc(c.verdict)}</strong><div class="muted" style="font-size:13px">✓ pass · ✗ fail · – not enough data</div></div>
        </div>
        ${cats.map((cat) => `
          <h3>${esc({ Business: "Business quality", Strength: "Financial strength", Valuation: "Valuation", Price: "Price & momentum" }[cat] || cat)}</h3>
          <ul class="checklist">${c.items.filter((i) => i.category === cat).map((i) => `
            <li>${passIcon(i.passed)}<div><div>${esc(i.check)}</div><div class="muted" style="font-size:13px">${esc(i.detail)}</div></div></li>`).join("")}
          </ul>`).join("")}
      </div>
      <div class="card">
        <h2>Trade plan</h2>
        ${why("At what price you might buy, where to cut losses, and where you might take profit.")}
        ${p.far_above_fair_value
          ? `<p class="callout">The price is far above every fair-value estimate, so there is no sensible mechanical entry right now. The zone below is where the stock would be fairly valued - it may never get there if the market is right about its growth.</p>`
          : p.wait_for_pullback ? `<p class="callout">The price is above the estimated fair value. The entry zone below is where the stock would be closer to fair value - consider waiting for a pullback.</p>` : ""}
        <div class="table-wrap"><table><tbody>
          <tr><td>Current price</td><td><strong>${fmt.money(p.price, cur)}</strong></td></tr>
          <tr><td>${T(p.far_above_fair_value ? "Fair-value zone" : "Entry zone", "entry_zone")}</td><td>${fmt.money(p.entry_low, cur)} – ${fmt.money(p.entry_high, cur)}</td></tr>
          <tr><td>${T("Stop-loss")}</td><td class="down">${fmt.money(p.stop_loss, cur)} <span class="muted">(${fmt.pct(p.stop_loss_pct)} from entry)</span></td></tr>
          ${p.targets.map((t, i) => `<tr><td>${T(`Target ${i + 1}`, "target")} <span class="muted">· ${esc(t.label)}</span></td><td class="up">${fmt.money(t.price, cur)} <span class="muted">(${fmt.pct(t.upside_pct)} from entry)</span></td></tr>`).join("") || `<tr><td>Targets</td><td class="muted">${p.far_above_fair_value ? "Not set while the price is far above fair value" : "No upside targets above the entry"}</td></tr>`}
          <tr><td>${T("Reward : risk (to target 1)", "reward_risk")}</td><td><strong>${p.risk_reward == null ? "—" : p.risk_reward.toFixed(2) + " : 1"}</strong> <span class="muted">${p.risk_reward == null ? "" : p.risk_reward >= 2 ? "attractive" : p.risk_reward >= 1 ? "acceptable" : "poor"}</span></td></tr>
          <tr><td>${T("Average daily range (ATR 14)", "atr")}</td><td>${fmt.money(p.atr, cur)} <span class="muted">(${fmt.pct(r.technicals.atr_pct, 1, false)})</span></td></tr>
        </tbody></table></div>
        <h3>${T("Position size calculator", "position_size")}</h3>
        <div class="calc">
          <label>Your capital (${fmt.sym(cur).trim() || cur})<input id="ps-capital" type="number" min="0" step="1000" value="${cur === "INR" ? 500000 : 10000}"></label>
          <label>Max risk per trade (%)<input id="ps-risk" type="number" min="0.1" max="10" step="0.1" value="1"></label>
          <label>Stop-loss (${fmt.sym(cur).trim() || cur})<input id="ps-stop" type="number" min="0" step="0.05" value="${p.stop_loss}"></label>
        </div>
        <p id="ps-out" class="ps-out"></p>
        <p class="disclaimer">${esc(p.note)}</p>
      </div>
    </section>`;
  }

  /* ---------- 2. More valuation ---------- */
  function valuationExtra(r) {
    const v = r.valuation;
    const m = v.multiples || {};
    const cur = r.currency;
    const rd = v.reverse_dcf || {};
    const sens = v.dcf_sensitivity;
    const price = r.quote.price;
    const stat = (label, value, sub, key) => `<div class="stat"><div class="label">${T(label, key)}</div><div class="value">${value}</div>${sub ? `<div class="muted" style="font-size:12px">${sub}</div>` : ""}</div>`;
    return `
    <section class="section grid grid-2">
      <div class="card">
        <h2>Valuation multiples</h2>
        ${why("How expensive the share is relative to its profits, sales, assets and cash.")}
        <div class="stats">
          ${stat("P/E", fmt.n(m.pe, 1), v.average_pe ? `own avg ${fmt.n(v.average_pe, 1)}` : "")}
          ${stat("Forward P/E", fmt.n(m.forward_pe, 1))}
          ${stat("P/B", fmt.n(m.pb, 2))}
          ${stat("P/S", fmt.n(m.ps, 2))}
          ${stat("EV / EBITDA", fmt.n(m.ev_ebitda, 1))}
          ${stat("EV / Sales", fmt.n(m.ev_sales, 2))}
          ${stat("Earnings yield", fmt.pct(m.earnings_yield_pct, 1, false), "inverse of P/E")}
          ${stat("FCF yield", fmt.pct(m.fcf_yield_pct, 1, false), "free cash / market cap")}
          ${stat("Enterprise value", fmt.big(m.enterprise_value, cur), "market cap + debt − cash")}
        </div>
        ${v.pe_history && v.pe_history.length ? `
        <h3>${T("P/E at each year-end", "historical_pe")}</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Fiscal year</th><th>Price</th><th>EPS</th><th>P/E</th></tr></thead>
          <tbody>${v.pe_history.map((h) => `<tr><td>${fmt.date(h.fiscal_year_end)}</td><td>${fmt.money(h.price, cur)}</td><td>${fmt.money(h.eps, cur)}</td><td>${fmt.n(h.pe, 1)}</td></tr>`).join("")}
            <tr><td><strong>Today</strong></td><td>${fmt.money(price, cur)}</td><td>${fmt.money(r.fundamentals.eps, cur)}</td><td><strong>${fmt.n(m.pe, 1)}</strong></td></tr></tbody>
        </table></div>` : ""}
      </div>
      <div class="card">
        <h2>What is the price assuming?</h2>
        ${why("How much growth the market already expects - high expectations are easier to disappoint.")}
        <p class="sub">${T("Reverse DCF")} - the free-cash-flow growth needed to justify today's price</p>
        ${rd.implied_growth_pct != null ? `
          <div class="big-compare">
            <div><div class="label">Growth priced in</div><div class="value">${fmt.pct(rd.implied_growth_pct, 1, false)}<span class="muted">/yr</span></div></div>
            <div><div class="label">Growth delivered</div><div class="value">${fmt.pct(rd.assumed_growth_pct, 1, false)}<span class="muted">/yr</span></div></div>
          </div>
          <p>${esc(rd.reading)}</p>` : '<p class="muted">Needs positive free cash flow.</p>'}
        ${sens ? `
        <h3>${T("DCF value per share - sensitivity", "dcf_sensitivity")}</h3>
        <p class="sub">Rows: discount rate (your required return). Columns: growth rate. Base case outlined; shaded cells are above today's price.</p>
        <div class="table-wrap"><table class="sens">
          <thead><tr><th>Discount \\ growth</th>${sens.growth_pct.map((g) => `<th>${fmt.pct(g, 0, false)}</th>`).join("")}</tr></thead>
          <tbody>${sens.values.map((row, i) => `<tr><td>${fmt.pct(sens.discount_pct[i], 0, false)}</td>${row.map((val, j) => `
            <td class="${i === 2 && j === 2 ? "base" : ""}" style="${val != null && val > price ? heat(40, 100) : ""}">${val == null ? "—" : fmt.money(val, cur, 0)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table></div>` : ""}
      </div>
    </section>`;
  }

  /* ---------- 3. Financial breakdown ---------- */
  const FIN_ROWS = [
    ["Income", null],
    ["Revenue", "revenue", "big"], ["Revenue growth", "revenue_growth_pct", "pct"],
    ["Gross profit", "gross_profit", "big"], ["EBITDA", "ebitda", "big"], ["Operating profit", "operating_income", "big"],
    ["Net profit", "net_income", "big"], ["Profit growth", "profit_growth_pct", "pct"], ["EPS", "eps", "money"],
    ["Margins & returns", null],
    ["Gross margin", "gross_margin_pct", "pctu"], ["Operating margin", "operating_margin_pct", "pctu"], ["Net margin", "net_margin_pct", "pctu"],
    ["ROE", "roe_pct", "pctu"], ["ROCE", "roce_pct", "pctu"], ["ROA", "roa_pct", "pctu"],
    ["Balance sheet", null],
    ["Total assets", "total_assets", "big"], ["Shareholders' equity", "equity", "big"], ["Total debt", "total_debt", "big"], ["Cash", "cash", "big"],
    ["Debt / equity", "debt_to_equity", "n"], ["Current ratio", "current_ratio", "n"], ["Interest coverage", "interest_coverage", "x"],
    ["Cash flow", null],
    ["Operating cash flow", "operating_cash_flow", "big"], ["Capex", "capex", "big"], ["Free cash flow", "free_cash_flow", "big"],
    ["Cash conversion (OCF / profit)", "cash_conversion", "x"],
  ];

  // Row key -> glossary entry for its (i) tooltip.
  const FIN_KEYS = {
    revenue: "revenue", revenue_growth_pct: "revenue", gross_profit: "gross_profit", ebitda: "ebitda",
    operating_income: "operating_profit", net_income: "net_income", profit_growth_pct: "net_income", eps: "eps",
    gross_margin_pct: "gross_margin", operating_margin_pct: "operating_margin", net_margin_pct: "profit_margin",
    roe_pct: "roe", roce_pct: "roce", roa_pct: "roa", total_assets: null, equity: "book_value", total_debt: "total_debt",
    cash: null, debt_to_equity: "debt_to_equity", current_ratio: "current_ratio", interest_coverage: "interest_coverage",
    operating_cash_flow: "ocf", capex: "capex", free_cash_flow: "fcf", cash_conversion: "cash_conversion",
  };

  function finCell(v, kind, cur) {
    if (v == null) return '<span class="muted">—</span>';
    switch (kind) {
      case "big": return fmt.big(v, cur);
      case "pct": return fmt.pctSpan(v);
      case "pctu": return fmt.pct(v, 1, false);
      case "money": return fmt.money(v, cur);
      case "x": return fmt.n(v, 2) + "×";
      default: return fmt.n(v, 2);
    }
  }

  function financials(r) {
    const fin = r.financials;
    const years = fin.years || [];
    const cur = r.currency;
    const pio = fin.piotroski;
    const alt = fin.altman;
    if (!years.length) {
      return `<section id="financials" class="card section"><h2>Financial breakdown</h2><p class="muted">Financial statements are not available for this symbol.</p></section>`;
    }
    return `
    <section id="financials" class="card section">
      <h2>Financial breakdown</h2>
      ${why("The company's report card for each year - sales, profit, margins, debt and cash.")}
      <p class="sub">Annual statements, oldest to newest</p>
      <div class="table-wrap"><table class="fin">
        <thead><tr><th>Metric</th>${years.map((y) => `<th>FY${y.fiscal_year_end.slice(0, 4)}</th>`).join("")}</tr></thead>
        <tbody>${FIN_ROWS.map(([label, key, kind]) => key === null
          ? `<tr class="group"><td colspan="${years.length + 1}">${label}</td></tr>`
          : years.some((y) => y[key] != null) ? `<tr><td>${T(label, FIN_KEYS[key])}</td>${years.map((y) => `<td>${finCell(y[key], kind, cur)}</td>`).join("")}</tr>` : "").join("")}</tbody>
      </table></div>
    </section>
    <section class="section grid grid-3">
      <div class="card">
        <h2>Margin trend</h2>
        ${why("Whether the company keeps more or less of each rupee of sales as profit over time.")}
        <div class="legend">
          <span><span class="swatch" style="background:var(--series-1)"></span> Gross</span>
          <span><span class="swatch" style="background:var(--series-2)"></span> Operating</span>
          <span><span class="swatch" style="background:var(--series-3)"></span> Net</span>
        </div>
        <div class="chart-box short"><canvas id="margin-chart" aria-label="Margin trend"></canvas></div>
      </div>
      <div class="card">
        <h2>${T("Piotroski F-Score", "fscore")}</h2>
        ${why("A 9-point health check - is the business getting stronger or weaker than last year?")}
        ${pio ? `
          <div class="check-head tone-${pio.label === "Strong" ? "good" : pio.label === "Average" ? "mixed" : "bad"}">
            <div class="check-score">${pio.score}<span class="muted">/${pio.out_of}</span></div>
            <div><strong>${esc(pio.label)}</strong><div class="muted" style="font-size:13px">7-9 strong · 4-6 average · 0-3 weak</div></div>
          </div>
          <ul class="checklist compact">${pio.tests.map((t) => `<li>${passIcon(t.passed)}<div><div>${esc(t.test)}</div><div class="muted" style="font-size:12px">${esc(t.detail)}</div></div></li>`).join("")}</ul>`
          : '<p class="muted">Needs at least two years of detailed statements.</p>'}
      </div>
      <div class="card">
        <h2>${T("Altman Z-Score", "zscore")}</h2>
        ${why("An early-warning score for the risk of the company running into serious financial trouble.")}
        ${alt && alt.z != null ? `
          <div class="check-head tone-${alt.zone === "Safe" ? "good" : alt.zone === "Grey zone" ? "mixed" : "bad"}">
            <div class="check-score">${alt.z}</div>
            <div><strong>${esc(alt.zone)}</strong></div>
          </div>
          ${zBar(alt.z)}
          <div class="table-wrap"><table><tbody>
            ${[["Working capital / assets", "working_capital"], ["Retained earnings / assets", "retained_earnings"], ["EBIT / assets", "ebit"], ["Market value / liabilities", "market_value"], ["Sales / assets", "sales"]]
              .map(([l, k]) => `<tr><td>${l}</td><td>${fmt.n(alt.components[k], 2)}</td></tr>`).join("")}
          </tbody></table></div>
          <p class="disclaimer">${esc(alt.note)}</p>`
          : `<p class="muted">${esc(alt ? alt.note : "Not enough balance-sheet data.")}</p>`}
      </div>
    </section>`;
  }

  function zBar(z) {
    const max = 6;
    const x = (v) => Math.min(v, max) / max * 100;
    return `<div class="zbar" role="img" aria-label="Z-Score ${z} on a scale where below 1.81 is distress and above 2.99 is safe">
      <div class="zone distress" style="width:${x(1.81)}%"></div>
      <div class="zone grey" style="left:${x(1.81)}%;width:${x(2.99) - x(1.81)}%"></div>
      <div class="zone safe" style="left:${x(2.99)}%;right:0"></div>
      <div class="marker" style="left:${x(Math.max(z, 0))}%"></div>
    </div>
    <div class="zbar-labels"><span>Distress</span><span>Grey</span><span>Safe</span></div>`;
  }

  /* ---------- 4. Returns breakdown & dividends ---------- */
  function breakdown(r) {
    const b = r.breakdown;
    const cur = r.currency;
    const d = b.dividends;
    return `
    <section id="breakdown" class="card section">
      <h2>Monthly returns</h2>
      ${why("Every month's gain or loss - spot good and bad stretches at a glance.")}
      <p class="sub">Each cell is that month's return; the colour gets stronger with bigger moves (blue up, red down)</p>
      <div class="table-wrap"><table class="heatmap">
        <thead><tr><th>Year</th>${MONTHS.map((m) => `<th>${m}</th>`).join("")}<th>Year</th></tr></thead>
        <tbody>${b.monthly.map((row) => `<tr><td>${row.year}</td>${row.months.map((v) => `<td style="${heat(v)}">${v == null ? "" : fmt.n(v, 1)}</td>`).join("")}<td style="${heat(row.total_pct, 40)}"><strong>${fmt.n(row.total_pct, 1)}</strong></td></tr>`).join("")}</tbody>
      </table></div>
    </section>
    <section class="section grid grid-2">
      <div class="card">
        <h2>${T("Seasonality")}</h2>
        ${why("Whether some months of the year have tended to be better or worse for this stock.")}
        <div class="chart-box short"><canvas id="season-chart" aria-label="Average return by month"></canvas></div>
        <div class="table-wrap"><table class="compact">
          <thead><tr><th>Month</th>${b.seasonality.map((s) => `<th>${s.month}</th>`).join("")}</tr></thead>
          <tbody><tr><td>Up in</td>${b.seasonality.map((s) => `<td>${s.positive_pct == null ? "—" : s.positive_pct + "%"}</td>`).join("")}</tr></tbody>
        </table></div>
      </div>
      <div class="card">
        <h2>${T("Holding-period returns")}</h2>
        ${why("How long you needed to hold to make money - longer holding usually means fewer losses.")}
        <p class="sub">If you had bought in any week and held for N years - annual return (${T("CAGR")})</p>
        <div class="table-wrap"><table class="compact">
          <thead><tr><th>Held</th><th>Worst</th><th>Typical</th><th>Best</th><th>Gained</th><th>&gt;10%/yr</th></tr></thead>
          <tbody>${b.rolling.map((x) => `<tr><td>${x.years} year${x.years > 1 ? "s" : ""}</td><td>${fmt.pctSpan(x.worst_pct)}</td><td>${fmt.pct(x.median_pct)}</td><td>${fmt.pctSpan(x.best_pct)}</td><td>${x.positive_pct}%</td><td>${x.above_10_pct}%</td></tr>`).join("") || '<tr><td colspan="6" class="muted">Not enough history</td></tr>'}</tbody>
        </table></div>
        <p class="sub" style="margin-top:10px">"Gained" = share of holding periods that made money; "&gt;10%/yr" = share that beat 10% a year. Longer holding periods usually narrow the range between worst and best - that is the case for patience.</p>
      </div>
    </section>
    <section id="dividends" class="section grid grid-2">
      <div class="card">
        <h2>Dividends</h2>
        ${why("The cash the company pays you each year just for holding the share.")}
        ${d.paid ? `
          <div class="stats" style="margin-bottom:12px">
            <div class="stat"><div class="label">${T("Last 12 months", "trailing_12m")}</div><div class="value">${fmt.money(d.ttm, cur)}</div><div class="muted" style="font-size:12px">per share</div></div>
            <div class="stat"><div class="label">${T("Yield", "dividend_yield")}</div><div class="value">${fmt.pct(d.yield_pct, 2, false)}</div></div>
            <div class="stat"><div class="label">5Y dividend growth</div><div class="value">${fmt.pct(d.growth_5y_pct)}</div><div class="muted" style="font-size:12px">per year</div></div>
            <div class="stat"><div class="label">Paid every year for</div><div class="value">${d.streak_years} yrs</div></div>
          </div>
          <div class="chart-box short"><canvas id="div-chart" aria-label="Dividends per share by year"></canvas></div>`
          : '<p class="muted">No dividends recorded - this company reinvests its profits (or pays none).</p>'}
      </div>
      <div class="card">
        <h2>Ownership</h2>
        ${why("Who owns the company - its management, big funds, or the public.")}
        <div class="table-wrap"><table><tbody>
          <tr><td>${T("Insiders / promoters")}</td><td>${fmt.pct(r.fundamentals.insiders_pct, 1, false)}</td></tr>
          <tr><td>${T("Institutions")}</td><td>${fmt.pct(r.fundamentals.institutions_pct, 1, false)}</td></tr>
          <tr><td>Public & others</td><td>${r.fundamentals.insiders_pct != null && r.fundamentals.institutions_pct != null ? fmt.pct(Math.max(0, 100 - r.fundamentals.insiders_pct - r.fundamentals.institutions_pct), 1, false) : "—"}</td></tr>
          <tr><td>Shares outstanding</td><td>${r.fundamentals.shares_outstanding ? fmt.n(r.fundamentals.shares_outstanding / (cur === "INR" ? 1e7 : 1e6), 2) + (cur === "INR" ? " Cr" : " M") : "—"}</td></tr>
        </tbody></table></div>
        <p class="sub" style="margin-top:10px">High insider/promoter holding means management has skin in the game; rising institutional holding often signals growing confidence.</p>
      </div>
    </section>`;
  }

  /* ---------- wiring ---------- */
  function bind(r) {
    const cur = r.currency;
    const years = r.financials.years || [];
    if (years.length && $("#margin-chart")) {
      charts.lines($("#margin-chart"), years.map((y) => "FY" + y.fiscal_year_end.slice(0, 4)), [
        { label: "Gross", data: years.map((y) => y.gross_margin_pct), color: "--series-1" },
        { label: "Operating", data: years.map((y) => y.operating_margin_pct), color: "--series-2" },
        { label: "Net", data: years.map((y) => y.net_margin_pct), color: "--series-3" },
      ], (v) => v + "%");
    }
    const s = r.breakdown.seasonality;
    charts.bars($("#season-chart"), s.map((x) => x.month), s.map((x) => x.avg_pct), "Average return", (v) => fmt.pct(v, 1), true);
    const d = r.breakdown.dividends;
    if (d.paid && $("#div-chart")) {
      charts.bars($("#div-chart"), d.years.map((y) => String(y.year)), d.years.map((y) => y.dividend), "Dividend per share", (v) => fmt.money(v, cur), false);
    }

    const calc = () => {
      const capital = +$("#ps-capital").value || 0;
      const riskPct = (+$("#ps-risk").value || 0) / 100;
      const stop = +$("#ps-stop").value || 0;
      const price = r.trade_plan.entry_high;
      const perShare = price - stop;
      if (perShare <= 0) { $("#ps-out").textContent = "The stop-loss must be below the entry price."; return; }
      const byRisk = Math.floor((capital * riskPct) / perShare);
      const byCash = Math.floor(capital / price);
      const qty = Math.max(0, Math.min(byRisk, byCash));
      $("#ps-out").innerHTML = `Buy up to <strong>${fmt.n(qty, 0)} shares</strong> at about ${fmt.money(price, cur)} (${fmt.money(qty * price, cur, 0)}, ${fmt.pct(capital ? (qty * price / capital) * 100 : 0, 0, false)} of capital).
        If the stop-loss hits you lose about <strong class="down">${fmt.money(qty * perShare, cur, 0)}</strong>.${byCash < byRisk ? " Limited by your capital." : ""}`;
    };
    ["#ps-capital", "#ps-risk", "#ps-stop"].forEach((sel) => $(sel).addEventListener("input", calc));
    calc();
  }

  window.sections = { decision, valuationExtra, financials, breakdown, bind };
})();
