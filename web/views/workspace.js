/* Research workspace: one notebook per investment idea - thesis, bull/bear case, risks,
   catalysts, questions, notes, saved AI answers and sources - plus the Investment Thesis Tracker:
   measurable assumptions checked against the latest data and new developments (conflict detection).
   #/workspace · #/workspace/new[/SYM] · #/workspace/<id> */
(function () {
  const { esc } = fmt;
  const data = window.investiqData;

  const FIELDS = [["thesis", "Investment thesis", "Why will this be a good investment? What does the market miss?"],
    ["bull", "Bull case", "What goes right, and what is it worth then?"], ["bear", "Bear case", "What goes wrong, and how much could you lose?"],
    ["risks", "Key risks", "Business, financial, regulatory, management…"], ["catalysts", "Catalysts", "Events that could make the market re-price the stock, with dates."],
    ["questions", "Open questions", "What do you still need to find out?"], ["notes", "Notes", "Anything else - meeting notes, channel checks, ideas."]];
  const STATUS_TEXT = { intact: "Thesis intact", review: "Needs review", conflict: "Conflict" };
  const QUICK = [["revenue_cagr_pct", ">=", 10], ["roe_pct", ">=", 15], ["debt_to_equity", "<=", 1], ["pe", "<=", 30], ["margin_of_safety_pct", ">=", 0], ["piotroski", ">=", 6]];

  function list(el) {
    const nbs = store.workspace.all();
    el.innerHTML = `<div class="page-head"><div><div class="crumbs">Build thesis</div><h1>Research workspace</h1><p class="sub muted">One notebook per idea. Track a thesis with measurable assumptions and get warned when the data disagrees.</p></div>
        <form id="ws-new" class="row" autocomplete="off"><input id="ws-sym" placeholder="Stock for a new notebook, e.g. TCS.NS" style="min-width:220px" required><button class="btn primary" type="submit">${ui.icon("plus")} New notebook</button></form></div>
      ${nbs.length ? `<div class="grid grid-3">${nbs.map((n) => {
        const last = (n.checks || []).at(-1);
        return `<a class="note-card" href="#/workspace/${n.id}" style="display:block;text-decoration:none;color:inherit">
          <div class="card-head" style="margin-bottom:4px"><strong>${esc(n.title)}</strong>${last ? `<span class="status-tag ${last.status}">${STATUS_TEXT[last.status]}</span>` : '<span class="status-tag">Not checked</span>'}</div>
          <div class="muted" style="font-size:12px"><span class="ticker">${esc(n.symbol)}</span> · updated ${ui.relTime(n.updated)} · ${(n.assumptions || []).length} assumptions · ${(n.ai || []).length} AI notes</div>
          <p style="font-size:12.5px;margin:6px 0 0;color:var(--text-secondary)">${esc((n.thesis || "No thesis written yet.").slice(0, 160))}</p></a>`;
      }).join("")}</div>` : `<div class="card">${ui.empty("No notebooks yet", "Start one for a stock you are researching, or use “Notebook” on any research page.", "", "workspace")}</div>`}
      <p class="disclaimer">Notebooks are stored in this browser only. Export them from the command palette (Ctrl K → Export).</p>`;
    el.querySelector("#ws-new").addEventListener("submit", (e) => {
      e.preventDefault();
      const s = el.querySelector("#ws-sym").value.trim().toUpperCase();
      if (s) ui.go(`#/workspace/${store.workspace.create(s, s).id}`);
    });
  }

  function checkHtml(c) {
    if (!c) return '<p class="muted" style="font-size:12.5px">Not checked yet. Add assumptions, then run a check.</p>';
    return `<div class="card-head" style="margin:4px 0"><span class="status-tag ${c.status}">${STATUS_TEXT[c.status]}</span><span class="muted" style="font-size:12px">checked ${ui.relTime(c.saved || c.checked_at)}${c.snapshot ? " · snapshot data" : ""}</span></div>
      <p style="font-size:13px;margin:4px 0 8px">${esc(c.headline)}</p>
      ${(c.assumptions || []).length ? `<div class="table-wrap"><table class="compact"><thead><tr><th class="l">Assumption</th><th>Rule</th><th>Now</th><th>Status</th><th class="l">Period</th></tr></thead><tbody>
        ${c.assumptions.map((a) => `<tr><td class="l">${esc(a.label || a.metric)}</td><td>${esc(a.op)} ${esc(a.value)}</td><td>${a.current == null ? "—" : fmt.n(a.current, 2)}</td>
          <td><span class="badge ${a.status === "holds" ? "good" : a.status === "broken" ? "bad" : ""}">${esc(a.status)}</span></td><td class="l muted">${esc(a.period || "")}</td></tr>`).join("")}</tbody></table></div>` : ""}
      ${(c.developments || []).length ? `<h3>New developments since the thesis</h3>${c.developments.map((d) => `<div class="insight"><span class="ico">${d.severity === "review" ? "!" : "·"}</span><div><strong>${fmt.date(d.date)}</strong> <span class="badge">${esc(d.type)}</span> ${d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.detail)}</a>` : esc(d.detail)}</div></div>`).join("")}` : ""}
      ${c.method ? `<p class="prov">${esc(c.method)}</p>` : ""}`;
  }

  function editor(el, nb, ctx) {
    ctx.setTitle(nb.title);
    el.innerHTML = `<div><div class="page-head"><div><div class="crumbs"><a href="#/workspace">Workspace</a> / <a href="#/research/${encodeURIComponent(nb.symbol)}" class="ticker">${esc(nb.symbol)}</a></div>
        <input id="nb-title" value="${esc(nb.title)}" aria-label="Notebook title" style="font-size:20px;font-weight:600;background:transparent;border:0;padding:0;color:var(--text-primary);min-width:280px">
        <p class="sub muted">Created ${fmt.date(nb.created.slice(0, 10))} · <span id="nb-saved">saved</span></p></div>
        <div class="row"><a class="btn" href="#/research/${encodeURIComponent(nb.symbol)}">${ui.icon("research")} Research</a><a class="btn" href="#/reports/${encodeURIComponent(nb.symbol)}/nb:${nb.id}">${ui.icon("reports")} Report</a>
          <button class="btn" id="nb-md">${ui.icon("download")} Markdown</button><button class="btn danger" id="nb-del">${ui.icon("trash")}</button></div></div>
      <div class="grid grid-3">
        <div class="span-2">${FIELDS.map(([k, label, ph]) => `<div class="card section"><h2>${label}</h2><textarea data-field="${k}" rows="${k === "thesis" || k === "notes" ? 5 : 3}" placeholder="${esc(ph)}" style="width:100%">${esc(nb[k] || "")}</textarea></div>`).join("")}
          <div class="card section"><h2>Saved AI research</h2><div id="nb-ai"></div></div>
          <div class="card section"><h2>Sources & links</h2><div id="nb-src"></div>
            <form id="nb-srcf" class="filters" style="margin-top:8px"><input id="nb-src-t" placeholder="Title" style="flex:1;min-width:140px"><input id="nb-src-u" type="url" placeholder="https://…" style="flex:2;min-width:180px"><button class="btn sm" type="submit">Add</button></form></div></div>
        <div>
          <div class="card section"><div class="card-head"><h2>Thesis tracker</h2><button class="btn sm primary" id="nb-check">Check now</button></div>
            <p class="muted" style="font-size:12px;margin-top:0">Measurable assumptions your thesis depends on. A check compares them with the latest data and scans news, downgrades, insider sales, earnings misses and big falls since ${fmt.date(nb.created.slice(0, 10))}.</p>
            <div id="nb-assum"></div>
            <form id="nb-af" class="filters" style="margin-top:8px"><select id="nb-am" style="flex:1;min-width:120px" aria-label="Metric"></select><select id="nb-ao" aria-label="Operator">${[">=", "<=", ">", "<"].map((o) => `<option>${o}</option>`).join("")}</select>
              <input id="nb-av" type="number" step="any" placeholder="Value" style="width:80px" required><button class="btn sm" type="submit">Add</button></form>
            <div class="chips" style="margin-top:6px">${QUICK.map(([k, o, v], i) => `<button class="chip" data-quick="${i}" style="font-size:11px">${esc(k.replace(/_pct$/, "").replace(/_/g, " "))} ${o} ${v}</button>`).join("")}</div>
            <div id="nb-result" style="margin-top:10px"></div></div>
          <div class="card section"><h2>Check history</h2><div id="nb-hist"></div></div>
        </div>
      </div>
      <p class="disclaimer">Your notes, stored in this browser. Research tool, not investment advice.</p></div>`;
    const root = el.firstElementChild; // page-owned node: listeners must not pile up on the persistent #app
    const $ = (s) => root.querySelector(s);
    const get = () => store.workspace.get(nb.id);
    let t;
    const save = (patch) => { store.workspace.update(nb.id, patch); $("#nb-saved").textContent = "saved " + new Date().toLocaleTimeString(); };
    root.addEventListener("input", (e) => {
      const f = e.target.dataset.field;
      if (f || e.target.id === "nb-title") {
        $("#nb-saved").textContent = "saving…";
        clearTimeout(t);
        t = setTimeout(() => save(f ? { [f]: e.target.value } : { title: e.target.value }), 400);
      }
    });

    let report = null;
    const metricLabel = (k) => report?.metrics?.[k]?.label || k;
    const paintAssum = () => {
      const as = get().assumptions || [];
      $("#nb-assum").innerHTML = as.length ? as.map((a, i) => {
        const cur = report?.metrics?.[a.metric]?.value;
        return `<div class="list-row" style="cursor:default"><span class="nm">${esc(metricLabel(a.metric))} ${esc(a.op)} ${esc(a.value)}</span><span class="muted num">${cur == null ? "" : "now " + fmt.n(cur, 2)}</span>
          <button class="icon-btn" data-arm="${i}" aria-label="Remove assumption">${ui.icon("x")}</button></div>`;
      }).join("") : '<p class="muted" style="font-size:12.5px">No assumptions yet.</p>';
    };
    $("#nb-assum").addEventListener("click", (e) => { const b = e.target.closest("[data-arm]"); if (b) { const as = [...get().assumptions]; as.splice(+b.dataset.arm, 1); save({ assumptions: as }); paintAssum(); } });
    const addAssum = (metric, op, value) => { save({ assumptions: [...(get().assumptions || []), { metric, op, value: +value }] }); paintAssum(); };
    $("#nb-af").addEventListener("submit", (e) => { e.preventDefault(); addAssum($("#nb-am").value, $("#nb-ao").value, $("#nb-av").value); $("#nb-av").value = ""; });
    root.querySelectorAll("[data-quick]").forEach((b) => b.addEventListener("click", () => { const [k, o, v] = QUICK[+b.dataset.quick]; addAssum(k, o, v); }));
    const metricOpts = (keys) => { $("#nb-am").innerHTML = keys.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join(""); };
    metricOpts(QUICK.map(([k]) => [k, k]));

    const paintHist = () => {
      const cs = get().checks || [];
      $("#nb-hist").innerHTML = cs.length ? [...cs].reverse().slice(0, 10).map((c) => `<div class="list-row" style="cursor:default"><span class="nm"><span class="status-tag ${c.status}">${STATUS_TEXT[c.status]}</span></span><span></span><span class="muted">${ui.relTime(c.saved)}</span></div>`).join("") : '<p class="muted" style="font-size:12.5px">No checks yet.</p>';
      $("#nb-result").innerHTML = checkHtml(cs.at(-1));
    };
    $("#nb-check").addEventListener("click", async () => {
      const as = get().assumptions || [];
      $("#nb-result").innerHTML = ui.loading("Checking against the latest data…");
      try {
        const res = await data.thesis(nb.symbol, as, nb.created.slice(0, 10));
        if (!ctx.alive()) return;
        const entry = { ...res, saved: new Date().toISOString() };
        save({ checks: [...(get().checks || []), entry].slice(-30) });
        paintHist();
        if (res.status !== "intact") ui.toast(STATUS_TEXT[res.status], res.headline, 8000);
      } catch (err) { if (ctx.alive()) $("#nb-result").innerHTML = ui.errorBox(err); }
    });

    const paintAI = () => {
      const ai = get().ai || [];
      $("#nb-ai").innerHTML = ai.length ? ai.map((a, i) => `<details class="note-card" style="margin-bottom:8px;cursor:default"><summary style="cursor:pointer"><strong>${esc(a.question)}</strong> <span class="muted" style="font-size:12px">· ${ui.relTime(a.saved)}</span>
          <button class="icon-btn" data-airm="${i}" aria-label="Remove" style="float:right">${ui.icon("x")}</button></summary>${ui.aiAnswer(a.answer, `nb${i}`)}</details>`).join("")
        : `<p class="muted" style="font-size:12.5px">Save answers from <a href="#/ai/${encodeURIComponent(nb.symbol)}">AI Research</a> or the stock's AI tab.</p>`;
    };
    $("#nb-ai").addEventListener("click", (e) => { const b = e.target.closest("[data-airm]"); if (b) { e.preventDefault(); const ai = [...get().ai]; ai.splice(+b.dataset.airm, 1); save({ ai }); paintAI(); } });
    const paintSrc = () => {
      const src = get().sources || [];
      $("#nb-src").innerHTML = src.length ? src.map((s, i) => `<div class="list-row" style="cursor:default"><span class="nm"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a></span><span class="muted">${ui.relTime(s.saved)}</span><button class="icon-btn" data-srm="${i}" aria-label="Remove">${ui.icon("x")}</button></div>`).join("") : '<p class="muted" style="font-size:12.5px">Annual reports, filings, articles…</p>';
    };
    $("#nb-src").addEventListener("click", (e) => { const b = e.target.closest("[data-srm]"); if (b) { const s = [...get().sources]; s.splice(+b.dataset.srm, 1); save({ sources: s }); paintSrc(); } });
    $("#nb-srcf").addEventListener("submit", (e) => {
      e.preventDefault();
      const url = $("#nb-src-u").value.trim();
      if (!/^https?:\/\//.test(url)) { ui.toast("Enter a full http(s) link"); return; }
      save({ sources: [...(get().sources || []), { title: $("#nb-src-t").value.trim(), url, saved: new Date().toISOString() }] });
      e.target.reset(); paintSrc();
    });
    $("#nb-del").addEventListener("click", () => { if (confirm("Delete this notebook? This cannot be undone.")) { store.workspace.remove(nb.id); ui.go("#/workspace"); } });
    $("#nb-md").addEventListener("click", () => {
      const n = get();
      const md = [`# ${n.title}`, `Stock: ${n.symbol} · created ${n.created.slice(0, 10)} · updated ${n.updated.slice(0, 10)}`,
        ...FIELDS.map(([k, l]) => (n[k] ? `## ${l}\n\n${n[k]}` : "")).filter(Boolean),
        n.assumptions?.length ? `## Assumptions\n\n${n.assumptions.map((a) => `- ${a.metric} ${a.op} ${a.value}`).join("\n")}` : "",
        n.checks?.length ? `## Last check\n\n${STATUS_TEXT[n.checks.at(-1).status]}: ${n.checks.at(-1).headline}` : "",
        n.sources?.length ? `## Sources\n\n${n.sources.map((s) => `- [${s.title || s.url}](${s.url})`).join("\n")}` : ""].filter(Boolean).join("\n\n");
      ui.download(`${n.symbol}-notebook.md`, md, "text/markdown");
    });

    paintAssum(); paintHist(); paintAI(); paintSrc();
    data.report(nb.symbol).then((r) => {
      if (!ctx.alive()) return;
      report = r;
      if (nb.name === nb.symbol && r.name) store.workspace.update(nb.id, { name: r.name, symbol: r.symbol, title: nb.title === `${nb.symbol} thesis` ? `${r.name} thesis` : nb.title });
      metricOpts(Object.entries(r.metrics).filter(([, m]) => typeof m.value === "number").map(([k, m]) => [k, `${m.label} (now ${fmt.n(m.value, 2)})`]));
      paintAssum();
    }).catch(() => { /* metric list stays on the quick set */ });
  }

  window.views.workspace = {
    title: "Research Workspace",
    render(el, arg, ctx) {
      if (!arg) return list(el);
      if (arg.startsWith("new")) {
        const sym = arg.split("/")[1];
        if (sym) { ui.go(`#/workspace/${store.workspace.create(sym.toUpperCase(), sym.toUpperCase()).id}`); return; }
        list(el);
        el.querySelector("#ws-sym").focus();
        return;
      }
      const nb = store.workspace.get(arg);
      if (!nb) { el.innerHTML = ui.empty("Notebook not found", "It may have been deleted, or it was created in another browser.", `<a class="btn" href="#/workspace">All notebooks</a>`, "workspace"); return; }
      editor(el, nb, ctx);
    },
  };
})();
