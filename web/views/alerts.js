/* Smart alerts: price levels, daily moves, any InvestIQ metric (valuation, quality, technicals),
   news by category, upcoming earnings, insider selling, analyst downgrades and new filings.
   The engine runs in the browser while InvestIQ is open (on load and every 15 minutes), fires
   once when a condition becomes true, logs it, and shows a toast / browser notification.
   #/alerts · #/alerts/new/SYM */
(function () {
  const { esc } = fmt;
  const data = window.investiqData;
  const INTERVAL = 15 * 60 * 1000;

  const TYPES = {
    price_above: { label: "Price rises above", needs: "value", unit: "price" },
    price_below: { label: "Price falls below", needs: "value", unit: "price" },
    move: { label: "Daily move of at least ±", needs: "value", unit: "%" },
    metric: { label: "Metric condition", needs: "metric" },
    news: { label: "New news", needs: "category" },
    earnings: { label: "Earnings within N days", needs: "value", unit: "days" },
    insider: { label: "New insider selling", needs: null },
    downgrade: { label: "Analyst downgrade", needs: null },
    filing: { label: "New filing (US/SEC)", needs: null },
  };
  const EVENT_TYPES = ["news", "insider", "downgrade", "filing"];
  const RISK_CATS = ["regulatory", "lawsuit", "m&a", "insider", "earnings", "analyst"];
  const OPS = { ">=": (a, b) => a >= b, "<=": (a, b) => a <= b, ">": (a, b) => a > b, "<": (a, b) => a < b };

  function describe(a) {
    const t = TYPES[a.type];
    if (a.type === "metric") return `${a.metricLabel || a.metric} ${a.op} ${a.value}`;
    if (a.type === "news") return `New ${a.category ? ui.CAT_LABEL[a.category] || a.category : "any"} news`;
    return `${t.label}${t.needs === "value" ? ` ${a.value}${t.unit === "%" ? "%" : t.unit === "days" ? " days" : ""}` : ""}`;
  }

  /* Evaluate one alert against a report. Returns {state, key, message} - fires when state turns true
     (level alerts) or when a new event key appears (event alerts). */
  function evaluate(a, r) {
    const q = r.quote, ext = r.extended || {};
    const newest = (arr, f) => (arr || []).filter(f).sort((x, y) => String(y.date || y.published_at).localeCompare(String(x.date || x.published_at)))[0];
    switch (a.type) {
      case "price_above": return { state: q.price >= a.value, message: `${r.symbol} is at ${fmt.money(q.price, r.currency)}, above ${fmt.money(a.value, r.currency)}` };
      case "price_below": return { state: q.price <= a.value, message: `${r.symbol} is at ${fmt.money(q.price, r.currency)}, below ${fmt.money(a.value, r.currency)}` };
      case "move": return { state: Math.abs(q.change_pct) >= a.value, key: r.as_of, message: `${r.symbol} moved ${fmt.pct(q.change_pct, 2)} today` };
      case "metric": {
        const m = r.metrics[a.metric];
        if (!m || m.value == null) return { state: false };
        return { state: OPS[a.op](m.value, a.value), message: `${r.symbol}: ${m.label} is ${ui.fmtUnit(m.value, m.unit, m.currency)} (${a.op} ${a.value})` };
      }
      case "news": {
        const n = newest(ext.news, (x) => !a.category || x.category === a.category);
        return n ? { event: true, key: n.published_at + n.title, message: `${r.symbol}: ${n.title}`, url: n.url } : { state: false };
      }
      case "earnings": {
        const u = ext.earnings?.upcoming?.[0];
        if (!u) return { state: false };
        const days = Math.round((new Date(u.date) - Date.now()) / 864e5);
        return { state: days >= 0 && days <= a.value, key: u.date, message: `${r.symbol} reports earnings on ${fmt.date(u.date)} (${days} days)` };
      }
      case "insider": {
        const t = newest(ext.ownership?.insider_transactions, (x) => /sale|sell/i.test(`${x.transaction} ${x.text}`));
        return t ? { event: true, key: t.date + t.insider + t.shares, message: `${r.symbol}: ${t.insider} (${t.position || "insider"}) sold ${fmt.n(t.shares, 0)} shares` } : { state: false };
      }
      case "downgrade": {
        const d = newest(ext.analyst?.actions, (x) => /down/i.test(x.action || ""));
        return d ? { event: true, key: d.date + d.firm, message: `${r.symbol}: ${d.firm} downgraded to ${d.to_grade}` } : { state: false };
      }
      case "filing": {
        const f = newest(ext.filings?.items, () => true);
        return f ? { event: true, key: f.date + f.type + f.title, message: `${r.symbol}: new ${f.type} filing - ${f.title || ""}`, url: f.url } : { state: false };
      }
      default: return { state: false };
    }
  }

  function notify(title, body) {
    ui.toast(title, body, 9000);
    try { if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body }); } catch { /* not supported */ }
  }

  const engine = {
    timer: null,
    running: false,
    async check({ manual = false } = {}) {
      if (engine.running) return 0;
      const active = store.alerts.all().filter((a) => a.active);
      if (!active.length) return 0;
      engine.running = true;
      let fired = 0;
      try {
        const syms = [...new Set(active.map((a) => a.symbol))];
        const reports = {};
        await Promise.all(syms.map(async (s) => { try { reports[s] = await data.freshReport(s); } catch { /* skip this symbol */ } }));
        for (const a of active) {
          const r = reports[a.symbol];
          if (!r) continue;
          const res = evaluate(a, r);
          const prev = a.last || {};
          // Event alerts fire on a new event after the first check (which only records the baseline);
          // level alerts fire when the condition turns true, or again on a new day / date key.
          const isEvent = EVENT_TYPES.includes(a.type);
          const fire = isEvent ? !!res.key && !!prev.checked && res.key !== prev.key
            : !!res.state && (!prev.state || (!!res.key && !!prev.key && res.key !== prev.key));
          store.alerts.update(a.id, { last: { state: !!res.state, key: res.key || null, checked: new Date().toISOString() } });
          if (fire) {
            fired++;
            store.alerts.log({ alert: a.id, symbol: a.symbol, type: a.type, message: res.message, url: res.url || null });
            notify(`InvestIQ alert · ${a.symbol}`, res.message);
          }
        }
        if (manual) ui.toast(fired ? `${fired} alert(s) triggered` : "Checked - nothing new", `${active.length} active alert(s)`);
      } finally { engine.running = false; }
      return fired;
    },
    start() {
      if (engine.timer) return;
      setTimeout(() => engine.check(), 4000);
      engine.timer = setInterval(() => engine.check(), INTERVAL);
    },
  };

  window.views.alerts = {
    title: "Alerts",
    engine,
    evaluate,
    async render(el, arg, ctx) {
      const pre = arg?.startsWith("new/") ? decodeURIComponent(arg.slice(4)) : "";
      el.innerHTML = `<div class="page-head"><div><div class="crumbs">Monitor</div><h1>Smart alerts</h1>
          <p class="sub muted">Checked in this browser while InvestIQ is open - on load and every 15 minutes. Each alert fires once when its condition becomes true.</p></div>
          <div class="row"><button class="btn" id="al-perm">${ui.icon("alerts")} Browser notifications</button><button class="btn" id="al-check">${ui.icon("refresh")} Check now</button></div></div>
        <div class="card section"><h2>New alert</h2>
          <form id="al-form" class="filters" autocomplete="off">
            <input id="al-sym" placeholder="Symbol, e.g. TCS.NS" value="${esc(pre)}" required style="width:160px">
            <select id="al-type" aria-label="Alert type">${Object.entries(TYPES).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join("")}</select>
            <span id="al-extra" class="row"></span>
            <button class="btn primary" type="submit">${ui.icon("plus")} Create</button></form>
          <div class="chips" id="al-quick" style="margin-top:8px"></div></div>
        <div class="grid grid-2 section"><div class="card"><div class="card-head"><h2>Active alerts</h2><span class="muted" id="al-count"></span></div><div id="al-list"></div></div>
          <div class="card"><div class="card-head"><h2>Triggered</h2><button class="btn sm ghost" id="al-clear">Clear</button></div><div id="al-hist"></div></div></div>
        <p class="disclaimer">Alerts use delayed / end-of-day data and only run while a tab is open; they are not a trading system. Research tool, not investment advice.</p>`;
      const $ = (s) => el.querySelector(s);
      let metrics = null;
      const paintExtra = () => {
        const t = $("#al-type").value, need = TYPES[t].needs;
        $("#al-extra").innerHTML = need === "value" ? `<input id="al-val" type="number" step="any" required placeholder="${TYPES[t].unit === "price" ? "Price" : TYPES[t].unit === "%" ? "%" : "Days"}" style="width:110px">`
          : need === "metric" ? `<select id="al-metric" aria-label="Metric">${(metrics || [["pe", "P/E"], ["margin_of_safety_pct", "Margin of safety"], ["rsi", "RSI"], ["roe_pct", "ROE"], ["debt_to_equity", "Debt/equity"], ["score", "Score"]]).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select>
             <select id="al-op">${Object.keys(OPS).map((o) => `<option>${o}</option>`).join("")}</select><input id="al-val" type="number" step="any" required placeholder="Value" style="width:100px">`
          : need === "category" ? `<select id="al-cat"><option value="">Any category</option>${RISK_CATS.map((c) => `<option value="${c}">${esc(ui.CAT_LABEL[c])}</option>`).join("")}</select>` : "";
      };
      $("#al-type").addEventListener("change", paintExtra);
      paintExtra();
      const loadMetrics = async () => {
        const s = $("#al-sym").value.trim();
        if (!s) return;
        try {
          const r = await data.report(s);
          if (!ctx.alive()) return;
          metrics = Object.entries(r.metrics).filter(([, m]) => typeof m.value === "number").map(([k, m]) => [k, `${m.label} (now ${fmt.n(m.value, 2)})`]);
          $("#al-sym").value = r.symbol;
          $("#al-quick").innerHTML = [[`Price below ${fmt.n(r.quote.price * 0.9, 0)} (-10%)`, { type: "price_below", value: +(r.quote.price * 0.9).toFixed(2) }],
            [`Price above ${fmt.n(r.quote.price * 1.1, 0)} (+10%)`, { type: "price_above", value: +(r.quote.price * 1.1).toFixed(2) }],
            ["Daily move ±5%", { type: "move", value: 5 }], ["Earnings within 7 days", { type: "earnings", value: 7 }],
            ["Regulatory / legal news", { type: "news", category: "regulatory" }], ["Analyst downgrade", { type: "downgrade" }], ["Insider selling", { type: "insider" }],
            r.valuation.fair_value ? [`Price below fair value (${fmt.n(r.valuation.fair_value.mid, 0)})`, { type: "metric", metric: "margin_of_safety_pct", op: ">=", value: 0, metricLabel: "Margin of safety" }] : null]
            .filter(Boolean).map(([l, a], i) => `<button class="chip" data-q='${esc(JSON.stringify(a))}'>${ui.icon("plus")} ${esc(l)}</button>`).join("");
          if ($("#al-type").value === "metric") paintExtra();
        } catch { metrics = null; }
      };
      $("#al-sym").addEventListener("change", loadMetrics);
      if (pre) loadMetrics();
      const create = (a) => {
        store.alerts.add({ symbol: $("#al-sym").value.trim().toUpperCase(), ...a });
        ui.toast("Alert created", describe(a));
        paint();
        engine.check(); // records the baseline so the first check doesn't fire on old events
      };
      $("#al-quick").addEventListener("click", (e) => { const b = e.target.closest("[data-q]"); if (b) create(JSON.parse(b.dataset.q)); });
      $("#al-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const type = $("#al-type").value, a = { type };
        if ($("#al-val")) a.value = +$("#al-val").value;
        if ($("#al-metric")) { a.metric = $("#al-metric").value; a.op = $("#al-op").value; a.metricLabel = $("#al-metric").selectedOptions[0].textContent.replace(/ \(now.*\)$/, ""); }
        if ($("#al-cat")) a.category = $("#al-cat").value;
        create(a);
      });

      const paint = () => {
        const all = store.alerts.all();
        $("#al-count").textContent = `${all.filter((a) => a.active).length} active`;
        $("#al-list").innerHTML = all.length ? all.map((a) => `<div class="list-row" style="cursor:default;grid-template-columns:minmax(0,1fr) auto auto">
            <span class="nm"><a class="ticker" href="#/research/${encodeURIComponent(a.symbol)}">${esc(a.symbol)}</a> ${esc(describe(a))}
              <span class="muted" style="font-size:11px">${a.last?.checked ? `· checked ${ui.relTime(a.last.checked)}${a.last.state ? " · condition true" : ""}` : "· not checked yet"}</span></span>
            <label class="toggle"><input type="checkbox" data-tog="${a.id}" ${a.active ? "checked" : ""}> on</label>
            <button class="icon-btn" data-del="${a.id}" aria-label="Delete alert">${ui.icon("trash")}</button></div>`).join("")
          : ui.empty("No alerts", "Create one above, or use “Alert” on any research page.", "", "alerts");
        const h = store.alerts.history();
        $("#al-hist").innerHTML = h.length ? h.slice(0, 50).map((x) => `<div class="news-item"><span class="title">${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.message)}</a>` : esc(x.message)}</span>
            <div class="meta"><a class="ticker" href="#/research/${encodeURIComponent(x.symbol)}">${esc(x.symbol)}</a><span class="badge">${esc(TYPES[x.type]?.label || x.type)}</span><span>${ui.relTime(x.at)}</span></div></div>`).join("")
          : '<p class="muted" style="font-size:12.5px">Nothing has triggered yet.</p>';
      };
      $("#al-list").addEventListener("change", (e) => { const t = e.target.closest("[data-tog]"); if (t) { store.alerts.update(t.dataset.tog, { active: t.checked }); paint(); } });
      $("#al-list").addEventListener("click", (e) => { const d = e.target.closest("[data-del]"); if (d) { store.alerts.remove(d.dataset.del); paint(); } });
      $("#al-clear").addEventListener("click", () => { store.set("alert_history", []); paint(); });
      $("#al-check").addEventListener("click", async () => { $("#al-check").disabled = true; await engine.check({ manual: true }); if (ctx.alive()) { $("#al-check").disabled = false; paint(); } });
      const permBtn = $("#al-perm");
      const paintPerm = () => {
        const p = "Notification" in window ? Notification.permission : "unsupported";
        permBtn.innerHTML = `${ui.icon("alerts")} ${p === "granted" ? "Notifications on" : p === "denied" ? "Notifications blocked" : p === "unsupported" ? "Notifications unsupported" : "Enable notifications"}`;
        permBtn.disabled = p !== "default";
      };
      permBtn.addEventListener("click", async () => { try { await Notification.requestPermission(); } catch { /* ignore */ } paintPerm(); });
      paintPerm();
      paint();
      // Repaint when the background engine records checks or triggers; unsubscribed on navigation.
      let pending = null;
      return store.onChange((key) => {
        if (!["alerts", "alert_history"].includes(key) || pending) return;
        pending = setTimeout(() => { pending = null; if (ctx.alive()) paint(); }, 200);
      });
    },
  };
})();
