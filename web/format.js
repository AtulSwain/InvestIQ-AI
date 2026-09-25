/* Number formatting helpers (Indian grouping + lakh/crore for INR). */
(function () {
  const SYMBOL = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };

  function sym(cur) { return SYMBOL[cur] || (cur ? cur + " " : ""); }
  function locale(cur) { return cur === "INR" ? "en-IN" : "en-US"; }

  function money(v, cur, digits = 2) {
    if (v == null) return "—";
    if (v < 0) return "−" + money(-v, cur, digits);
    return sym(cur) + Number(v).toLocaleString(locale(cur), { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function big(v, cur) {
    if (v == null) return "—";
    if (v < 0) return "−" + big(-v, cur);
    const a = Math.abs(v);
    if (cur === "INR") {
      if (a >= 1e12) return sym(cur) + (v / 1e12).toLocaleString("en-IN", { maximumFractionDigits: 2 }) + " L Cr";
      if (a >= 1e7) return sym(cur) + Math.round(v / 1e7).toLocaleString("en-IN") + " Cr";
      if (a >= 1e5) return sym(cur) + (v / 1e5).toFixed(2) + " L";
      return money(v, cur, 0);
    }
    if (a >= 1e12) return sym(cur) + (v / 1e12).toFixed(2) + "T";
    if (a >= 1e9) return sym(cur) + (v / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return sym(cur) + (v / 1e6).toFixed(2) + "M";
    return money(v, cur, 0);
  }

  function pct(v, digits = 1, signed = true) {
    if (v == null) return "—";
    const s = Number(v).toFixed(digits) + "%";
    return signed && v > 0 ? "+" + s : s.replace("-", "−");
  }

  function signedClass(v) { return v == null ? "" : v >= 0 ? "up" : "down"; }

  function pctSpan(v, digits = 1) {
    if (v == null) return '<span class="muted">—</span>';
    const arrow = v >= 0 ? "▲" : "▼";
    return `<span class="${signedClass(v)}">${arrow} ${pct(Math.abs(v), digits, false)}</span>`;
  }

  function n(v, digits = 2) {
    if (v == null) return "—";
    return Number(v).toLocaleString("en-US", { maximumFractionDigits: digits });
  }

  function date(s) {
    if (!s) return "—";
    return new Date(s + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function duration(days) {
    if (days == null) return "—";
    if (days < 60) return days + " days";
    if (days < 730) return Math.round(days / 30.4) + " months";
    return (days / 365.25).toFixed(1) + " years";
  }

  window.fmt = { money, big, pct, pctSpan, signedClass, n, date, esc, sym, duration };
})();
