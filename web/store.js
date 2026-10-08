/* Per-browser storage for the user's own research: watchlists, portfolio, workspace notebooks,
   alerts, saved screens and preferences. There are no accounts, so this lives in localStorage
   (wrapped in try/catch - private browsing may block it). Export/import moves it between devices. */
(function () {
  const PREFIX = "investiq.";

  function get(key, fallback) {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  }
  function set(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
    listeners.forEach((fn) => fn(key));
  }
  const listeners = new Set();
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const now = () => new Date().toISOString();

  /* ---------- watchlists (multiple named lists) ---------- */
  function migrate() {
    // v1 stored a single list under "watchlist" as [{symbol, name}].
    if (get("watchlists", null) === null) {
      const old = get("watchlist", []);
      set("watchlists", [{ id: "default", name: "My watchlist", items: old.map((o) => ({ symbol: o.symbol, name: o.name, added: now() })) }]);
    }
  }
  migrate();

  const watchlists = {
    all: () => get("watchlists", []),
    save: (lists) => set("watchlists", lists),
    get: (id) => watchlists.all().find((l) => l.id === id),
    create(name) {
      const lists = watchlists.all();
      const list = { id: uid(), name: name || "New list", items: [] };
      lists.push(list);
      watchlists.save(lists);
      return list;
    },
    rename(id, name) { watchlists.save(watchlists.all().map((l) => (l.id === id ? { ...l, name } : l))); },
    remove(id) { watchlists.save(watchlists.all().filter((l) => l.id !== id)); },
    has: (symbol) => watchlists.all().some((l) => l.items.some((i) => i.symbol === symbol)),
    add(id, symbol, name) {
      const lists = watchlists.all();
      const l = lists.find((x) => x.id === id) || lists[0];
      if (l && !l.items.some((i) => i.symbol === symbol)) l.items.push({ symbol, name, added: now() });
      watchlists.save(lists);
    },
    removeItem(id, symbol) {
      watchlists.save(watchlists.all().map((l) => (l.id === id ? { ...l, items: l.items.filter((i) => i.symbol !== symbol) } : l)));
    },
    toggle(symbol, name) {
      const lists = watchlists.all();
      if (!lists.length) lists.push({ id: "default", name: "My watchlist", items: [] });
      const inAny = lists.some((l) => l.items.some((i) => i.symbol === symbol));
      lists.forEach((l) => { l.items = l.items.filter((i) => i.symbol !== symbol); });
      if (!inAny) lists[0].items.push({ symbol, name, added: now() });
      watchlists.save(lists);
      return !inAny;
    },
    symbols: () => [...new Set(watchlists.all().flatMap((l) => l.items.map((i) => i.symbol)))],
  };

  /* ---------- portfolio ---------- */
  const portfolio = {
    holdings: () => get("portfolio", []),
    save: (h) => set("portfolio", h),
    upsert(h) {
      const list = portfolio.holdings();
      const i = list.findIndex((x) => x.id === h.id);
      if (i >= 0) list[i] = h; else list.push({ ...h, id: uid() });
      portfolio.save(list);
    },
    remove(id) { portfolio.save(portfolio.holdings().filter((h) => h.id !== id)); },
  };

  /* ---------- research workspace (one notebook per idea) ---------- */
  const workspace = {
    all: () => get("notebooks", []),
    save: (n) => set("notebooks", n),
    get: (id) => workspace.all().find((n) => n.id === id),
    create(symbol, name) {
      const nb = {
        id: uid(), symbol, name: name || symbol, title: `${name || symbol} thesis`, created: now(), updated: now(),
        thesis: "", bull: "", bear: "", risks: "", catalysts: "", notes: "", questions: "",
        assumptions: [], sources: [], ai: [], charts: [], checks: [],
      };
      workspace.save([nb, ...workspace.all()]);
      return nb;
    },
    update(id, patch) {
      workspace.save(workspace.all().map((n) => (n.id === id ? { ...n, ...patch, updated: now() } : n)));
    },
    remove(id) { workspace.save(workspace.all().filter((n) => n.id !== id)); },
    forSymbol: (symbol) => workspace.all().filter((n) => n.symbol === symbol),
    /* Append an AI answer / chart / source to the newest notebook for the symbol (creating one if needed). */
    attach(symbol, name, field, item) {
      let nb = workspace.forSymbol(symbol)[0] || workspace.create(symbol, name);
      nb = workspace.get(nb.id);
      workspace.update(nb.id, { [field]: [...(nb[field] || []), { ...item, saved: now() }] });
      return nb.id;
    },
  };

  /* ---------- alerts ---------- */
  const alerts = {
    all: () => get("alerts", []),
    save: (a) => set("alerts", a),
    add(a) { alerts.save([...alerts.all(), { ...a, id: uid(), created: now(), active: true, last: null }]); },
    update(id, patch) { alerts.save(alerts.all().map((a) => (a.id === id ? { ...a, ...patch } : a))); },
    remove(id) { alerts.save(alerts.all().filter((a) => a.id !== id)); },
    history: () => get("alert_history", []),
    log(entry) { set("alert_history", [{ ...entry, at: now() }, ...alerts.history()].slice(0, 200)); },
  };

  /* ---------- saved screens ---------- */
  const screens = {
    all: () => get("screens", []),
    save(name, filters) {
      const list = screens.all().filter((s) => s.name !== name);
      set("screens", [...list, { id: uid(), name, filters, saved: now() }]);
    },
    remove(id) { set("screens", screens.all().filter((s) => s.id !== id)); },
  };

  /* ---------- recent research ---------- */
  const recent = {
    all: () => get("recent", []),
    add(symbol, name) { set("recent", [{ symbol, name, at: now() }, ...recent.all().filter((r) => r.symbol !== symbol)].slice(0, 12)); },
  };

  /* ---------- export / import ---------- */
  const KEYS = ["watchlists", "portfolio", "portfolio_base", "notebooks", "alerts", "alert_history", "screens", "recent", "ai_history", "chart", "theme"];
  function exportAll() {
    return { app: "InvestIQ", version: 2, exported: now(), data: Object.fromEntries(KEYS.map((k) => [k, get(k, null)])) };
  }
  function importAll(obj) {
    if (!obj || obj.app !== "InvestIQ" || !obj.data) throw new Error("This file is not an InvestIQ export.");
    KEYS.forEach((k) => { if (obj.data[k] !== undefined && obj.data[k] !== null) set(k, obj.data[k]); });
  }

  window.store = { get, set, uid, watchlists, portfolio, workspace, alerts, screens, recent, exportAll, importAll,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
})();
