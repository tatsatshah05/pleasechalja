/* ================================================================
   WebSimplify – Popup Script
   Two buttons: Simplify & Restore. Per-tab state.
   ================================================================ */

const btnSimplify = document.getElementById("btn-simplify");
const btnRestore = document.getElementById("btn-restore");
const statusEl = document.getElementById("ws-status");

/* ---------- helpers ------------------------------------------------ */

function setStatus(text, type = "") {
  statusEl.textContent = text;
  statusEl.className = "ws-status" + (type ? ` ws-${type}` : "");
}

function setLoading(loading) {
  btnSimplify.disabled = loading;
  btnRestore.disabled = loading;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  return tab;
}

function sendToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

/* ---------- init: check current tab state -------------------------- */

(async () => {
  try {
    const tab = await getActiveTab();
    if (!tab?.id) return;

    const state = await sendToTab(tab.id, { type: "GET_STATE" });
    if (state?.simplified) {
      setStatus("Simplified", "success");
    }
  } catch {
    // Content script may not be injected yet – that's fine
  }
})();

/* ---------- Simplify ----------------------------------------------- */

btnSimplify.addEventListener("click", async () => {
  try {
    setLoading(true);
    setStatus("Simplifying…");

    const tab = await getActiveTab();
    if (!tab?.id) {
      setStatus("No active tab", "error");
      return;
    }

    const result = await sendToTab(tab.id, { type: "SIMPLIFY" });

    if (result?.status === "error") {
      setStatus(result.error || "Error", "error");
    } else if (result?.status === "already") {
      setStatus("Already simplified", "success");
    } else {
      setStatus("Simplified", "success");
    }
  } catch (err) {
    setStatus(err.message || "Error", "error");
  } finally {
    setLoading(false);
  }
});

/* ---------- Restore ------------------------------------------------ */

btnRestore.addEventListener("click", async () => {
  try {
    setLoading(true);
    setStatus("Restoring…");

    const tab = await getActiveTab();
    if (!tab?.id) {
      setStatus("No active tab", "error");
      return;
    }

    const result = await sendToTab(tab.id, { type: "RESTORE" });

    if (result?.status === "already") {
      setStatus("Already restored");
    } else {
      setStatus("Restored", "success");
    }
  } catch (err) {
    setStatus(err.message || "Error", "error");
  } finally {
    setLoading(false);
  }
});
