// Injected on demand (popup button → chrome.scripting). Scrapes the visible
// form fields on the application page, asks Studio (local server + local
// model) for grounded values, fills them, and highlights what it touched.
//
// HARD RULES: it never clicks buttons, never submits, and leaves any field
// the model isn't sure about empty. The human reviews and sends.

(async function studioFill() {
  if (window.__studioFillRunning) return;
  window.__studioFillRunning = true;

  const banner = (text, tone = "info") => {
    let el = document.getElementById("__studio_banner");
    if (!el) {
      el = document.createElement("div");
      el.id = "__studio_banner";
      Object.assign(el.style, {
        position: "fixed", top: "14px", right: "14px", zIndex: 2147483647,
        background: tone === "err" ? "#8c3a22" : "#1f1e1d", color: "#faf9f5",
        font: "13px/1.5 -apple-system, sans-serif", padding: "10px 16px",
        borderRadius: "10px", boxShadow: "0 6px 24px rgba(0,0,0,.25)", maxWidth: "340px",
      });
      document.documentElement.appendChild(el);
    }
    el.style.background = tone === "err" ? "#8c3a22" : "#1f1e1d";
    el.textContent = text;
    return el;
  };

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  };

  const labelFor = (el) => {
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return l.textContent.trim();
    }
    return (
      el.getAttribute("aria-label") ||
      el.closest("label")?.textContent.trim() ||
      el.placeholder ||
      el.name ||
      el.closest("div,fieldset")?.querySelector("label, legend, .label")?.textContent.trim() ||
      ""
    ).replace(/\s+/g, " ").slice(0, 160);
  };

  // Collect fillable fields
  const els = [...document.querySelectorAll("input, textarea, select")].filter((el) => {
    if (!visible(el)) return false;
    const t = (el.type || "").toLowerCase();
    if (["hidden", "submit", "button", "image", "reset", "password", "file"].includes(t)) return false;
    return true;
  });
  if (!els.length) {
    banner("No form fields found on this page.", "err");
    window.__studioFillRunning = false;
    return;
  }

  const fields = els.map((el, i) => {
    el.dataset.__studioId = `f${i}`;
    const t = (el.type || el.tagName).toLowerCase();
    const f = { id: `f${i}`, label: labelFor(el), type: t };
    if (el.tagName === "SELECT") f.options = [...el.options].map((o) => o.text.trim()).filter(Boolean);
    if (t === "radio" || t === "checkbox") f.options = [el.value, labelFor(el)].filter(Boolean);
    return f;
  });

  banner(`Asking Studio to draft ${fields.length} field(s)… local models can take a minute.`);

  const resp = await chrome.runtime.sendMessage({
    type: "autofill",
    payload: {
      fields,
      url: location.href,
      title: document.title,
      pageText: document.body.innerText.slice(0, 3500),
    },
  });

  if (!resp?.ok) {
    banner(resp?.error || "Studio didn't answer — is it running?", "err");
    window.__studioFillRunning = false;
    return;
  }

  let filled = 0;
  for (const { id, value } of resp.values || []) {
    if (!value) continue;
    const el = document.querySelector(`[data-__studio-id="${id}"], [data-__studioid="${id}"]`) ||
               els.find((e) => e.dataset.__studioId === id);
    if (!el) continue;
    const t = (el.type || el.tagName).toLowerCase();
    if (el.tagName === "SELECT") {
      const opt = [...el.options].find((o) => o.text.trim().toLowerCase() === String(value).trim().toLowerCase());
      if (!opt) continue;
      el.value = opt.value;
    } else if (t === "checkbox" || t === "radio") {
      // Only check when the model returned an affirmative matching this control
      if (!/^(yes|true|checked|1)$/i.test(String(value)) && String(value).toLowerCase() !== el.value.toLowerCase()) continue;
      el.checked = true;
    } else {
      // React-friendly value setting
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      setter ? setter.call(el, value) : (el.value = value);
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.style.outline = "2px solid #d97757";
    el.style.outlineOffset = "1px";
    filled++;
  }

  banner(`Filled ${filled} of ${fields.length} field(s) — highlighted in orange. Review every one, fix the blanks, and submit it yourself. Nothing was sent.`);
  setTimeout(() => document.getElementById("__studio_banner")?.remove(), 12000);
  window.__studioFillRunning = false;
})();
