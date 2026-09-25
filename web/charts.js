/* Chart.js wrappers. Colours come from CSS custom properties so light/dark
   themes stay in one place (styles.css). */
(function () {
  const registry = new Map();

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  const crosshair = {
    id: "crosshair",
    afterDatasetsDraw(chart) {
      const active = chart.tooltip && chart.tooltip.getActiveElements();
      if (!active || !active.length) return;
      const x = active[0].element.x;
      const { top, bottom } = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.lineWidth = 1;
      ctx.strokeStyle = css("--axis");
      ctx.stroke();
      ctx.restore();
    },
  };

  function baseOptions(extra = {}) {
    const muted = css("--text-muted");
    const grid = css("--grid");
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: css("--surface-1"),
          titleColor: css("--text-primary"),
          bodyColor: css("--text-secondary"),
          borderColor: css("--border"),
          borderWidth: 1,
          padding: 10,
          boxPadding: 4,
          usePointStyle: true,
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: css("--axis") },
          ticks: { color: muted, maxRotation: 0, autoSkipPadding: 24 },
        },
        y: {
          position: "right",
          grid: { color: grid },
          border: { display: false },
          ticks: { color: muted },
        },
      },
      ...extra,
    };
  }

  function mount(canvas, config) {
    const prev = registry.get(canvas.id);
    if (prev) prev.destroy();
    const chart = new Chart(canvas, config);
    registry.set(canvas.id, chart);
    return chart;
  }

  function timeScale(unitHint) {
    const s = baseOptions().scales.x;
    return { ...s, type: "time", time: { tooltipFormat: "d MMM yyyy", unit: unitHint } };
  }

  function line(label, data, color, extra = {}) {
    return {
      label, data, borderColor: color, backgroundColor: color,
      borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0, spanGaps: true, ...extra,
    };
  }

  /* Price with optional SMA overlays; or stock vs index rebased to 100. */
  function price(canvas, report, startDate, opts) {
    const c = report.chart;
    let i0 = c.dates.findIndex((d) => d >= startDate);
    if (i0 < 0) i0 = 0;
    const dates = c.dates.slice(i0);
    const pts = (arr) => arr.slice(i0).map((y, k) => ({ x: dates[k], y }));
    const cur = report.currency;
    const datasets = [];
    let yFmt = (v) => fmt.money(v, cur, v >= 1000 ? 0 : 2);

    if (opts.vsIndex && report.benchmark_chart) {
      const b = report.benchmark_chart;
      const base = c.close[i0];
      let j0 = b.dates.findIndex((d) => d >= dates[0]);
      if (j0 < 0) j0 = 0;
      const bBase = b.close[j0];
      datasets.push(line(report.symbol, c.close.slice(i0).map((y, k) => ({ x: dates[k], y: (y / base) * 100 })), css("--series-1")));
      datasets.push(line(indexName(report.benchmark), b.close.slice(j0).map((y, k) => ({ x: b.dates[j0 + k], y: (y / bBase) * 100 })), css("--series-2")));
      yFmt = (v) => fmt.n(v, 0);
    } else {
      datasets.push(line("Close", pts(c.close), css("--series-1"), {
        fill: { target: "origin" },
        backgroundColor: css("--band"),
      }));
      if (opts.sma50) datasets.push(line("SMA 50", pts(c.sma50), css("--series-3"), { borderWidth: 1.5 }));
      if (opts.sma200) datasets.push(line("SMA 200", pts(c.sma200), css("--series-4"), { borderWidth: 1.5 }));
    }
    const o = baseOptions();
    o.scales.x = timeScale();
    o.scales.y.beginAtZero = false;
    o.scales.y.ticks.callback = yFmt;
    o.plugins.tooltip.callbacks = {
      label: (ctx) => ` ${ctx.dataset.label}: ${opts.vsIndex ? fmt.n(ctx.parsed.y, 1) : fmt.money(ctx.parsed.y, cur)}`,
    };
    return mount(canvas, { type: "line", data: { datasets }, options: o, plugins: [crosshair] });
  }

  function indexName(sym) {
    return { "^NSEI": "NIFTY 50", "^GSPC": "S&P 500", "^BSESN": "SENSEX" }[sym] || sym;
  }

  /* Calendar-year returns: stock vs index (grey = benchmark). */
  function yearBars(canvas, rows, benchLabel) {
    const o = baseOptions();
    o.scales.y.ticks.callback = (v) => v + "%";
    o.plugins.tooltip.callbacks = { label: (ctx) => ` ${ctx.dataset.label}: ${fmt.pct(ctx.parsed.y)}` };
    o.datasets = { bar: { borderRadius: 4, borderSkipped: false, categoryPercentage: 0.7, barPercentage: 0.9 } };
    return mount(canvas, {
      type: "bar",
      data: {
        labels: rows.map((r) => r.year + (r.partial ? "*" : "")),
        datasets: [
          { label: "Stock", data: rows.map((r) => r.return_pct), backgroundColor: css("--series-1") },
          { label: benchLabel, data: rows.map((r) => r.benchmark_return_pct), backgroundColor: css("--axis") },
        ],
      },
      options: o,
    });
  }

  function drawdown(canvas, dd) {
    const o = baseOptions();
    o.scales.x = timeScale();
    o.scales.y.max = 0;
    o.scales.y.ticks.callback = (v) => v + "%";
    o.plugins.tooltip.callbacks = { label: (ctx) => ` Below peak: ${fmt.pct(ctx.parsed.y)}` };
    const color = css("--neg");
    return mount(canvas, {
      type: "line",
      data: {
        datasets: [line("Drawdown", dd.dates.map((d, i) => ({ x: d, y: dd.values[i] })), color, {
          fill: { target: "origin" }, backgroundColor: color + "33", borderWidth: 1.5,
        })],
      },
      options: o,
      plugins: [crosshair],
    });
  }

  function fan(canvas, proj, currency) {
    const o = baseOptions();
    const labels = proj.fan.map((p) => (p.months % 12 === 0 ? `Y${p.months / 12}` : ""));
    o.scales.y.ticks.callback = (v) => fmt.money(v, currency, 0);
    o.scales.x.ticks.autoSkip = false;
    o.plugins.tooltip.callbacks = {
      title: (items) => `In ${(proj.fan[items[0].dataIndex].months / 12).toFixed(2).replace(/\.00$/, "")} years`,
      label: (ctx) => ` ${ctx.dataset.label}: ${fmt.money(ctx.parsed.y, currency, 0)}`,
    };
    const blue = css("--series-1");
    return mount(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          line("Bull (90th pct)", proj.fan.map((p) => p.bull), blue, { borderWidth: 1, borderDash: [4, 4], fill: "+2", backgroundColor: css("--band") }),
          line("Base (median)", proj.fan.map((p) => p.base), blue),
          line("Bear (10th pct)", proj.fan.map((p) => p.bear), blue, { borderWidth: 1, borderDash: [4, 4] }),
        ],
      },
      options: o,
      plugins: [crosshair],
    });
  }

  function financials(canvas, statements, currency) {
    const o = baseOptions();
    o.scales.y.ticks.callback = (v) => fmt.big(v, currency);
    o.plugins.tooltip.callbacks = { label: (ctx) => ` ${ctx.dataset.label}: ${fmt.big(ctx.parsed.y, currency)}` };
    o.datasets = { bar: { borderRadius: 4, borderSkipped: false, categoryPercentage: 0.7, barPercentage: 0.9 } };
    return mount(canvas, {
      type: "bar",
      data: {
        labels: statements.map((s) => "FY" + s.fiscal_year_end.slice(0, 4)),
        datasets: [
          { label: "Revenue", data: statements.map((s) => s.revenue), backgroundColor: css("--series-1") },
          { label: "Net income", data: statements.map((s) => s.net_income), backgroundColor: css("--series-2") },
        ],
      },
      options: o,
    });
  }

  const SERIES = ["--series-1", "--series-2", "--series-3", "--series-4", "--series-5"];

  function compare(canvas, stocks, startDate) {
    const datasets = stocks.map((s, idx) => {
      let i0 = s.chart.dates.findIndex((d) => d >= startDate);
      if (i0 < 0) i0 = 0;
      const base = s.chart.close[i0];
      return line(s.symbol, s.chart.close.slice(i0).map((y, k) => ({ x: s.chart.dates[i0 + k], y: (y / base) * 100 })), css(SERIES[idx]));
    });
    const o = baseOptions();
    o.scales.x = timeScale();
    o.plugins.tooltip.callbacks = { label: (ctx) => ` ${ctx.dataset.label}: ${fmt.n(ctx.parsed.y, 1)}` };
    return mount(canvas, { type: "line", data: { datasets }, options: o, plugins: [crosshair] });
  }

  function destroyAll() {
    registry.forEach((c) => c.destroy());
    registry.clear();
  }

  window.charts = { price, yearBars, drawdown, fan, financials, compare, destroyAll, css, indexName, SERIES };
})();
