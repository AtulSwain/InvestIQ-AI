/* Shared UI toolkit: icons, states (loading / empty / error), toasts, sparklines, metric
   rendering with provenance, signal badges, CSV export and a tiny safe markdown renderer. */
window.views = window.views || {}; // page modules in web/views/ register here
(function () {
  const { esc } = fmt;

  /* ---------- icons (16px stroke, currentColor) ---------- */
  const P = {
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    markets: '<path d="M3 17l5-6 4 3 6-8 3 3"/><path d="M3 21h18"/>',
    discover: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    research: '<path d="M4 4h10l6 6v10H4z"/><path d="M14 4v6h6"/><path d="M8 14h8M8 17h5"/>',
    news: '<rect x="3" y="4" width="15" height="16" rx="2"/><path d="M18 8h3v10a2 2 0 0 1-2 2"/><path d="M7 8h7M7 12h7M7 16h4"/>',
    screener: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    compare: '<path d="M8 3v18M16 3v18"/><path d="M3 8h5M16 16h5"/>',
    watchlist: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    portfolio: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>',
    ai: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    workspace: '<path d="M4 20V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14l-4-2-4 2-4-2z"/><path d="M8 8h8M8 12h6"/>',
    reports: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 13v4M12 10v7M15 15v2"/>',
    alerts: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    learn: '<path d="M2 8l10-5 10 5-10 5z"/><path d="M6 10v5c3 2 9 2 12 0v-5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    download: '<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v6H4V6h6"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  };
  const icon = (name, cls = "") =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ""}</svg>`;

  /* ---------- states ---------- */
  const skeleton = (lines = 3, block = true) =>
    `<div class="card" aria-busy="true">${'<span class="skeleton sk-line" style="width:40%"></span>'}${Array.from({ length: lines }, (_, i) =>
      `<span class="skeleton sk-line" style="width:${90 - i * 12}%"></span>`).join("")}${block ? '<span class="skeleton sk-block"></span>' : ""}</div>`;
  const skeletonGrid = (n = 4) => `<div class="grid grid-${Math.min(n, 4)}">${Array.from({ length: n }, () => skeleton(2, false)).join("")}</div>`;
  const loading = (msg) => `<div class="loading"><div class="spinner"></div>${esc(msg || "Loading…")}</div>`;
  const empty = (title, text, action = "", ico = "info") =>
    `<div class="empty">${icon(ico)}<h3>${esc(title)}</h3><p class="muted">${text}</p>${action}</div>`;
  const errorBox = (err, retry) =>
    `<div class="card error"><h2 style="justify-content:center">Couldn't load this</h2><p>${esc(err && err.message ? err.message : err)}</p>
      ${retry ? `<button class="btn" data-retry>${icon("refresh")} Try again</button>` : ""}</div>`;

  /* ---------- toasts ---------- */
  function toast(title, body = "", timeout = 5000) {
    const box = document.getElementById("toasts");
    if (!box) return;
    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `<strong>${esc(title)}</strong>${body ? `<span class="muted">${esc(body)}</span>` : ""}`;
    box.appendChild(el);
    setTimeout(() => el.remove(), timeout);
  }

  /* ---------- sparkline (inline SVG, no chart instance) ---------- */
  function sparkline(values, { up = null, height = 34 } = {}) {
    const v = (values || []).filter((x) => x != null);
    if (v.length < 2) return "";
    const min = Math.min(...v), max = Math.max(...v);
    const w = 120, h = height, pad = 2;
    const pts = v.map((y, i) => `${(i / (v.length - 1)) * w},${h - pad - ((y - min) / (max - min || 1)) * (h - pad * 2)}`).join(" ");
    const rising = up == null ? v[v.length - 1] >= v[0] : up;
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${pts}" fill="none" stroke="var(${rising ? "--up-text" : "--down-text"})" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
  }

  /* ---------- values ---------- */
  const chg = (v, digits = 2) => (v == null ? '<span class="muted">—</span>'
    : `<span class="${v >= 0 ? "up" : "down"}">${v >= 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(digits)}%</span>`);
  const SIG_LABEL = { good: "Good", ok: "Okay", weak: "Weak" };
  const sig = (s) => (s ? `<span class="sig ${s}" title="${SIG_LABEL[s]} by InvestIQ's thresholds">${SIG_LABEL[s]}</span>` : "");

  function fmtUnit(value, unit, currency) {
    if (value == null) return "—";
    switch (unit) {
      case "pct": return fmt.pct(value, 1, false);
      case "x": return fmt.n(value, 1) + "×";
      case "money": return fmt.money(value, currency);
      case "big": return fmt.big(value, currency);
      case "bool": return value ? "Yes" : "No";
      case "score": return fmt.n(value, 1);
      default: return fmt.n(value, 2);
    }
  }

  const STATUS = { actual: "Reported", estimate: "Estimate", derived: "Calculated" };
  /* Provenance text for a registry metric: source · period · currency · status · as-of / fetched. */
  function provText(m, report) {
    if (!m) return "";
    const s = (report.sources || []).find((x) => x.id === m.source) || {};
    const when = s.as_of ? `as of ${s.as_of}` : s.fetched_at ? `fetched ${s.fetched_at.replace("T", " ").slice(0, 16)} UTC` : "";
    return [s.provider_label || "InvestIQ", m.period, m.currency, STATUS[m.status] || m.status, when].filter(Boolean).join(" · ");
  }

  /* A metric cell: label (with glossary tooltip), value, signal badge and provenance on hover/focus. */
  function metricStat(report, key, labelOverride) {
    const m = (report.metrics || {})[key];
    if (!m) return "";
    const prov = provText(m, report);
    return `<div class="stat"><div class="label">${glossary.T(labelOverride || m.label)}</div>
      <div class="value"><span class="metric" tabindex="0" title="${esc(prov)}">${fmtUnit(m.value, m.unit, m.currency)}</span> ${sig(m.signal)}</div>
      <div class="meta" title="${esc(prov)}">${esc(m.status === "actual" ? (m.period || "") : STATUS[m.status])}</div></div>`;
  }

  /* ---------- CSV ---------- */
  function downloadCSV(filename, rows, columns) {
    const cols = columns || Object.keys(rows[0] || {});
    const cell = (v) => {
      if (v == null) return "";
      const s = typeof v === "object" ? JSON.stringify(v) : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.map((c) => cell(c.label || c)).join(","), ...rows.map((r) => cols.map((c) => cell(typeof c === "object" ? c.get(r) : r[c])).join(","))].join("\n");
    download(filename, csv, "text/csv");
  }
  function download(filename, text, type = "application/json") {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------- markdown (escaped first; supports ##, ###, -, *, 1., **bold**, `code`) ---------- */
  function markdown(src) {
    const lines = esc(src).split("\n");
    let html = "", list = null, para = [];
    const flushPara = () => { if (para.length) { html += `<p>${para.join(" ")}</p>`; para = []; } };
    const flushList = () => { if (list) { html += `</${list}>`; list = null; } };
    const inline = (t) => t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
    for (const raw of lines) {
      const line = raw.trimEnd();
      let m;
      if ((m = line.match(/^#{1,3}\s+(.*)/))) { flushPara(); flushList(); html += `<h3>${inline(m[1])}</h3>`; }
      else if ((m = line.match(/^\s*[-*]\s+(.*)/))) { flushPara(); if (list !== "ul") { flushList(); html += "<ul>"; list = "ul"; } html += `<li>${inline(m[1])}</li>`; }
      else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { flushPara(); if (list !== "ol") { flushList(); html += "<ol>"; list = "ol"; } html += `<li>${inline(m[1])}</li>`; }
      else if (!line.trim()) { flushPara(); flushList(); }
      else if (list) { html = html.replace(/<\/li>$/, ` ${inline(line.trim())}</li>`); }
      else { para.push(inline(line)); }
    }
    flushPara(); flushList();
    return html;
  }

  /* AI answer: blocks [{text, cites}] -> markdown with numbered citation links + a source list. */
  function aiAnswer(res, idPrefix = "ai") {
    if (!res) return "";
    const TOKEN = (n) => `\u0001${n}\u0002`;
    const md = (res.blocks || []).map((b) => b.text + (b.cites || []).map(TOKEN).join("")).join("");
    const body = markdown(md).replace(/\u0001(\d+)\u0002/g, (_, n) => `<a class="cite" href="#${idPrefix}-src-${n}" title="Source ${n}">${n}</a>`);
    const srcs = (res.sources || []).map((s) => `<li id="${idPrefix}-src-${s.n}"><span class="n">[${s.n}]</span><span>
        ${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>` : esc(s.title)}
        <span class="muted"> · ${esc(s.provider || "")}${s.as_of ? " · " + esc(String(s.as_of).slice(0, 10)) : ""}</span>
        ${(s.quotes || []).slice(0, 1).map((q) => `<q>${esc(q)}</q>`).join("")}</span></li>`).join("");
    return `<div class="ai-answer">${body}</div>
      ${res.truncated ? '<p class="callout">The answer hit the length limit and may be cut short.</p>' : ""}
      ${srcs ? `<h3>Sources</h3><ol class="sources-list">${srcs}</ol>` : '<p class="muted" style="font-size:12px">No sources were cited for this answer - treat it with extra caution.</p>'}
      <p class="prov">${esc(res.model || "")} · ${res.generated_at ? esc(res.generated_at.replace("T", " ").slice(0, 16)) + " UTC" : ""}${res.cached ? " · cached" : ""}${res.web_search ? " · web search on" : ""}</p>`;
  }

  /* ---------- misc ---------- */
  const go = (hash) => { location.hash = hash; };
  const stockLink = (sym, label) => `<a href="#/research/${encodeURIComponent(sym)}" class="ticker">${esc(label || sym)}</a>`;
  function relTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const s = (Date.now() - d.getTime()) / 1000;
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }
  const CAT_LABEL = { earnings: "Earnings", "m&a": "M&A", regulatory: "Regulatory", lawsuit: "Legal", insider: "Insider",
    analyst: "Analyst", product: "Product", corporate: "Corporate", macro: "Macro", general: "General" };
  function newsItem(n, { showSymbol = false } = {}) {
    const move = n.price_move ? ` · <span class="${n.price_move.change_pct >= 0 ? "up" : "down"}">stock ${n.price_move.change_pct >= 0 ? "+" : ""}${n.price_move.change_pct}% that day</span>` : "";
    return `<div class="news-item">
      ${n.url ? `<a class="title" href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>` : `<span class="title">${esc(n.title)}</span>`}
      <div class="meta">${showSymbol && n.symbol ? stockLink(n.symbol) + " ·" : ""}<span class="badge">${esc(CAT_LABEL[n.category] || n.category || "News")}</span>
        <span>${esc(n.publisher || "")}</span><span>${relTime(n.published_at)}</span>${move}</div>
      ${n.summary && n.summary !== n.title ? `<p class="summary">${esc(n.summary.slice(0, 220))}${n.summary.length > 220 ? "…" : ""}</p>` : ""}
    </div>`;
  }


  /* Background tint for a % change (heat maps): green/red, stronger with magnitude. */
  const heatBg = (v, scale = 3) => (v == null ? "" :
    `background:color-mix(in srgb, var(${v >= 0 ? "--up-text" : "--down-text"}) ${Math.round(Math.min(Math.abs(v) / scale, 1) * 34) + 4}%, var(--surface-1))`);

  /* One-line provenance for a dataset-level source record. */
  function srcNote(src, extra = "") {
    if (!src) return "";
    const when = src.fetched_at ? `updated ${relTime(src.fetched_at)}` : "";
    return `<p class="prov">${esc([src.provider_label || src.provider, src.delayed, when, extra].filter(Boolean).join(" · "))}</p>`;
  }

  /* Ticker tile for an instrument row from the market overview. */
  function tick(t) {
    const digits = Math.abs(t.last) >= 1000 ? 0 : 2;
    return `<div class="tick" title="${esc(t.name)} · as of ${esc(t.as_of || "")}">
      <div class="name"><span>${esc(t.name)}</span><span>${esc(t.region || "")}</span></div>
      <div class="last">${t.last == null ? "—" : fmt.n(t.last, digits)}</div>
      <div class="chg">${chg(t.change_pct)}</div>${sparkline(t.spark, { height: 26 })}</div>`;
  }

  /* Tabs: [[id, label]] -> buttons; onChange(id) on click. Returns html; call bindTabs after insert. */
  const tabs = (items, active, attr = "tab") =>
    `<div class="tabs" role="tablist">${items.map(([id, label]) => `<button type="button" class="tab${id === active ? " on" : ""}" role="tab" aria-selected="${id === active}" data-${attr}="${esc(id)}">${esc(label)}</button>`).join("")}</div>`;
  const seg = (items, active, attr = "seg") =>
    `<div class="seg">${items.map(([id, label]) => `<button type="button" class="${id === active ? "on" : ""}" data-${attr}="${esc(id)}">${esc(label)}</button>`).join("")}</div>`;
  function bindChoice(root, attr, fn) {
    root.addEventListener("click", (e) => {
      const b = e.target.closest(`[data-${attr}]`);
      if (!b || !root.contains(b)) return;
      b.parentElement.querySelectorAll(`[data-${attr}]`).forEach((x) => { x.classList.toggle("on", x === b); if (x.getAttribute("role") === "tab") x.setAttribute("aria-selected", x === b); });
      fn(b.dataset[attr.replace(/-([a-z])/g, (_, c) => c.toUpperCase())]);
    });
  }


  /* Load into a container: skeleton -> paint(value) or error with retry. Ignores results after navigation. */
  async function fill(el, load, paint, ctx, { lines = 3 } = {}) {
    if (!el) return;
    el.innerHTML = skeleton(lines, false);
    try {
      const v = await load();
      if (ctx && !ctx.alive()) return;
      el.innerHTML = paint(v);
      return v;
    } catch (err) {
      if (ctx && !ctx.alive()) return;
      el.innerHTML = errorBox(err, true);
      el.querySelector("[data-retry]")?.addEventListener("click", () => fill(el, load, paint, ctx, { lines }));
    }
  }

  window.ui = { fill, heatBg, srcNote, tick, tabs, seg, bindChoice, icon, skeleton, skeletonGrid, loading, empty, errorBox, toast, sparkline, chg, sig, fmtUnit, provText,
    metricStat, downloadCSV, download, markdown, aiAnswer, go, stockLink, relTime, newsItem, CAT_LABEL };
})();
