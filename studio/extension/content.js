// Injected on demand (popup button → chrome.scripting). Scrapes the visible
// form fields on the application page, asks Studio (local server + local
// model) for grounded values, fills them TYPE-AWARE, and highlights what it
// touched:  orange = filled, amber dashed = needs you (consent boxes, file
// uploads, fields Studio had no grounded answer for).
//
// HARD RULES: it never clicks buttons, never submits, never checks a
// consent/certification box, and leaves unknowns empty. The human reviews.

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
        background: "#1f1e1d", color: "#faf9f5",
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
      if (l) return l.textContent.trim().replace(/\s+/g, " ").slice(0, 160);
    }
    return (
      el.getAttribute("aria-label") ||
      el.closest("label")?.textContent.trim() ||
      el.placeholder ||
      el.closest("fieldset")?.querySelector("legend")?.textContent.trim() ||
      el.closest("div")?.querySelector("label, .label, legend")?.textContent.trim() ||
      el.name || ""
    ).replace(/\s+/g, " ").slice(0, 160);
  };

  const CONSENT = /agree|consent|acknowledge|certify|terms|privacy|signature|accurate|confirm that/i;

  const mark = (el, tone) => {
    el.style.outline = tone === "attention" ? "2px dashed #b8860b" : "2px solid #d97757";
    el.style.outlineOffset = "1px";
  };

  // ── Collect fields, type-aware ─────────────────────────────────────
  const all = [...document.querySelectorAll("input, textarea, select")].filter(visible);
  const fields = [];           // sent to Studio
  const controls = new Map();  // field id → {kind, el | radios[] | boxes[]}
  const attention = [];        // things the human must do
  const radioGroups = new Map();
  const checkboxGroups = new Map();
  let fid = 0;

  for (const el of all) {
    const t = (el.type || el.tagName).toLowerCase();
    if (["hidden", "submit", "button", "image", "reset", "password"].includes(t)) continue;

    if (t === "file") {
      mark(el, "attention");
      attention.push("resume/file upload — attach your tailored PDF from Studio's output/ folder");
      continue;
    }
    if (t === "radio") {
      const key = el.name || labelFor(el);
      if (!radioGroups.has(key)) radioGroups.set(key, []);
      radioGroups.get(key).push(el);
      continue;
    }
    if (t === "checkbox") {
      const key = el.name || `cb-${fid}`;
      if (!checkboxGroups.has(key)) checkboxGroups.set(key, []);
      checkboxGroups.get(key).push(el);
      continue;
    }

    const id = `f${fid++}`;
    const f = { id, label: labelFor(el), type: el.tagName === "SELECT" ? "select" : t };
    if (el.tagName === "SELECT") {
      f.options = [...el.options].map((o) => o.text.trim()).filter((x) => x && !/^(select|choose|please|--)/i.test(x)).slice(0, 60);
    }
    fields.push(f);
    controls.set(id, { kind: f.type, el });
  }

  // Radio groups → one field each, options = the radios' own labels.
  for (const [name, radios] of radioGroups) {
    const id = `f${fid++}`;
    const groupLabel = radios[0].closest("fieldset")?.querySelector("legend")?.textContent.trim()
      || labelFor(radios[0].closest("fieldset, div") || radios[0]) || name;
    const options = radios.map((r) => {
      const l = r.closest("label")?.textContent.trim() || document.querySelector(`label[for="${CSS.escape(r.id)}"]`)?.textContent.trim() || r.value;
      return l.replace(/\s+/g, " ").slice(0, 80);
    });
    fields.push({ id, label: groupLabel.replace(/\s+/g, " ").slice(0, 160), type: "radio", options });
    controls.set(id, { kind: "radio", radios, options });
  }

  // Checkboxes: consent-like are NEVER auto-checked — flag them instead.
  for (const [, boxes] of checkboxGroups) {
    for (const box of boxes) {
      const label = labelFor(box);
      if (CONSENT.test(label)) {
        mark(box, "attention");
        attention.push(`consent box: “${label.slice(0, 60)}…” — read and tick it yourself`);
        continue;
      }
      const id = `f${fid++}`;
      fields.push({ id, label, type: "checkbox" });
      controls.set(id, { kind: "checkbox", el: box });
    }
  }

  if (!fields.length && !attention.length) {
    banner("No form fields found on this page.", "err");
    window.__studioFillRunning = false;
    return;
  }

  banner(`Asking Studio to draft ${fields.length} field(s)… local models can take a minute.`);

  const resp = await chrome.runtime.sendMessage({
    type: "autofill",
    payload: { fields, url: location.href, title: document.title, pageText: document.body.innerText.slice(0, 3500) },
  });

  if (!resp?.ok) {
    banner(resp?.error || "Studio didn't answer — is it running?", "err");
    window.__studioFillRunning = false;
    return;
  }

  // ── Fill, respecting each control's type ───────────────────────────
  const setNativeValue = (el, value) => {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter ? setter.call(el, value) : (el.value = value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const norm = (s) => String(s).trim().toLowerCase();

  let filled = 0, skipped = 0;
  for (const { id, value, blocked } of resp.values || []) {
    const ctl = controls.get(id);
    if (!ctl) continue;
    if (!value) {
      if (blocked && ctl.el) { mark(ctl.el, "attention"); attention.push(blocked); }
      skipped++;
      continue;
    }
    if (ctl.kind === "select") {
      const opts = [...ctl.el.options];
      const opt = opts.find((o) => norm(o.text) === norm(value)) || opts.find((o) => norm(o.text).includes(norm(value)) || norm(value).includes(norm(o.text)));
      if (!opt) { skipped++; continue; }
      ctl.el.value = opt.value;
      ctl.el.dispatchEvent(new Event("change", { bubbles: true }));
      mark(ctl.el); filled++;
    } else if (ctl.kind === "radio") {
      const i = ctl.options.findIndex((o) => norm(o) === norm(value)) ?? -1;
      const j = i >= 0 ? i : ctl.options.findIndex((o) => norm(o).includes(norm(value)) || norm(value).includes(norm(o)));
      if (j < 0) { skipped++; continue; }
      ctl.radios[j].click();
      mark(ctl.radios[j]); filled++;
    } else if (ctl.kind === "checkbox") {
      if (!/^(yes|true|checked|1)$/i.test(String(value))) { skipped++; continue; }
      if (!ctl.el.checked) ctl.el.click();
      mark(ctl.el); filled++;
    } else {
      setNativeValue(ctl.el, value);
      mark(ctl.el); filled++;
    }
  }

  const parts = [`Filled ${filled} of ${fields.length} field(s).`];
  if (attention.length) parts.push(`${attention.length} need you (amber): ${attention.slice(0, 2).join("; ")}${attention.length > 2 ? "…" : ""}`);
  parts.push("Review everything — nothing was submitted.");
  banner(parts.join(" "));
  setTimeout(() => document.getElementById("__studio_banner")?.remove(), 15000);
  window.__studioFillRunning = false;
})();
