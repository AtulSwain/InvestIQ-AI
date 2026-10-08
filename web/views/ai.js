/* AI Research assistant: ask research questions about up to 4 companies. The server sends Claude
   InvestIQ's report data as citable documents (plus optional web search) and returns an answer
   whose claims link to numbered sources. History stays in this browser.  #/ai[/SYM1,SYM2] */
(function () {
  const { esc } = fmt;
  const data = window.investiqData;

  const PROMPTS = [
    ["Why did this stock move?", "Why did {s} move recently? Identify the specific events, news or results behind the biggest recent price moves, and separate confirmed causes from speculation."],
    ["Compare these companies", "Compare {s} on business quality, growth, profitability, balance sheet strength, valuation and risks. Which is strongest on each dimension?"],
    ["Analyze the latest earnings", "Analyze the latest earnings of {s}: revenue and profit versus last year and versus estimates, margins, guidance or commentary, and how the stock reacted."],
    ["Is this stock overvalued?", "Is {s} overvalued, fairly valued or undervalued? Use the valuation models, multiples versus history and peers, and the growth the price implies."],
    ["What are the biggest risks?", "What are the biggest risks for {s}? Cover financial, valuation, business, regulatory/legal and market risks with the evidence for each."],
    ["Bull vs bear case", "Lay out the bull case and the bear case for {s}, each with the evidence that supports it and what would prove it wrong."],
  ];

  window.views.ai = {
    title: "AI Research",
    async render(el, arg, ctx) {
      let symbols = (arg || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 4);
      if (!symbols.length) symbols = store.recent.all().slice(0, 1).map((r) => r.symbol);
      el.innerHTML = `<div class="page-head"><div><div class="crumbs">Research</div><h1>AI research assistant</h1>
          <p class="sub muted">Structured, evidence-based answers. Every claim cites InvestIQ data (with source and date) or a web page.</p></div><span id="ai-st" class="status-pill"></span></div>
        <div class="grid grid-3 section">
          <div class="span-2">
            <div class="card"><h2>Companies in context</h2>
              <div class="row"><div class="chips" id="ai-syms"></div><form id="ai-addf" class="row" autocomplete="off"><input id="ai-add" placeholder="Add company (max 4)" style="width:180px"><button class="btn sm" type="submit">Add</button></form></div>
              <div id="ai-sugg"></div>
              <h3>Ask</h3><div class="chips" id="ai-prompts">${PROMPTS.map(([l], i) => `<button class="chip" data-p="${i}">${esc(l)}</button>`).join("")}</div>
              <form id="ai-form" style="margin-top:10px"><textarea id="ai-q" rows="3" maxlength="2000" placeholder="e.g. How exposed is this company to a rise in interest rates?" style="width:100%"></textarea>
                <div class="row" style="margin-top:6px"><label class="toggle"><input type="checkbox" id="ai-web" checked> Include web search (recent news, filings, commentary)</label><span class="spacer"></span><button class="btn primary" type="submit">${ui.icon("ai")} Ask</button></div></form></div>
            <div id="ai-thread" class="chat section"></div>
          </div>
          <div><div class="card"><div class="card-head"><h2>History</h2><button class="btn sm ghost" id="ai-clear">Clear</button></div><div id="ai-hist"></div></div>
            <div class="card" style="margin-top:12px"><h2>How answers are built</h2><ul class="method-list" style="font-size:12.5px">
              <li>The server loads each company's full InvestIQ report and sends metrics, statements, earnings, valuation, risk profile and news to Claude as separate citable documents.</li>
              <li>Numbers in answers must come from those documents or cited web pages; uncertainty and missing data must be stated.</li>
              <li>Citations <span class="cite">1</span> link to the exact source with its provider and date.</li>
              <li>AI can still be wrong. Check the sources before acting.</li></ul></div></div>
        </div>
        <p class="disclaimer">AI-generated research, not investment advice.</p>`;
      const $ = (s) => el.querySelector(s);
      const hist = () => store.get("ai_history", []);

      const paintSyms = () => {
        $("#ai-syms").innerHTML = symbols.map((s, i) => `<button type="button" class="chip" data-rm="${i}"><span class="ticker">${esc(s)}</span> <span class="x">×</span></button>`).join("") || '<span class="muted" style="font-size:12.5px">None - general market questions use web search only.</span>';
        $("#ai-add").disabled = symbols.length >= 4;
        history.replaceState(null, "", `#/ai${symbols.length ? "/" + symbols.map(encodeURIComponent).join(",") : ""}`);
      };
      $("#ai-syms").addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (b) { symbols.splice(+b.dataset.rm, 1); paintSyms(); } });
      const addSym = (s) => { if (s && !symbols.includes(s) && symbols.length < 4) symbols.push(s); $("#ai-add").value = ""; $("#ai-sugg").innerHTML = ""; paintSyms(); };
      $("#ai-addf").addEventListener("submit", (e) => { e.preventDefault(); addSym($("#ai-add").value.trim().toUpperCase()); });
      let timer;
      $("#ai-add").addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const v = $("#ai-add").value.trim();
          const res = v ? await data.search(v).catch(() => []) : [];
          $("#ai-sugg").innerHTML = res.slice(0, 5).map((s) => `<button type="button" class="chip" data-pick="${esc(s.symbol)}" style="margin:6px 6px 0 0"><span class="ticker">${esc(s.symbol)}</span> <span class="muted">${esc(s.name)}</span></button>`).join("");
        }, 200);
      });
      $("#ai-sugg").addEventListener("click", (e) => { const b = e.target.closest("[data-pick]"); if (b) addSym(b.dataset.pick); });
      $("#ai-prompts").addEventListener("click", (e) => {
        const b = e.target.closest("[data-p]");
        if (!b) return;
        const names = symbols.length ? symbols.join(", ") : "the stocks I follow";
        $("#ai-q").value = PROMPTS[+b.dataset.p][1].replace("{s}", names);
        $("#ai-q").focus();
      });

      const paintHist = () => {
        const h = hist();
        $("#ai-hist").innerHTML = h.length ? h.slice(0, 20).map((x, i) => `<div class="list-row" data-h="${i}"><span class="nm" title="${esc(x.question)}">${esc(x.question)}</span><span class="muted">${esc((x.symbols || []).join(","))}</span><span class="muted">${ui.relTime(x.at)}</span></div>`).join("")
          : '<p class="muted" style="font-size:12.5px">Your questions appear here.</p>';
      };
      $("#ai-hist").addEventListener("click", (e) => { const r = e.target.closest("[data-h]"); if (r) showAnswer(hist()[+r.dataset.h]); });
      $("#ai-clear").addEventListener("click", () => { store.set("ai_history", []); paintHist(); });

      let n = 0;
      function showAnswer(entry, box) {
        const i = ++n;
        box = box || document.createElement("div");
        box.innerHTML = `<div class="q">${esc(entry.question)}${entry.symbols?.length ? ` <span class="muted">· ${esc(entry.symbols.join(", "))}</span>` : ""}</div>
          <div class="a">${ui.aiAnswer(entry.answer, `a${i}`)}<div class="row no-print" style="margin-top:8px">${(entry.symbols || []).length ? `<button class="btn sm" data-save>${ui.icon("workspace")} Save to ${esc(entry.symbols[0])} notebook</button>` : ""}<button class="btn sm ghost" data-md>${ui.icon("download")} Markdown</button></div></div>`;
        if (!box.isConnected) $("#ai-thread").prepend(box);
        box.querySelector("[data-save]")?.addEventListener("click", () => {
          store.workspace.attach(entry.symbols[0], entry.symbols[0], "ai", { question: entry.question, answer: entry.answer });
          ui.toast("Saved to notebook", entry.symbols[0]);
        });
        box.querySelector("[data-md]").addEventListener("click", () => {
          const a = entry.answer;
          const md = `# ${entry.question}\n\n${(a.blocks || []).map((b) => b.text + (b.cites || []).map((c) => `[${c}]`).join("")).join("")}\n\n## Sources\n${(a.sources || []).map((s) => `${s.n}. ${s.title}${s.url ? ` - ${s.url}` : ""}${s.provider ? ` (${s.provider})` : ""}`).join("\n")}\n`;
          ui.download("investiq-ai-answer.md", md, "text/markdown");
        });
      }

      async function ask(question) {
        if (!question.trim()) return;
        const box = document.createElement("div");
        box.innerHTML = `<div class="q">${esc(question)}</div><div class="a">${ui.loading("Reading the data and researching - usually 20-60 seconds…")}</div>`;
        $("#ai-thread").prepend(box);
        try {
          const answer = await data.aiAsk(question, symbols, $("#ai-web").checked);
          if (!ctx.alive()) return;
          const entry = { question, symbols: [...symbols], answer, at: new Date().toISOString() };
          store.set("ai_history", [entry, ...hist()].slice(0, 30));
          showAnswer(entry, box);
          paintHist();
        } catch (err) { if (ctx.alive()) box.querySelector(".a").innerHTML = ui.errorBox(err); }
      }
      $("#ai-form").addEventListener("submit", (e) => { e.preventDefault(); ask($("#ai-q").value); });

      paintSyms(); paintHist();
      const st = await data.aiStatus();
      if (!ctx.alive()) return;
      $("#ai-st").innerHTML = `<span class="dot ${st.available ? "live" : ""}"></span><span class="txt">${st.available ? esc(st.model) : "Unavailable"}</span>`;
      if (!st.available) {
        $("#ai-thread").innerHTML = `<div class="card">${ui.empty("AI research is not available here", `${esc(st.reason)}<br>Run <code>python -m investiq</code> with <code>ANTHROPIC_API_KEY</code> set, or connect a hosted InvestIQ server (see README). Saved answers in your history still open.`, "", "ai")}</div>`;
        $("#ai-form button[type=submit]").disabled = true;
      }
    },
  };
})();
