/* Plain-English glossary + the (i) tooltips used across the app.

   GLOSSARY[key] = {
     term:  display name,
     aka:   other labels that should show the same tooltip (matched case-insensitively),
     short: one simple sentence,
     good:  a "Good if..." hint (optional),
   }

   Helpers (window.glossary):
     tip(key)          -> just the (i) button for a term
     T(label, key?)    -> label + (i) button; finds the term from the label if no key is given
     why(text)         -> the "What this tells you" caption shown under section headings
     all()             -> [{key, ...entry}] sorted by term, for the Learn page
*/
(function () {
  const GLOSSARY = {
    /* ---------- price & valuation ---------- */
    market_cap: { term: "Market cap", aka: ["Market capitalisation"], short: "The total value of all the company's shares: share price × number of shares.", good: "Large caps are usually steadier; small caps can grow faster but swing more." },
    pe: { term: "P/E ratio", aka: ["P/E", "PE", "Price to earnings", "Price/earnings"], short: "How many rupees you pay for ₹1 of the company's yearly profit.", good: "Lower is usually cheaper - but compare with the stock's own history and its industry." },
    forward_pe: { term: "Forward P/E", aka: ["Forward PE"], short: "Like P/E, but using next year's expected profit instead of last year's.", good: "Lower than today's P/E means analysts expect profits to grow." },
    pb: { term: "P/B ratio", aka: ["P/B", "Price to book"], short: "How many rupees you pay for ₹1 of the company's net assets (what it owns minus what it owes).", good: "Below 1-3 is cheap for most companies; banks are often judged on this." },
    ps: { term: "P/S ratio", aka: ["P/S", "Price to sales"], short: "How many rupees you pay for ₹1 of the company's yearly sales.", good: "Lower is cheaper. Useful when a company has little or no profit yet." },
    eps: { term: "EPS", aka: ["Earnings per share"], short: "The company's profit divided by the number of shares - the profit that belongs to one share.", good: "Good if it rises year after year." },
    peg: { term: "PEG ratio", aka: ["PEG"], short: "P/E divided by the profit growth rate - it checks whether a high P/E is justified by fast growth.", good: "Around 1 or below is considered reasonable." },
    book_value: { term: "Book value per share", aka: ["Book value / share", "Book value"], short: "The company's net worth (assets minus debts) divided by the number of shares.", good: "A rising book value means the company is building wealth." },
    dividend_yield: { term: "Dividend yield", aka: ["Div yield", "Yield"], short: "The yearly dividend as a percentage of the share price - the cash return you get for holding.", good: "2-5% is healthy for mature companies; very high yields can signal trouble." },
    ev: { term: "Enterprise value", aka: ["EV"], short: "What it would cost to buy the whole company: market cap plus debt minus cash.", good: "Used in EV/EBITDA and EV/Sales, which account for debt." },
    ev_ebitda: { term: "EV / EBITDA", aka: ["EV/EBITDA"], short: "Enterprise value divided by yearly operating earnings - a price tag that accounts for debt.", good: "Below about 10 is usually cheap; over 20 is expensive." },
    ev_sales: { term: "EV / Sales", aka: ["EV/Sales"], short: "Enterprise value divided by yearly sales.", good: "Lower is cheaper; compare within the same industry." },
    earnings_yield: { term: "Earnings yield", short: "Profit per share as a % of the price - the inverse of P/E.", good: "Higher is cheaper. Compare it with fixed-deposit or bond rates." },
    fcf_yield: { term: "FCF yield", aka: ["Free cash flow yield"], short: "Free cash flow as a % of market cap - how much spare cash the business makes for its price.", good: "Above 4-5% is attractive." },
    fair_value: { term: "Fair value", aka: ["Fair value (mid)", "Fair value estimate", "Intrinsic value", "Valuation"], short: "InvestIQ's estimate of what one share is really worth, blended from several methods.", good: "Price well below fair value = potential bargain (margin of safety)." },
    margin_of_safety: { term: "Margin of safety", aka: ["To fair value", "vs fair value"], short: "How far the price is below (or above) the estimated fair value.", good: "Positive means cheaper than fair value; value investors look for 20%+." },
    dcf: { term: "DCF", aka: ["Discounted cash flow", "DCF value"], short: "Adds up all the cash the company should make in future, counted in today's money.", good: "A DCF value above the price suggests the share is undervalued." },
    reverse_dcf: { term: "Reverse DCF", aka: ["Growth priced in"], short: "Works backwards from today's price to find the growth rate the market is already expecting.", good: "Good if the expected growth is lower than what the company has actually delivered." },
    graham_number: { term: "Graham number", short: "A conservative ceiling price from Benjamin Graham: √(22.5 × EPS × book value per share).", good: "Price below the Graham number suggests a value stock." },
    graham_growth: { term: "Graham growth formula", short: "Graham's value for a growing company: EPS × (8.5 + 2 × growth rate).", good: "Price below it suggests the share is cheap for its growth." },
    lynch: { term: "Peter Lynch fair value", aka: ["Peter Lynch (PEG = 1)", "Lynch"], short: "Peter Lynch's rule of thumb: a fair P/E equals the profit growth rate.", good: "Price below it suggests you're not overpaying for growth." },
    earnings_multiple: { term: "Earnings multiple value", aka: ["Earnings multiple"], short: "EPS multiplied by a P/E that matches the company's growth.", good: "Price below it suggests the share is cheap for its growth." },
    historical_pe: { term: "Historical P/E value", aka: ["Historical P/E average", "Own avg"], short: "EPS × the P/E the stock has usually traded at in past years.", good: "Price below it means the stock is cheaper than it usually is." },
    ddm: { term: "Dividend discount model", aka: ["Dividend discount"], short: "Values a share from the dividends it should pay in future.", good: "Only meaningful for steady dividend payers." },
    analyst_target: { term: "Analyst target", aka: ["Analyst consensus", "Analyst target price"], short: "The average 12-month price that professional analysts expect.", good: "Treat as one opinion - analysts are often wrong." },
    dcf_sensitivity: { term: "DCF sensitivity", aka: ["DCF value per share - sensitivity"], short: "Shows how the DCF value changes if growth or your required return is a bit different.", good: "If most cells are above the price, the valuation is robust." },
    discount_rate: { term: "Discount rate", short: "The yearly return you require for taking the risk of owning the share.", good: "Higher discount rate = more cautious valuation." },

    /* ---------- profitability & health ---------- */
    roe: { term: "ROE", aka: ["Return on equity"], short: "Yearly profit as a % of the shareholders' money in the business.", good: "Above 15% is strong." },
    roce: { term: "ROCE", aka: ["Return on capital employed"], short: "Operating profit as a % of all the money used to run the business (equity + debt).", good: "Above 15% is strong; it should beat the company's cost of borrowing." },
    roa: { term: "ROA", aka: ["Return on assets"], short: "Yearly profit as a % of everything the company owns.", good: "Above 5-10% is good for most non-banks." },
    profit_margin: { term: "Net profit margin", aka: ["Profit margin", "Net margin"], short: "How many paise of every ₹1 of sales end up as profit.", good: "Higher is better; above 10% is healthy for most industries." },
    operating_margin: { term: "Operating margin", aka: ["Operating margin"], short: "Profit from the core business (before interest and tax) per ₹1 of sales.", good: "Stable or rising margins show pricing power." },
    gross_margin: { term: "Gross margin", short: "Sales minus the direct cost of making the product, as a % of sales.", good: "High gross margins (40%+) often mean a strong brand or product." },
    revenue: { term: "Revenue", aka: ["Sales", "Total revenue"], short: "All the money the company earned from selling its products or services.", good: "Good if it grows steadily year after year." },
    net_income: { term: "Net profit", aka: ["Net income"], short: "What's left of revenue after all costs, interest and taxes.", good: "Good if it grows and is backed by cash flow." },
    ebitda: { term: "EBITDA", short: "Earnings before interest, taxes, depreciation and amortisation - a rough measure of operating cash profit.", good: "Useful for comparing companies with different debt levels." },
    operating_profit: { term: "Operating profit", aka: ["Operating income", "EBIT"], short: "Profit from the core business before interest and taxes.", good: "Good if it grows in line with or faster than sales." },
    gross_profit: { term: "Gross profit", short: "Sales minus the direct cost of goods sold.", good: "Good if it grows with sales." },
    debt_to_equity: { term: "Debt to equity", aka: ["Debt / equity", "D/E", "Debt/equity"], short: "How much the company has borrowed for every ₹1 of shareholders' money.", good: "Below 1 is comfortable; above 2 is risky (banks work differently)." },
    current_ratio: { term: "Current ratio", short: "Short-term assets divided by short-term bills - can the company pay what it owes this year?", good: "Above 1.2-1.5 is comfortable." },
    interest_coverage: { term: "Interest coverage", short: "How many times operating profit covers the interest on debt.", good: "Above 3× is safe; below 1.5× is a warning." },
    fcf: { term: "Free cash flow", aka: ["FCF"], short: "Cash left over after running the business and investing in it - money that can be paid out or saved.", good: "Positive and growing is a great sign." },
    ocf: { term: "Operating cash flow", aka: ["OCF"], short: "Cash actually generated by day-to-day business.", good: "Should be close to or above net profit." },
    capex: { term: "Capex", aka: ["Capital expenditure"], short: "Money spent on factories, equipment and other long-term assets.", good: "Heavy capex can mean growth ahead, but it uses up cash." },
    cash_conversion: { term: "Cash conversion", aka: ["Cash conversion (OCF / profit)"], short: "Operating cash flow divided by net profit - are profits turning into real cash?", good: "Around 1 or above is healthy." },
    total_debt: { term: "Total debt", short: "All the money the company has borrowed.", good: "Lower is safer, especially compared with cash and profits." },
    fscore: { term: "Piotroski F-Score", aka: ["F-Score", "Piotroski"], short: "A 0-9 score from nine yes/no tests of profit, debt and efficiency versus last year.", good: "7-9 is strong; 0-3 is weak." },
    zscore: { term: "Altman Z-Score", aka: ["Z-Score", "Altman"], short: "A formula that estimates the risk of a company going bankrupt in the next two years.", good: "Above 2.99 is safe; below 1.81 is a danger sign. Not valid for banks." },
    insiders: { term: "Insider / promoter holding", aka: ["Insider holding", "Insiders / promoters", "Promoter holding"], short: "The share of the company owned by its founders, directors and management.", good: "High holding means management has skin in the game." },
    institutions: { term: "Institutional holding", aka: ["Institutions"], short: "The share owned by mutual funds, insurers and other big investors.", good: "Rising institutional holding often signals growing confidence." },

    /* ---------- returns ---------- */
    cagr: { term: "CAGR", aka: ["Compound annual growth rate", "5Y CAGR", "10Y CAGR"], short: "The steady yearly growth rate that would turn the starting value into the ending value.", good: "Above 12% a year beats most Indian index returns." },
    total_return: { term: "Total return", aka: ["Return"], short: "The full percentage gain or loss over a period.", good: "Compare it with the index over the same period." },
    xirr: { term: "XIRR", short: "Your yearly return when you invest money at different times, like a monthly SIP.", good: "Above 12% for Indian stocks is good." },
    sip: { term: "SIP", aka: ["Systematic investment plan", "Monthly SIP"], short: "Investing a fixed amount every month, whatever the price - you buy more shares when prices are low.", good: "Works best over 5+ years." },
    lump_sum: { term: "Lump sum", short: "Investing all your money at once instead of in monthly instalments.", good: "Grows more if prices rise steadily, but timing matters more." },
    benchmark: { term: "Benchmark index", aka: ["Index", "vs index"], short: "A market index (like NIFTY 50) used as the yardstick for a stock's performance.", good: "A good stock beats its index over the long run." },
    nifty50: { term: "NIFTY 50", short: "An index of India's 50 biggest companies on the NSE - a snapshot of the Indian market.", good: "Most Indian fund managers try to beat it." },
    sensex: { term: "SENSEX", short: "An index of 30 large companies on the Bombay Stock Exchange.", good: "Moves very similarly to the NIFTY 50." },
    sp500: { term: "S&P 500", short: "An index of 500 large US companies - the main US market benchmark.", good: "The yardstick for US stocks." },
    seasonality: { term: "Seasonality", short: "Whether certain months of the year have tended to be better or worse.", good: "Treat as a curiosity - past patterns often don't repeat." },
    holding_period: { term: "Holding-period returns", aka: ["Rolling returns"], short: "What you would have earned holding for N years, starting on any week in history.", good: "Good if most holding periods made money." },
    "52w": { term: "52-week high / low", aka: ["52W high", "52W low"], short: "The highest and lowest price in the last year.", good: "Near the high = strong momentum; near the low = possible value or trouble." },
    ath: { term: "All-time high", short: "The highest price the stock has ever reached.", good: "Stocks far below their high may be cheap - or broken." },

    /* ---------- risk ---------- */
    volatility: { term: "Volatility", short: "How much the price swings up and down in a year.", good: "Below 25% is calm; above 40% is a bumpy ride." },
    drawdown: { term: "Drawdown", aka: ["Falls from peak", "Max fall", "Max drawdown", "Fall"], short: "How far the price has fallen from its previous peak.", good: "Smaller and shorter drawdowns mean less pain." },
    sharpe: { term: "Sharpe ratio", aka: ["Sharpe"], short: "Return earned above a safe deposit, per unit of risk taken.", good: "Above 1 is good; below 0 means a fixed deposit did better." },
    sortino: { term: "Sortino ratio", aka: ["Sortino"], short: "Like Sharpe, but only counts downside swings as risk.", good: "Above 1 is good." },
    var: { term: "Value at Risk (VaR)", aka: ["VaR", "VaR 95%"], short: "On a bad day (worst 1 in 20), the stock falls at least this much.", good: "Smaller (closer to 0) is safer." },
    beta: { term: "Beta", short: "How much the stock moves when the market moves. 1 = same as the market.", good: "Below 1 is calmer than the market; above 1 is more aggressive." },
    risk_level: { term: "Risk level", short: "InvestIQ's simple label combining volatility and past crashes.", good: "Match it to how much ups and downs you can stomach." },
    risk_free: { term: "Risk-free rate", short: "The return you could get with almost no risk, like a government bond or FD.", good: "A stock should beat this to be worth the risk." },
    probability_of_loss: { term: "Chance of loss", aka: ["Probability of loss"], short: "The model's estimate of how often you'd end up with less money than you put in.", good: "Lower is better; it usually shrinks the longer you hold." },
    bear_bull: { term: "Bear / base / bull", aka: ["Bear", "Base", "Bull"], short: "A bad-case, middle and good-case outcome (10th, 50th and 90th percentile).", good: "Plan for the bear case, hope for the bull case." },

    /* ---------- technicals ---------- */
    sma: { term: "Moving average (SMA)", aka: ["SMA 50", "SMA 200", "200-day average", "50-day average"], short: "The average closing price over the last 50 or 200 days - it smooths out daily noise.", good: "Price above its 200-day average = long-term uptrend." },
    cross: { term: "Golden / death cross", aka: ["50/200 cross", "Golden cross", "Death cross"], short: "When the 50-day average crosses above (golden) or below (death) the 200-day average.", good: "A golden cross is a bullish sign." },
    rsi: { term: "RSI", aka: ["RSI (14)", "Relative strength index"], short: "A 0-100 gauge of how fast the price has risen or fallen recently.", good: "Above 70 = overbought (stretched); below 30 = oversold." },
    macd: { term: "MACD", short: "Compares a fast and a slow moving average to spot momentum shifts.", good: "MACD above its signal line is bullish." },
    bollinger: { term: "Bollinger bands", aka: ["Bollinger"], short: "A band around the 20-day average that widens when the price gets more volatile.", good: "Price below the lower band can mean oversold." },
    support: { term: "Support", aka: ["Support (3M low)", "Support (6M low)"], short: "A price level where the stock has recently stopped falling.", good: "Buying near support gives a nearby level for a stop-loss." },
    resistance: { term: "Resistance", aka: ["Resistance (3M high)", "Resistance (6M high)"], short: "A price level where the stock has recently stopped rising.", good: "A break above resistance is a bullish sign." },
    pivot: { term: "Pivot point", aka: ["Pivot", "Pivot R1", "Pivot S1"], short: "A short-term reference level from yesterday's high, low and close; R1/S1 are the next levels up and down.", good: "Used by traders for day-to-day levels." },
    atr: { term: "ATR", aka: ["Average daily range (ATR 14)", "Average true range"], short: "The stock's typical daily price move over the last 14 days.", good: "Used to set stop-losses that aren't hit by normal daily noise." },
    trend: { term: "Trend", short: "The overall direction of the price, based on several indicators together.", good: "Buying in an uptrend is usually easier than catching a falling knife." },
    volume: { term: "Volume", aka: ["Volume (20d vs 90d avg)"], short: "How many shares change hands. Rising volume shows more interest.", good: "Price rises on high volume are more convincing." },

    /* ---------- decision tools ---------- */
    scorecard: { term: "InvestIQ score", aka: ["Scorecard", "Score", "InvestIQ score"], short: "A 0-10 rating combining performance, valuation, quality, momentum and safety.", good: "7.5+ is strong; below 4.5 is weak." },
    score_performance: { term: "Performance score", short: "How well the share price has grown over 5 and 10 years, and versus the index.", good: "Higher = better past returns." },
    score_valuation: { term: "Valuation score", short: "How cheap the share is versus its estimated fair value and P/E.", good: "Higher = cheaper." },
    score_quality: { term: "Quality score", short: "How profitable, growing and financially sound the business is.", good: "Higher = stronger business." },
    score_momentum: { term: "Momentum score", short: "Whether the price trend has recently been up or down.", good: "Higher = stronger recent trend." },
    score_safety: { term: "Safety score", short: "How calm the share has been: low volatility, smaller crashes, good risk-adjusted return.", good: "Higher = smoother ride." },
    checklist: { term: "Buy checklist", short: "15 yes/no tests covering business quality, financial strength, valuation and price trend.", good: "Passing 11 or more (75%) looks attractive." },
    entry_zone: { term: "Entry zone", aka: ["Fair-value zone"], short: "A price range where buying looks reasonable, based on fair value and recent support.", good: "Buying inside the zone gives better odds than chasing the price." },
    stop_loss: { term: "Stop-loss", short: "A price where you'd sell to limit your loss if you're wrong.", good: "Decide it before you buy, and stick to it." },
    target: { term: "Target price", aka: ["Target 1", "Target 2", "Target 3", "Targets"], short: "A price where you might take some profit.", good: "Targets based on fair value are more reliable than hopes." },
    reward_risk: { term: "Reward : risk", aka: ["Reward : risk (to target 1)", "Risk/reward"], short: "Potential gain to the first target divided by potential loss to the stop-loss.", good: "2 : 1 or better is attractive." },
    position_size: { term: "Position size", aka: ["Position size calculator"], short: "How many shares to buy so that hitting your stop-loss only loses a small, fixed share of your capital.", good: "Risking 1-2% of capital per trade is a common rule." },
    trailing_12m: { term: "TTM", aka: ["Last 12 months"], short: "Trailing twelve months - the total for the last four quarters.", good: "The most up-to-date yearly figure." },
  };

  // Lookup table: every term and alias, lower-cased -> key.
  const INDEX = {};
  Object.entries(GLOSSARY).forEach(([key, g]) => {
    [g.term, ...(g.aka || [])].forEach((label) => { INDEX[label.toLowerCase()] = key; });
  });

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function find(label) {
    return INDEX[String(label).trim().toLowerCase()] || null;
  }

  /* The (i) button. data-term tells the popover which entry to show. */
  function tip(key) {
    const g = GLOSSARY[key];
    if (!g) return "";
    return `<button type="button" class="tip" data-term="${key}" aria-label="What is ${esc(g.term)}?">i</button>`;
  }

  /* Label followed by its (i) button - falls back to the plain label. */
  function T(label, key) {
    const k = key || find(label);
    return k ? `<span class="term">${esc(label)}${tip(k)}</span>` : esc(label);
  }

  function why(text) {
    return `<p class="why"><span class="why-label">What this tells you:</span> ${esc(text)}</p>`;
  }

  function all() {
    return Object.entries(GLOSSARY)
      .map(([key, g]) => ({ key, ...g }))
      .sort((a, b) => a.term.localeCompare(b.term));
  }

  /* ---------- tooltip popover (one shared element, delegated events) ---------- */
  let pop = null;
  let openBtn = null;
  let openedBy = null; // "hover" | "focus" | "click" - a click must not close a tooltip that hover/focus just opened

  function ensurePop() {
    if (pop) return pop;
    pop = document.createElement("div");
    pop.id = "tip-pop";
    pop.className = "tip-pop";
    pop.setAttribute("role", "tooltip");
    pop.hidden = true;
    document.body.appendChild(pop);
    return pop;
  }

  function show(btn, how) {
    const g = GLOSSARY[btn.dataset.term];
    if (!g) return;
    const el = ensurePop();
    el.innerHTML = `<strong>${esc(g.term)}</strong><p>${esc(g.short)}</p>${g.good ? `<p class="good-if"><span>Good if:</span> ${esc(g.good)}</p>` : ""}`;
    el.hidden = false;
    if (openBtn && openBtn !== btn) openBtn.removeAttribute("aria-describedby");
    btn.setAttribute("aria-describedby", "tip-pop");
    openBtn = btn;
    openedBy = how;
    // Position below the button (document coordinates, so it scrolls with the page), kept inside the viewport.
    const r = btn.getBoundingClientRect();
    const w = Math.min(300, window.innerWidth - 24);
    el.style.width = w + "px";
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - w - 12));
    let top = r.bottom + 8;
    if (top + el.offsetHeight > window.innerHeight - 8 && r.top - el.offsetHeight - 8 > 0) top = r.top - el.offsetHeight - 8;
    el.style.left = left + window.scrollX + "px";
    el.style.top = top + window.scrollY + "px";
  }

  function hide() {
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    if (openBtn) openBtn.removeAttribute("aria-describedby");
    openBtn = null;
    openedBy = null;
  }

  const canHover = () => matchMedia("(hover: hover)").matches;

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".tip");
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      // Second click on a click-opened tooltip closes it; otherwise pin it open.
      if (openBtn === btn && openedBy === "click") hide(); else show(btn, "click");
      return;
    }
    if (!e.target.closest(".tip-pop")) hide();
  });
  // Hover preview on desktop; keyboard users get it on focus. Taps are handled by "click".
  document.addEventListener("mouseover", (e) => {
    const btn = e.target.closest(".tip");
    if (btn && canHover() && openedBy !== "click") show(btn, "hover");
  });
  document.addEventListener("mouseout", (e) => {
    const btn = e.target.closest(".tip");
    if (btn && openedBy === "hover" && !e.relatedTarget?.closest?.(".tip-pop")) hide();
  });
  document.addEventListener("focusin", (e) => {
    if (e.target.matches?.(".tip:focus-visible") && openedBy !== "click") show(e.target, "focus");
  });
  document.addEventListener("focusout", (e) => { if (e.target.matches?.(".tip") && openedBy === "focus") hide(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  window.addEventListener("hashchange", hide);

  window.GLOSSARY = GLOSSARY;
  window.glossary = { tip, T, why, find, all };
})();
