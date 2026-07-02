const status = document.getElementById("status");
const btn = document.getElementById("fill");

chrome.runtime.sendMessage({ type: "status" }, (r) => {
  if (r?.ok) {
    status.textContent = `Studio connected · model: ${r.status?.settings?.model || "none"}`;
    if (!r.status?.cv) { status.textContent += " · no resume saved yet"; status.className = "warn"; }
  } else {
    status.textContent = r?.error || "Studio not running (node studio/server.mjs)";
    status.className = "warn";
    btn.disabled = true;
  }
});

btn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  window.close();
});
