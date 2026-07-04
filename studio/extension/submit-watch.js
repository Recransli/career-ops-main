// submit-watch.js — auto-injected on known ATS application pages. Detects when
// the user actually submits an application and offers to mark it Applied in
// Studio (never does it silently — the user confirms). Also flips the tracker
// automatically if they accept, so the monitoring screen stays in sync.

(function () {
  if (window.__studioSubmitWatch) return;
  window.__studioSubmitWatch = true;
  const STUDIO = "http://localhost:4949";

  const looksLikeSubmit = (el) => {
    const t = ((el.innerText || el.value || "") + " " + (el.getAttribute?.("aria-label") || "")).toLowerCase();
    return /submit application|submit your application|apply now|send application|submit$/.test(t.trim());
  };

  // Grab the role/company from the page so the tracker entry is meaningful.
  function context() {
    const title = (document.querySelector("h1, h2")?.innerText || document.title).replace(/\s+/g, " ").trim().slice(0, 120);
    const m = location.hostname.match(/(?:greenhouse\.io|lever\.co|ashbyhq\.com)/) && location.pathname.split("/").filter(Boolean)[0];
    return { role: title, company: (m || location.hostname.split(".")[0] || "").replace(/-/g, " "), url: location.href };
  }

  let armed = false;
  function offerMarkApplied() {
    if (window.__studioOffered) return;
    window.__studioOffered = true;
    const { role, company, url } = context();
    const bar = document.createElement("div");
    Object.assign(bar.style, {
      position: "fixed", bottom: "18px", left: "50%", transform: "translateX(-50%)", zIndex: 2147483647,
      background: "#1f1e1d", color: "#faf9f5", padding: "12px 18px", borderRadius: "12px",
      font: "13.5px/1.4 -apple-system, sans-serif", boxShadow: "0 8px 30px rgba(0,0,0,.3)",
      display: "flex", gap: "12px", alignItems: "center", maxWidth: "460px",
    });
    bar.innerHTML = `<span>Looks like you applied. Mark <b>${role.slice(0, 40)}</b> as Applied in Studio?</span>`;
    const yes = document.createElement("button");
    yes.textContent = "Yes, track it";
    Object.assign(yes.style, { background: "#d97757", color: "#fff", border: "none", borderRadius: "8px", padding: "6px 12px", fontWeight: "600", cursor: "pointer" });
    const no = document.createElement("button");
    no.textContent = "✕";
    Object.assign(no.style, { background: "transparent", color: "#faf9f5", border: "none", cursor: "pointer", fontSize: "15px" });
    yes.onclick = async () => {
      yes.textContent = "…";
      try {
        await fetch(`${STUDIO}/api/track`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ company, role, status: "Applied", note: `submitted on ${location.hostname}` }) });
        bar.innerHTML = "<span>✓ Tracked as Applied.</span>";
        setTimeout(() => bar.remove(), 2500);
      } catch { bar.innerHTML = "<span>Couldn't reach Studio — is it running?</span>"; }
    };
    no.onclick = () => bar.remove();
    bar.append(yes, no);
    document.documentElement.appendChild(bar);
  }

  // Detect submit clicks (button or form submit) that look like an application.
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("button, input[type=submit], a[role=button]");
    if (btn && looksLikeSubmit(btn)) armed = true;
  }, true);
  document.addEventListener("submit", () => { armed = true; }, true);

  // Confirmation typically shows a "thank you / received" state or navigates.
  const confirmed = () => /thank you|application (received|submitted)|we('| ha)ve received|successfully (applied|submitted)/i.test(document.body?.innerText || "");
  const obs = new MutationObserver(() => { if ((armed || confirmed()) && confirmed()) { offerMarkApplied(); obs.disconnect(); } });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  // Fallback: if they clicked submit and the page unloads, offer on next load is
  // impossible, so also offer shortly after an armed click if content changed.
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("button, input[type=submit]");
    if (btn && looksLikeSubmit(btn)) setTimeout(() => { if (confirmed()) offerMarkApplied(); }, 2500);
  }, true);
})();
