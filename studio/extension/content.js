// Injected on demand (popup button → chrome.scripting). Scrapes the visible
// form fields on the application page, asks Studio (local server + local
// model) for grounded values, fills them TYPE-AWARE, and highlights what it
// touched:  orange = filled, amber dashed = needs you (consent boxes, file
// uploads, fields Studio had no grounded answer for).
//
// Understands: text/email/tel/url/number/date inputs, textareas, native
// selects, radio groups, checkboxes, and CUSTOM COMBOBOXES (Greenhouse /
// react-select style "Select..." widgets) — those are opened, their real
// options harvested, and the matching option is clicked like a human would.
//
// HARD RULES: it never clicks submit, never checks a consent/certification
// box, and leaves unknowns empty. The human reviews.

(async function studioFill() {
  if (window.__studioFillRunning) return;
  window.__studioFillRunning = true;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

  const labelFor = (el) => {
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return clean(l.textContent).slice(0, 200);
    }
    const aria = el.getAttribute("aria-labelledby");
    if (aria) {
      const t = aria.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ");
      if (clean(t)) return clean(t).slice(0, 200);
    }
    return clean(
      el.getAttribute("aria-label") ||
      el.closest("label")?.textContent ||
      el.placeholder ||
      el.closest("fieldset")?.querySelector("legend")?.textContent ||
      el.closest("div")?.querySelector("label, .label, legend")?.textContent ||
      el.name || ""
    ).slice(0, 200);
  };

  const CONSENT = /agree|consent|acknowledge|certify|terms|privacy|signature|accurate|confirm that/i;

  const mark = (el, tone) => {
    const t = el.closest('[class*="select__control"], [class*="select-shell"]') || el;
    t.style.outline = tone === "attention" ? "2px dashed #b8860b" : "2px solid #d97757";
    t.style.outlineOffset = "1px";
  };

  const isCombobox = (el) =>
    el.tagName === "INPUT" && (
      el.getAttribute("role") === "combobox" ||
      !!el.getAttribute("aria-autocomplete") ||
      el.getAttribute("aria-haspopup") === "listbox" ||
      !!el.closest('[class*="select__control"], [class*="combobox"], [class*="select-shell"], [class*="autocomplete"]')
    );

  // React/Vue-controlled inputs and phone widgets (intl-tel-input) only
  // register values that arrive like real typing: focus → native setter →
  // input/keyup → change → blur.
  const setNativeValue = (el, value) => {
    el.focus();
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter ? setter.call(el, value) : (el.value = value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const settle = (el) => {
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  };

  const humanClick = (el) => {
    for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
  };

  const listboxOptions = () =>
    [...document.querySelectorAll('[role="option"], [class*="select__option"]')]
      .filter(visible)
      .filter((o, i, arr) => arr.findIndex((x) => x === o || x.contains(o)) === i);

  // Many widgets TOGGLE on click — always check whether a listbox is already
  // showing before clicking, or an "open" can close it (verified in testing).
  const openCombo = async (el) => {
    el.scrollIntoView({ block: "center" });
    el.focus();
    let opts = listboxOptions();
    if (!opts.length) { humanClick(el); await sleep(350); opts = listboxOptions(); }
    if (!opts.length) {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      await sleep(250);
      opts = listboxOptions();
    }
    return opts;
  };
  const closeCombo = async (el) => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(120);
    if (listboxOptions().length) { humanClick(el); await sleep(120); }  // toggle-style close
    if (listboxOptions().length) { humanClick(document.body); await sleep(120); } // click-away close
    el.blur();
  };

  // ── Collect fields, type-aware ─────────────────────────────────────
  const all = [...document.querySelectorAll("input, textarea, select")].filter(visible);
  const fields = [];
  const controls = new Map();
  const attention = [];
  const radioGroups = new Map();
  const fileTargets = [];
  let fid = 0;
  let hasFileField = false;

  for (const el of all) {
    const t = (el.type || el.tagName).toLowerCase();
    if (["hidden", "submit", "button", "image", "reset", "password", "search"].includes(t)) continue;

    if (t === "file") {
      const label = labelFor(el);
      if (/resume|\bcv\b/i.test(label) && !/cover/i.test(label)) {
        fileTargets.push(el); // auto-attach the tailored PDF below
      } else {
        mark(el, "attention");
        attention.push(`file upload “${label.slice(0, 40)}” — attach it yourself`);
      }
      hasFileField = true;
      continue;
    }
    if (t === "radio") {
      const key = el.name || labelFor(el);
      (radioGroups.get(key) || radioGroups.set(key, []).get(key)).push(el);
      continue;
    }
    if (t === "checkbox") {
      const label = labelFor(el);
      if (CONSENT.test(label)) {
        mark(el, "attention");
        attention.push(`consent box: “${label.slice(0, 50)}…” — read and tick it yourself`);
        continue;
      }
      const id = `f${fid++}`;
      fields.push({ id, label, type: "checkbox" });
      controls.set(id, { kind: "checkbox", el });
      continue;
    }

    const id = `f${fid++}`;
    if (el.tagName === "SELECT") {
      const options = [...el.options].map((o) => clean(o.text)).filter((x) => x && !/^(select|choose|please|--)/i.test(x)).slice(0, 60);
      fields.push({ id, label: labelFor(el), type: "select", options });
      controls.set(id, { kind: "select", el });
    } else if (isCombobox(el)) {
      banner(`Reading dropdown options… (${fields.length + 1})`);
      const opts = await openCombo(el);
      const texts = opts.map((o) => clean(o.textContent)).filter(Boolean).slice(0, 60);
      await closeCombo(el);
      if (texts.length) {
        fields.push({ id, label: labelFor(el), type: "select", options: texts });
        controls.set(id, { kind: "combobox", el });
      } else {
        fields.push({ id, label: labelFor(el), type: t });
        controls.set(id, { kind: "text", el });
      }
    } else {
      fields.push({ id, label: labelFor(el), type: t });
      controls.set(id, { kind: "text", el });
    }
  }

  // Button/div-triggered dropdowns (Greenhouse's new design system renders
  // "Country" etc. as a button that opens a listbox, with no input at all).
  const triggers = [...document.querySelectorAll('button[aria-haspopup="listbox"], [role="combobox"]:not(input):not(select)')]
    .filter(visible)
    .filter((el) => !el.querySelector("input, select"));
  for (const el of triggers) {
    banner(`Reading dropdown options… (${fields.length + 1})`);
    const opts = await openCombo(el);
    const texts = opts.map((o) => clean(o.textContent)).filter(Boolean).slice(0, 80);
    await closeCombo(el);
    if (!texts.length) continue;
    const id = `f${fid++}`;
    fields.push({ id, label: labelFor(el), type: "select", options: texts });
    controls.set(id, { kind: "trigger", el });
  }

  for (const [name, radios] of radioGroups) {
    const id = `f${fid++}`;
    const groupLabel = radios[0].closest("fieldset")?.querySelector("legend")?.textContent.trim()
      || labelFor(radios[0].closest("fieldset, div") || radios[0]) || name;
    const options = radios.map((r) =>
      clean(r.closest("label")?.textContent || document.querySelector(`label[for="${CSS.escape(r.id)}"]`)?.textContent || r.value).slice(0, 80)
    );
    fields.push({ id, label: clean(groupLabel).slice(0, 200), type: "radio", options });
    controls.set(id, { kind: "radio", radios, options });
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
  const norm = (s) => clean(s).toLowerCase();
  const bestOption = (texts, value) => {
    let i = texts.findIndex((t) => norm(t) === norm(value));
    if (i < 0) i = texts.findIndex((t) => norm(t).includes(norm(value)) || norm(value).includes(norm(t)));
    return i;
  };

  let filled = 0, skipped = 0;
  for (const { id, value, blocked } of resp.values || []) {
    const ctl = controls.get(id);
    if (!ctl) continue;
    if (!value) {
      const target = ctl.el || ctl.radios?.[0];
      if (blocked && target) { mark(target, "attention"); attention.push(blocked); }
      skipped++;
      continue;
    }

    if (ctl.kind === "select") {
      const opts = [...ctl.el.options];
      const i = bestOption(opts.map((o) => o.text), value);
      if (i < 0) { mark(ctl.el, "attention"); skipped++; continue; }
      ctl.el.value = opts[i].value;
      ctl.el.dispatchEvent(new Event("change", { bubbles: true }));
      ctl.el.dispatchEvent(new Event("blur", { bubbles: true }));
      mark(ctl.el); filled++;

    } else if (ctl.kind === "combobox" || ctl.kind === "trigger") {
      // Open, click the matching option, then VERIFY the widget actually took
      // it (the real-world failure mode is text sitting in the box with no
      // selection registered). Fallbacks: type-then-click, then type+Enter.
      const chosenOk = () => {
        const shown = norm(ctl.kind === "trigger" ? ctl.el.textContent : (ctl.el.value || ctl.el.textContent));
        return shown && (shown.includes(norm(value)) || norm(value).includes(shown));
      };
      let opts = await openCombo(ctl.el);
      let i = bestOption(opts.map((o) => o.textContent), value);
      let picked = null;
      if (i >= 0) picked = opts[i].textContent;
      if (i < 0 && ctl.kind === "combobox") {
        setNativeValue(ctl.el, value);
        await sleep(450);
        opts = listboxOptions();
        i = bestOption(opts.map((o) => o.textContent), value);
        if (i >= 0) picked = opts[i].textContent;
      }
      if (i >= 0) {
        humanClick(opts[i]);
        await sleep(250);
      }
      if (i >= 0 && !chosenOk() && ctl.kind === "combobox") {
        // last resort: retype and commit with Enter (react-select pattern)
        await openCombo(ctl.el);
        setNativeValue(ctl.el, picked);
        await sleep(350);
        ctl.el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        await sleep(250);
      }
      if (i >= 0 && (chosenOk() || ctl.kind === "trigger")) {
        settle(ctl.el);
        mark(ctl.el); filled++;
      } else {
        if (ctl.kind === "combobox") setNativeValue(ctl.el, "");
        await closeCombo(ctl.el);
        mark(ctl.el, "attention");
        attention.push(`couldn't lock in “${value}” for “${labelFor(ctl.el).slice(0, 40)}” — pick it manually`);
        skipped++;
      }

    } else if (ctl.kind === "radio") {
      const i = bestOption(ctl.options, value);
      if (i < 0) { skipped++; continue; }
      ctl.radios[i].click();
      mark(ctl.radios[i]); filled++;

    } else if (ctl.kind === "checkbox") {
      if (!/^(yes|true|checked|1)$/i.test(String(value))) { skipped++; continue; }
      if (!ctl.el.checked) ctl.el.click();
      mark(ctl.el); filled++;

    } else {
      setNativeValue(ctl.el, value);
      settle(ctl.el);
      mark(ctl.el); filled++;
    }
  }

  // ── Attach the tailored PDF to Resume/CV upload fields ─────────────
  if (fileTargets.length) {
    banner("Attaching your tailored PDF…");
    const pdf = await chrome.runtime.sendMessage({ type: "resume-pdf", q: document.title.split(/[-–|]/)[1] || "" });
    for (const el of fileTargets) {
      if (pdf?.ok && pdf.b64) {
        try {
          const bytes = Uint8Array.from(atob(pdf.b64), (c) => c.charCodeAt(0));
          const file = new File([bytes], pdf.file, { type: "application/pdf" });
          const dt = new DataTransfer();
          dt.items.add(file);
          el.files = dt.files;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          mark(el); filled++;
          attention.push(`attached ${pdf.file} — confirm it's the right version for THIS job`);
          continue;
        } catch { /* fall through to manual */ }
      }
      mark(el, "attention");
      attention.push("resume upload — generate a tailored PDF in Studio first, then attach from output/");
    }
  }

  // ── Validation sweep: surface anything the page still flags ────────
  await sleep(500);
  let invalid = 0;
  for (const ctl of controls.values()) {
    const el = ctl.el || ctl.radios?.[0];
    if (el?.getAttribute("aria-invalid") === "true") { mark(el, "attention"); invalid++; }
  }

  const parts = [`Filled ${filled} of ${fields.length} field(s).`];
  if (invalid) parts.push(`${invalid} still flagged invalid by the page — click into those and confirm.`);
  if (attention.length) parts.push(`${attention.length} note(s): ${attention.slice(0, 2).join("; ")}${attention.length > 2 ? "…" : ""}`);
  parts.push("Review everything — nothing was submitted.");
  banner(parts.join(" "));
  setTimeout(() => document.getElementById("__studio_banner")?.remove(), 18000);
  window.__studioFillRunning = false;
})();
