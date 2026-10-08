/* Data-source identity: every exchange, data provider, regulator and AI service InvestIQ uses,
   with its official site icon, so users can see at a glance where each number comes from.

   Logos are each organisation's own site icon, loaded at view time (via Google's public favicon
   service, which serves the icon the site itself publishes). If it can't load - offline, blocked,
   or a network policy - a lettered badge in the brand colour is shown instead, so the layout
   never breaks. Names and logos are trademarks of their owners, shown only to identify sources.

   window.brands:
     logo(id, {size, title})   -> <span class="logo"> icon (falls back to monogram)
     chip(id)                  -> logo + name, linked to the source's site
     forProvider(providerId)   -> brand id for a provenance record's provider
     forExchange(code|symbol)  -> brand id for an exchange code or a ticker
     forUrl(url)               -> logo for any web page (news publishers, AI web citations)
     ALL / GROUPS              -> registry for the Data sources page                          */
(function () {
  const { esc } = fmt;

  const ALL = {
    // Exchanges & index providers
    nse: { name: "National Stock Exchange of India", short: "NSE", domain: "nseindia.com", url: "https://www.nseindia.com", color: "#1a3f8f", mono: "NSE", group: "exchange",
      use: "Primary listing for Indian stocks (tickers ending .NS); NIFTY indices; official corporate announcements and annual reports linked from the Filings tab." },
    bse: { name: "BSE (Bombay Stock Exchange)", short: "BSE", domain: "bseindia.com", url: "https://www.bseindia.com", color: "#c8102e", mono: "BSE", group: "exchange",
      use: "Indian listings (tickers ending .BO); SENSEX index; corporate filings linked from the Filings tab." },
    nasdaq: { name: "Nasdaq", short: "Nasdaq", domain: "nasdaq.com", url: "https://www.nasdaq.com", color: "#0996c7", mono: "NQ", group: "exchange",
      use: "US listings such as Apple, Microsoft and Nvidia; Nasdaq Composite index." },
    nyse: { name: "New York Stock Exchange", short: "NYSE", domain: "nyse.com", url: "https://www.nyse.com", color: "#1f4e9c", mono: "NYSE", group: "exchange",
      use: "US listings such as JPMorgan, Visa and Berkshire Hathaway." },
    spdji: { name: "S&P Dow Jones Indices", short: "S&P DJI", domain: "spglobal.com", url: "https://www.spglobal.com/spdji/", color: "#d6002a", mono: "S&P", group: "exchange",
      use: "S&P 500 and Dow Jones Industrial Average - the US benchmarks." },
    // Market data providers
    yahoo: { name: "Yahoo Finance", short: "Yahoo Finance", domain: "finance.yahoo.com", url: "https://finance.yahoo.com", color: "#6001d2", mono: "Y!", group: "data",
      use: "Base source for every stock: price history, quotes, financial statements, profile, news, earnings, holders, insider trades, analyst actions, and US SEC filing lists. Free, no key (via the yfinance library).", access: "Always on" },
    alpaca: { name: "Alpaca Markets", short: "Alpaca", domain: "alpaca.markets", url: "https://alpaca.markets", color: "#f5c518", mono: "A", group: "data",
      use: "Real-time US quotes from the IEX feed (first choice when configured).", access: "Optional key" },
    finnhub: { name: "Finnhub", short: "Finnhub", domain: "finnhub.io", url: "https://finnhub.io", color: "#1db954", mono: "FH", group: "data",
      use: "Real-time US quotes, US company news and peer lists.", access: "Optional key" },
    twelvedata: { name: "Twelve Data", short: "Twelve Data", domain: "twelvedata.com", url: "https://twelvedata.com", color: "#2563eb", mono: "12", group: "data",
      use: "US quotes; backup US price history if Yahoo fails.", access: "Optional key" },
    fmp: { name: "Financial Modeling Prep", short: "FMP", domain: "financialmodelingprep.com", url: "https://financialmodelingprep.com", color: "#0f6efd", mono: "FMP", group: "data",
      use: "US quotes; backup US price history and company profile if Yahoo fails.", access: "Optional key" },
    alphavantage: { name: "Alpha Vantage", short: "Alpha Vantage", domain: "alphavantage.co", url: "https://www.alphavantage.co", color: "#3a4bd8", mono: "AV", group: "data",
      use: "US macro series (Treasury yields, CPI, unemployment, GDP) on the Markets page; last-resort quotes.", access: "Optional key" },
    // Regulators & official statistics
    sec: { name: "U.S. SEC (EDGAR)", short: "SEC EDGAR", domain: "sec.gov", url: "https://www.sec.gov/edgar/search/", color: "#163d70", mono: "SEC", group: "official",
      use: "Official US filings (10-K, 10-Q, 8-K…) - each filing in the Filings tab links to its EDGAR page." },
    sebi: { name: "Securities and Exchange Board of India", short: "SEBI", domain: "sebi.gov.in", url: "https://www.sebi.gov.in", color: "#123c69", mono: "SEBI", group: "official",
      use: "India's market regulator; insider-trading (PIT) and takeover (SAST) disclosures are filed through NSE/BSE." },
    rbi: { name: "Reserve Bank of India", short: "RBI", domain: "rbi.org.in", url: "https://www.rbi.org.in", color: "#0b5d3b", mono: "RBI", group: "official",
      use: "Official source for policy rates and Indian monetary data (linked from the Macro tab; no free API)." },
    mospi: { name: "Ministry of Statistics (MoSPI)", short: "MoSPI", domain: "mospi.gov.in", url: "https://www.mospi.gov.in", color: "#8a5a00", mono: "MoS", group: "official",
      use: "Official Indian CPI inflation and GDP releases (linked from the Macro tab; no free API)." },
    // AI
    anthropic: { name: "Anthropic Claude", short: "Claude", domain: "anthropic.com", url: "https://www.anthropic.com", color: "#d97757", mono: "AI", group: "ai",
      use: "AI research assistant and AI investment summaries. Answers cite InvestIQ data and web pages.", access: "Server key" },
    // Ourselves
    investiq: { name: "InvestIQ calculation", short: "InvestIQ", color: "#4f8cff", mono: "IQ", group: "self", own: true,
      use: "Ratios, valuation models, scores, risk profile and scenarios calculated from the data above - each with its method on the Sources tab." },
    demo: { name: "InvestIQ demo data (synthetic)", short: "Demo data", color: "#6e7681", mono: "D", group: "self", own: true, use: "Synthetic data for offline demos - not real prices." },
  };
  const GROUPS = [["exchange", "Exchanges & indices"], ["data", "Market data providers"], ["official", "Regulators & official statistics"], ["ai", "AI"], ["self", "InvestIQ"]];

  const ICON = (domain, size) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size <= 16 ? 32 : 64}`;
  const OWN = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="var(--accent)"/><path d="M7 22l6-7 5 4 7-9" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function logo(id, { size = 16, title } = {}) {
    const b = ALL[id];
    if (!b) return "";
    const t = esc(title || b.name);
    const style = `width:${size}px;height:${size}px;--brand:${b.color};font-size:${Math.max(6, Math.round(size * (b.mono.length > 2 ? 0.34 : 0.46)))}px`;
    if (b.own) return `<span class="logo own" style="${style}" title="${t}" role="img" aria-label="${t}">${id === "demo" ? `<span class="mono">${b.mono}</span>` : OWN}</span>`;
    return `<span class="logo" style="${style}" title="${t}" role="img" aria-label="${t}"><span class="mono" aria-hidden="true">${esc(b.mono)}</span>`
      + `<img class="logo-img" src="${ICON(b.domain, size)}" alt="" loading="lazy" referrerpolicy="no-referrer" decoding="async"></span>`;
  }

  /* Logo for an arbitrary page (news publisher, AI web citation): its site icon, monogram fallback. */
  function forUrl(url, { size = 14, label = "" } = {}) {
    let host;
    try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
    const known = Object.entries(ALL).find(([, b]) => b.domain && (host === b.domain || host.endsWith("." + b.domain)));
    if (known) return logo(known[0], { size });
    const mono = (label || host).replace(/[^A-Za-z0-9]/g, "").slice(0, 1).toUpperCase() || "•";
    return `<span class="logo" style="width:${size}px;height:${size}px;--brand:#6e7681;font-size:${Math.round(size * 0.5)}px" title="${esc(host)}" role="img" aria-label="${esc(host)}"><span class="mono" aria-hidden="true">${esc(mono)}</span>`
      + `<img class="logo-img" src="${ICON(host, size)}" alt="" loading="lazy" referrerpolicy="no-referrer" decoding="async"></span>`;
  }

  function chip(id, { size = 16, link = true } = {}) {
    const b = ALL[id];
    if (!b) return "";
    const inner = `${logo(id, { size })}<span>${esc(b.short)}</span>`;
    return link && b.url ? `<a class="brand-chip" href="${esc(b.url)}" target="_blank" rel="noopener" title="${esc(b.name)}">${inner}</a>` : `<span class="brand-chip" title="${esc(b.name)}">${inner}</span>`;
  }

  const forProvider = (p) => (ALL[p] ? p : p === "yfinance" ? "yahoo" : null);
  /* Brand id from a provider label such as "Yahoo Finance (via yfinance)" (AI source lists carry labels). */
  function forLabel(label) {
    const l = String(label || "").toLowerCase();
    const hit = Object.entries(ALL).find(([id, b]) => l.startsWith(b.short.toLowerCase()) || l.startsWith(b.name.toLowerCase()) || (id === "yahoo" && l.includes("yahoo")));
    return hit ? hit[0] : null;
  }

  /* Exchange code from data ("NSE", "NSI", "BSE", "BOM", "NMS", "NasdaqGS", "NYQ", "NYSE"…) or a ticker. */
  function forExchange(code, symbol) {
    const c = String(code || "").toUpperCase();
    const s = String(symbol || "").toUpperCase();
    if (/^(NSE|NSI)$/.test(c) || s.endsWith(".NS") || ["^NSEI", "^NSEBANK", "^CNXIT", "^INDIAVIX"].includes(s)) return "nse";
    if (/^(BSE|BOM)$/.test(c) || s.endsWith(".BO") || s === "^BSESN") return "bse";
    if (/NASDAQ|^NMS|^NGM|^NCM|^NAS/.test(c) || s === "^IXIC") return "nasdaq";
    if (/NYSE|^NYQ|^ASE|^PCX/.test(c)) return "nyse";
    if (["^GSPC", "^DJI"].includes(s)) return "spdji";
    return null;
  }

  // Broken / blocked icons fall back to the monogram underneath (one capturing listener, no inline handlers).
  document.addEventListener("error", (e) => {
    const t = e.target;
    if (t && t.classList && t.classList.contains("logo-img")) t.remove();
  }, true);

  window.brands = { ALL, GROUPS, logo, chip, forUrl, forProvider, forLabel, forExchange };
})();
