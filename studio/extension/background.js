// Service worker — the only place that talks to the local Studio server.
// host_permissions covers localhost:4949, so no CORS games and the Studio
// server never has to open itself to arbitrary web pages.

const STUDIO = "http://localhost:4949";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "autofill") {
    fetch(`${STUDIO}/api/autofill`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(msg.payload),
    })
      .then((r) => r.json())
      .then((data) => sendResponse({ ok: !data.error, ...data }))
      .catch((e) => sendResponse({ ok: false, error: `Can't reach Studio at ${STUDIO} — is it running? (${e.message})` }));
    return true; // async response
  }
  if (msg.type === "status") {
    fetch(`${STUDIO}/api/status`)
      .then((r) => r.json())
      .then((s) => sendResponse({ ok: true, status: s }))
      .catch(() => sendResponse({ ok: false, error: "Studio is not running on localhost:4949" }));
    return true;
  }
});
