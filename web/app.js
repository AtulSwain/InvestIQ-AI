/* InvestIQ research terminal: shell, navigation, routing, command palette, shortcuts.
   Each page lives in web/views/<name>.js and registers itself on window.views:
     views.<name> = { title, render(el, arg, ctx) -> optional cleanup() }                     */
(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const { esc } = fmt;
  const data = window.investiqData;
  const app = $("#app");
  window.views = window.views || {};

  /* ---------------- navigation model (Discover → Research → Monitor → Thesis) ---------------- */
  const NAV = [
    { group: "Discover", items: [
      ["dashboard", "Dashboard", "#/", "dashboard", "g d"],
      ["markets", "Markets", "#/markets", "markets", "g m"],
      ["discover", "Discover", "#/discover", "discover", "g v"],
      ["screener", "Screener", "#/screener", "screener", "g s"],
    ] },
    { group: "Research", items: [
      ["research", "Research", "#/research", "research", "g r"],
      ["news", "News", "#/news", "news", "g n"],
      ["compare", "Compare", "#/compare", "compare", "g c"],
      ["ai", "AI Research", "#/ai", "ai", "g a"],
    ] },
    { group: "Monitor", items: [
      ["watchlist", "Watchlist", "#/watchlist", "watchlist", "g w"],
      ["portfolio", "Portfolio", "#/portfolio", "portfolio", "g p"],
      ["alerts", "Alerts", "#/alerts", "alerts", "g l"],
    ] },
    { group: "Build thesis", items: [
      ["workspace", "Research Workspace", "#/workspace", "workspace", "g e"],
      ["reports", "Reports", "#/reports", "reports", "g o"],
      ["learn", "Learn & glossary", "#/learn", "learn", "g h"],
      ["sources", "Data sources", "#/sources", "database", "g u"],
    ] },
  ];
  const FLAT = NAV.flatMap((g) => g.items);

  $("#nav").innerHTML = NAV.map((g) => `<div class="nav-group"><div class="nav-group-label">${g.group}</div>
    ${g.items.map(([id, label, href, ico]) => `<a class="nav-link" href="${href}" data-nav="${id}">${ui.icon(ico)}<span>${label}</span></a>`).join("")}</div>`).join("");
  $("#menu-btn").innerHTML = ui.icon("menu");
  $(".ico-search").outerHTML = ui.icon("search");

  /* Footer: every source InvestIQ draws on, with its logo. */
  $("#footer-sources").innerHTML = ["nse", "bse", "nasdaq", "nyse", "yahoo", "alpaca", "finnhub", "twelvedata", "fmp", "alphavantage", "sec", "anthropic"]
    .map((id) => brands.chip(id, { size: 14 })).join("");

  /* ---------------- theme ---------------- */
  const paintThemeBtn = () => { $("#theme-toggle").innerHTML = ui.icon(document.documentElement.dataset.theme === "light" ? "moon" : "sun"); };
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    store.set("theme", next);
    paintThemeBtn();
    route(); // charts read colours at draw time
  }
  $("#theme-toggle").addEventListener("click", toggleTheme);
  paintThemeBtn();

  /* ---------------- mobile sidebar ---------------- */
  const sidebar = $("#sidebar");
  let scrim = null;
  function closeSidebar() { sidebar.classList.remove("open"); scrim?.remove(); scrim = null; }
  $("#menu-btn").addEventListener("click", () => {
    sidebar.classList.add("open");
    scrim = Object.assign(document.createElement("div"), { className: "scrim" });
    scrim.addEventListener("click", closeSidebar);
    document.body.appendChild(scrim);
  });

  /* ---------------- data status ---------------- */
  async function paintStatus() {
    const pill = $("#status-pill");
    const set = (cls, text, title) => { pill.innerHTML = `<span class="dot ${cls}"></span><span class="txt">${esc(text)}</span>`; pill.title = title; };
    try {
      const h = await data.health();
      $("#demo-banner").hidden = !h.demo;
      if (!h.static) { set("live", "Live data", "Connected to the InvestIQ server"); return; }
      const snap = `Snapshot ${fmt.date(h.generated_at)}`;
      if (!data.hasLive) {
        set("snap", snap, `Daily snapshot of ${h.count} stocks. Run InvestIQ locally or connect a hosted server for live data.`);
        $("#static-banner").hidden = false;
        $("#static-banner").textContent = `Daily snapshot of ${h.count} stocks (${fmt.date(h.generated_at)}). Live data, AI research and any-stock search need the InvestIQ server.`;
        return;
      }
      set("snap", "Connecting to live server…", "Waking up the live server (free hosting sleeps when idle)");
      const live = await data.liveHealth();
      if (live) set("live", "Live data", "Live server connected; snapshot used as instant fallback");
      else set("snap", snap, "Live server not responding - showing the daily snapshot");
    } catch {
      set("", "Offline", "Could not reach any data source");
    }
  }
  paintStatus();

  /* ---------------- router ---------------- */
  let cleanup = null;
  let token = 0;
  const ALIASES = { "": "dashboard", stock: "research" };

  function parse() {
    const raw = location.hash.replace(/^#\/?/, "");
    const [head, ...rest] = raw.split("/");
    const view = ALIASES[head] ?? head;
    return { view, arg: rest.map(decodeURIComponent).join("/") };
  }

  function route() {
    const { view, arg } = parse();
    const v = window.views[view] || window.views.dashboard;
    const name = window.views[view] ? view : "dashboard";
    document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === name));
    if (typeof cleanup === "function") { try { cleanup(); } catch { /* ignore */ } }
    cleanup = null;
    charts.destroyAll();
    closeSidebar();
    const myToken = ++token;
    const ctx = {
      token: myToken,
      alive: () => myToken === token, // false once the user navigated away
      setTitle: (t) => { document.title = t ? `${t} · InvestIQ` : "InvestIQ · Research Terminal"; },
      route,
    };
    ctx.setTitle(v.title || "");
    app.innerHTML = "";
    try {
      const res = v.render(app, arg, ctx);
      if (res && typeof res.then === "function") res.then((c) => { if (ctx.alive()) cleanup = c; }).catch((err) => { if (ctx.alive()) app.innerHTML = ui.errorBox(err); });
      else cleanup = res;
    } catch (err) {
      app.innerHTML = ui.errorBox(err);
      console.error(err);
    }
  }
  window.addEventListener("hashchange", () => { window.scrollTo(0, 0); route(); });
  window.router = { route, go: ui.go };

  /* ---------------- command palette (Ctrl/⌘+K, /) ---------------- */
  let palette = null;
  function openPalette(initial = "") {
    if (palette) return;
    const back = document.createElement("div");
    back.className = "palette-backdrop";
    back.innerHTML = `<div class="palette" role="dialog" aria-label="Command palette">
      <input type="text" placeholder="Search a stock (e.g. Reliance, TCS, AAPL) or type a page / action…" aria-label="Search" autocomplete="off">
      <ul role="listbox"></ul>
      <div class="palette-foot"><span><span class="kbd">↑↓</span> move</span><span><span class="kbd">Enter</span> open</span><span><span class="kbd">Esc</span> close</span><span style="margin-left:auto"><span class="kbd">?</span> shortcuts</span></div></div>`;
    document.body.appendChild(back);
    palette = back;
    const input = back.querySelector("input");
    const list = back.querySelector("ul");
    let items = [];
    let active = 0;
    let timer;

    const ACTIONS = [
      ["Toggle light / dark theme", () => toggleTheme()],
      ["New research notebook", () => ui.go("#/workspace/new")],
      ["Ask the AI research assistant", () => ui.go("#/ai")],
      ["Export my InvestIQ data (watchlists, portfolio, notes)", () => ui.download(`investiq-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store.exportAll(), null, 2))],
      ["Keyboard shortcuts", () => showShortcuts()],
    ];

    function paint() {
      let html = "", lastGroup = "";
      items.forEach((it, i) => {
        if (it.group !== lastGroup) { html += `<li class="group" role="presentation">${esc(it.group)}</li>`; lastGroup = it.group; }
        html += `<li role="option" data-i="${i}" aria-selected="${i === active}">${it.html}<span class="kind">${esc(it.kind || "")}</span></li>`;
      });
      list.innerHTML = html || `<li class="group">No matches</li>`;
      list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    }
    async function compute() {
      const q = input.value.trim().toLowerCase();
      const pages = FLAT.filter(([, label]) => !q || label.toLowerCase().includes(q))
        .map(([id, label, href, ico, keys]) => ({ group: "Pages", html: `${ui.icon(ico)} ${esc(label)}`, kind: keys, run: () => ui.go(href) }));
      const actions = ACTIONS.filter(([label]) => !q || label.toLowerCase().includes(q))
        .map(([label, run]) => ({ group: "Actions", html: esc(label), run }));
      let stocks = [];
      if (q) {
        try { stocks = await data.search(q); } catch { stocks = []; }
        stocks = stocks.slice(0, 8).map((s) => ({ group: "Stocks", html: `${(() => { const b = brands.forExchange(s.exchange, s.symbol); return b ? brands.logo(b, { size: 14 }) + " " : ""; })()}<span class="ticker">${esc(s.symbol)}</span> <span class="muted">${esc(s.name)}</span>`, kind: s.exchange, run: () => ui.go(`#/research/${encodeURIComponent(s.symbol)}`) }));
        // Always offer a direct lookup for whatever was typed.
        stocks.push({ group: "Stocks", html: `Research “${esc(input.value.trim())}”`, kind: "lookup", run: () => ui.go(`#/research/${encodeURIComponent(input.value.trim())}`) });
      } else {
        const recent = store.recent.all().slice(0, 5).map((r) => ({ group: "Recent", html: `<span class="ticker">${esc(r.symbol)}</span> <span class="muted">${esc(r.name || "")}</span>`, run: () => ui.go(`#/research/${encodeURIComponent(r.symbol)}`) }));
        stocks = recent;
      }
      items = q ? [...stocks, ...pages, ...actions] : [...stocks, ...pages, ...actions];
      active = 0;
      paint();
    }
    function close() { back.remove(); palette = null; }
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(compute, 150); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { active = Math.min(active + 1, items.length - 1); paint(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { active = Math.max(active - 1, 0); paint(); e.preventDefault(); }
      else if (e.key === "Enter") { const it = items[active]; close(); it?.run(); e.preventDefault(); }
      else if (e.key === "Escape") { close(); }
    });
    list.addEventListener("mousedown", (e) => {
      const li = e.target.closest("li[data-i]");
      if (!li) return;
      const it = items[+li.dataset.i];
      close();
      it?.run();
    });
    back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
    input.value = initial;
    input.focus();
    compute();
  }
  $("#search-trigger").addEventListener("click", () => openPalette());

  function showShortcuts() {
    const back = document.createElement("div");
    back.className = "palette-backdrop";
    back.innerHTML = `<div class="modal" role="dialog" aria-label="Keyboard shortcuts"><div class="card-head"><h2>Keyboard shortcuts</h2><button class="icon-btn" data-close aria-label="Close">${ui.icon("x")}</button></div>
      <table><tbody>
        <tr><td><span class="kbd">Ctrl</span> <span class="kbd">K</span> or <span class="kbd">/</span></td><td class="l">Search stocks, pages and actions</td></tr>
        ${FLAT.map(([, label, , , keys]) => `<tr><td>${keys.split(" ").map((k) => `<span class="kbd">${k}</span>`).join(" then ")}</td><td class="l">${esc(label)}</td></tr>`).join("")}
        <tr><td><span class="kbd">t</span></td><td class="l">Toggle theme</td></tr>
        <tr><td><span class="kbd">?</span></td><td class="l">This help</td></tr>
      </tbody></table></div>`;
    document.body.appendChild(back);
    const close = () => back.remove();
    back.addEventListener("mousedown", (e) => { if (e.target === back || e.target.closest("[data-close]")) close(); });
    document.addEventListener("keydown", function esc1(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc1); } });
  }

  let pendingG = 0;
  document.addEventListener("keydown", (e) => {
    const typing = e.target.closest?.("input, textarea, select, [contenteditable]");
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey || palette) return;
    if (e.key === "/") { e.preventDefault(); openPalette(); return; }
    if (e.key === "?") { showShortcuts(); return; }
    if (e.key === "t") { toggleTheme(); return; }
    if (e.key === "g") { pendingG = Date.now(); return; }
    if (pendingG && Date.now() - pendingG < 1200) {
      const hit = FLAT.find(([, , , , keys]) => keys === `g ${e.key}`);
      pendingG = 0;
      if (hit) ui.go(hit[2]);
    }
  });

  /* Generic "open stock" for any element with data-open="SYMBOL". */
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-open]");
    if (el && !e.target.closest("a, button:not([data-open]), input, .tip")) ui.go(`#/research/${encodeURIComponent(el.dataset.open)}`);
  });

  route();
  // Smart alerts are checked in the background on every page (see views/alerts.js).
  window.views.alerts?.engine?.start();
})();
