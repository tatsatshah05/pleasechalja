/* ================================================================
   WebSimplify – Background Service Worker (Manifest V3)
   Proxies rewrite requests to the Vercel backend.
   ================================================================ */

const API_URL = "https://websimplify-cloud.vercel.app/api/rewrite";

/* ---------- message handler ---------------------------------------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "REWRITE") {
    handleRewrite(msg.items)
      .then((items) => sendResponse({ items }))
      .catch((err) => sendResponse({ error: err.message }));
    return true; // keep channel open for async response
  }
});

/* ---------- rewrite proxy ------------------------------------------ */

async function handleRewrite(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Backend returned ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.items || [];
}
