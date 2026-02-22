/* ================================================================
   WebSimplify – Content Script
   Handles: UI Skin, AI Rewrite, Reader Overlay, Restore
   ================================================================ */

(() => {
  "use strict";

  /* ---------- state ------------------------------------------------ */
  const STATE = {
    simplified: false,
    originalTexts: new Map(),   // node → original string
    originalStyles: new Map(),  // element → original inline styles
    mutationObserver: null,
    pendingNodes: new Set(),     // nodes waiting for rewrite
    readerOverlayEl: null,
    styleEl: null,
    toastEl: null,
    nextNodeId: 0,
  };

  /* ---------- constants -------------------------------------------- */
  const SKIP_TAGS = new Set([
    "INPUT", "TEXTAREA", "SELECT", "OPTION", "SCRIPT", "STYLE",
    "NOSCRIPT", "CODE", "PRE", "SVG", "CANVAS", "IFRAME", "VIDEO",
    "AUDIO", "IMG", "PICTURE", "SOURCE", "MAP", "AREA",
  ]);

  const MIN_TEXT_LEN = 20;      // skip short text nodes
  const BATCH_SIZE = 12;        // max items per API request
  const MAX_CHARS_PER_ITEM = 1200;
  const MAX_TOTAL_CHARS = 5000;

  /* ---------- helpers ---------------------------------------------- */

  function isEditable(node) {
    let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (el) {
      if (el.isContentEditable) return true;
      el = el.parentElement;
    }
    return false;
  }

  function isRewritable(textNode) {
    const parent = textNode.parentElement;
    if (!parent) return false;
    if (SKIP_TAGS.has(parent.tagName)) return false;
    let el = parent;
    while (el) {
      if (SKIP_TAGS.has(el.tagName)) return false;
      el = el.parentElement;
    }
    if (isEditable(textNode)) return false;
    const txt = textNode.textContent.trim();
    if (txt.length < MIN_TEXT_LEN) return false;
    return true;
  }

  function collectTextNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          return isRewritable(node)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      }
    );
    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
    }
    return nodes;
  }

  function escapeHTML(str) {
    const div = document.createElement("div");
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  /* ---------- Toast (floating status) ------------------------------- */

  function showToast(text, type = "info") {
    if (!STATE.toastEl) {
      STATE.toastEl = document.createElement("div");
      STATE.toastEl.id = "ws-status-toast";
      document.body.appendChild(STATE.toastEl);
    }
    const icon = type === "error" ? "!" :
                 type === "success" ? "\u2713" : "";
    const spinner = type === "info" ? '<div class="ws-spinner"></div>' : '';
    const iconHtml = icon ? `<span class="ws-toast-icon ws-toast-${type}">${icon}</span>` : '';
    STATE.toastEl.innerHTML = spinner + iconHtml + `<span>${escapeHTML(text)}</span>`;
    STATE.toastEl.className = "ws-toast-base";
    if (type === "error") STATE.toastEl.classList.add("ws-toast-err");
    // Force reflow then show
    void STATE.toastEl.offsetHeight;
    STATE.toastEl.classList.add("ws-visible");
  }

  function updateToast(text, type) {
    if (!STATE.toastEl) return showToast(text, type);
    if (type) return showToast(text, type);
    const span = STATE.toastEl.querySelector("span:last-child");
    if (span) span.textContent = text;
  }

  function hideToast(delay = 2500) {
    if (!STATE.toastEl) return;
    setTimeout(() => {
      if (STATE.toastEl) {
        STATE.toastEl.classList.remove("ws-visible");
        setTimeout(() => {
          if (STATE.toastEl) {
            STATE.toastEl.remove();
            STATE.toastEl = null;
          }
        }, 400);
      }
    }, delay);
  }

  /* ---------- UI Skin ----------------------------------------------- */

  const SKIN_CLASS = "ws-simplified";

  function buildSkinCSS() {
    return `
      /* ============================================================
         WebSimplify – Page Skin
         ============================================================ */

      /* --- Toast --- */
      .ws-toast-base {
        position: fixed !important;
        bottom: 24px !important;
        right: 24px !important;
        z-index: 2147483645 !important;
        background: #1e293b !important;
        color: #f1f5f9 !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif !important;
        font-size: 14px !important;
        font-weight: 500 !important;
        padding: 12px 20px !important;
        border-radius: 12px !important;
        box-shadow: 0 8px 30px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.08) !important;
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
        opacity: 0 !important;
        transform: translateY(12px) !important;
        transition: opacity 0.3s ease, transform 0.3s ease !important;
        pointer-events: none !important;
        line-height: 1.4 !important;
        letter-spacing: 0 !important;
        max-width: 400px !important;
      }

      .ws-toast-base.ws-visible {
        opacity: 1 !important;
        transform: translateY(0) !important;
      }

      .ws-toast-base.ws-toast-err {
        background: #7f1d1d !important;
        border: 1px solid #dc2626 !important;
      }

      .ws-toast-base .ws-spinner {
        width: 16px !important;
        height: 16px !important;
        border: 2px solid rgba(255,255,255,0.2) !important;
        border-top-color: #60a5fa !important;
        border-radius: 50% !important;
        animation: ws-spin 0.7s linear infinite !important;
        flex-shrink: 0 !important;
      }

      .ws-toast-icon {
        font-weight: 700 !important;
        font-size: 14px !important;
        flex-shrink: 0 !important;
      }

      .ws-toast-success { color: #4ade80 !important; }
      .ws-toast-error { color: #f87171 !important; }

      @keyframes ws-spin {
        to { transform: rotate(360deg); }
      }

      /* --- Page skin: readable, clean --- */
      body.ws-simplified {
        background-color: #fefefe !important;
        color: #222 !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif !important;
        line-height: 1.8 !important;
        word-spacing: 0.05em !important;
        letter-spacing: 0.01em !important;
      }

      @media (prefers-color-scheme: dark) {
        body.ws-simplified {
          background-color: #1a1a1a !important;
          color: #e0e0e0 !important;
        }
      }

      body.ws-simplified p,
      body.ws-simplified li,
      body.ws-simplified td,
      body.ws-simplified th,
      body.ws-simplified blockquote,
      body.ws-simplified dd {
        font-size: 1.05rem !important;
        line-height: 1.8 !important;
      }

      body.ws-simplified h1 { font-size: 1.8rem !important; line-height: 1.3 !important; margin-bottom: 0.75rem !important; }
      body.ws-simplified h2 { font-size: 1.45rem !important; line-height: 1.35 !important; margin-bottom: 0.6rem !important; }
      body.ws-simplified h3 { font-size: 1.2rem !important; line-height: 1.4 !important; margin-bottom: 0.5rem !important; }

      /* Better link visibility */
      body.ws-simplified a {
        text-decoration: underline !important;
        text-underline-offset: 3px !important;
      }

      /* Dim distracting elements */
      body.ws-simplified [class*="ad-"],
      body.ws-simplified [class*="ad_"],
      body.ws-simplified [class*="sidebar"],
      body.ws-simplified [class*="banner"],
      body.ws-simplified [class*="promo"],
      body.ws-simplified [class*="popup"],
      body.ws-simplified [class*="modal"],
      body.ws-simplified [id*="ad-"],
      body.ws-simplified [id*="ad_"],
      body.ws-simplified [id*="sidebar"],
      body.ws-simplified aside:not(main aside) {
        opacity: 0.15 !important;
        filter: grayscale(1) !important;
        transition: opacity 0.3s, filter 0.3s !important;
      }

      body.ws-simplified [class*="ad-"]:hover,
      body.ws-simplified [class*="ad_"]:hover,
      body.ws-simplified [class*="sidebar"]:hover,
      body.ws-simplified [class*="banner"]:hover,
      body.ws-simplified [class*="promo"]:hover,
      body.ws-simplified [class*="popup"]:hover,
      body.ws-simplified [class*="modal"]:hover,
      body.ws-simplified [id*="ad-"]:hover,
      body.ws-simplified [id*="ad_"]:hover,
      body.ws-simplified [id*="sidebar"]:hover,
      body.ws-simplified aside:not(main aside):hover {
        opacity: 1 !important;
        filter: none !important;
      }

      /* Kill animations */
      body.ws-simplified *,
      body.ws-simplified *::before,
      body.ws-simplified *::after {
        animation-duration: 0.001ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0s !important;
        scroll-behavior: auto !important;
      }

      /* Re-enable transitions on our own elements */
      body.ws-simplified .ws-toast-base,
      body.ws-simplified [class*="ad-"],
      body.ws-simplified [class*="sidebar"],
      body.ws-simplified [class*="banner"] {
        transition-duration: 0.3s !important;
      }

      /* Hide annoying overlays */
      body.ws-simplified [class*="cookie"],
      body.ws-simplified [class*="Cookie"],
      body.ws-simplified [class*="consent"],
      body.ws-simplified [id*="cookie"],
      body.ws-simplified marquee {
        display: none !important;
      }

      /* --- Rewritten text marker (very subtle) --- */
      .ws-rewritten-text {
        background: linear-gradient(to right, rgba(37, 99, 235, 0.08), transparent) !important;
        border-radius: 2px !important;
        padding: 2px 0 !important;
      }

      @media (prefers-color-scheme: dark) {
        .ws-rewritten-text {
          background: linear-gradient(to right, rgba(96, 165, 250, 0.1), transparent) !important;
        }
      }

      /* --- Skip-to-content link --- */
      #ws-skip-link {
        position: fixed !important;
        top: -100px !important;
        left: 1rem !important;
        z-index: 2147483647 !important;
        background: #2563eb !important;
        color: #fff !important;
        padding: 10px 20px !important;
        font-size: 14px !important;
        font-weight: 600 !important;
        border-radius: 0 0 8px 8px !important;
        text-decoration: none !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
        letter-spacing: 0 !important;
      }

      #ws-skip-link:focus {
        top: 0 !important;
        outline: 3px solid #f59e0b !important;
      }

      /* --- Reader overlay --- */
      #ws-reader-overlay {
        position: fixed !important;
        inset: 0 !important;
        z-index: 2147483646 !important;
        background: #fafafa !important;
        color: #1a1a1a !important;
        overflow-y: auto !important;
        padding: 3rem 1.5rem !important;
        font-family: Georgia, 'Times New Roman', serif !important;
        font-size: 1.1rem !important;
        line-height: 1.85 !important;
      }

      @media (prefers-color-scheme: dark) {
        #ws-reader-overlay {
          background: #18181b !important;
          color: #e4e4e7 !important;
        }
      }

      #ws-reader-overlay .ws-reader-inner {
        max-width: 680px !important;
        margin: 0 auto !important;
        padding-bottom: 6rem !important;
      }

      #ws-reader-overlay h1 {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif !important;
        font-size: 2rem !important;
        font-weight: 700 !important;
        margin-bottom: 1.5rem !important;
        line-height: 1.25 !important;
      }

      #ws-reader-overlay h2 {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif !important;
        font-size: 1.4rem !important;
        font-weight: 600 !important;
        margin: 2rem 0 0.75rem !important;
      }

      #ws-reader-overlay p,
      #ws-reader-overlay li {
        font-size: 1.1rem !important;
        margin-bottom: 1rem !important;
      }

      #ws-reader-overlay ul,
      #ws-reader-overlay ol {
        padding-left: 1.5em !important;
        margin-bottom: 1rem !important;
      }

      #ws-reader-overlay img {
        max-width: 100% !important;
        border-radius: 8px !important;
        margin: 1.5rem 0 !important;
      }

      #ws-reader-overlay a {
        color: #2563eb !important;
        text-decoration: underline !important;
      }

      @media (prefers-color-scheme: dark) {
        #ws-reader-overlay a { color: #60a5fa !important; }
      }

      #ws-reader-overlay .ws-reader-close {
        position: fixed !important;
        top: 16px !important;
        right: 20px !important;
        background: #18181b !important;
        color: #fff !important;
        border: none !important;
        width: 40px !important;
        height: 40px !important;
        border-radius: 50% !important;
        font-size: 18px !important;
        cursor: pointer !important;
        z-index: 2147483647 !important;
        box-shadow: 0 2px 12px rgba(0,0,0,0.15) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        padding: 0 !important;
        line-height: 1 !important;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif !important;
      }

      #ws-reader-overlay .ws-reader-close:hover {
        background: #2563eb !important;
      }
    `;
  }

  function applySkin() {
    if (STATE.styleEl) return;
    STATE.styleEl = document.createElement("style");
    STATE.styleEl.id = "ws-skin-styles";
    STATE.styleEl.textContent = buildSkinCSS();
    document.head.appendChild(STATE.styleEl);
    document.body.classList.add(SKIN_CLASS);

    // Skip-to-content link
    const mainTarget =
      document.querySelector("main") ||
      document.querySelector("[role='main']") ||
      document.querySelector("article") ||
      document.querySelector("#content") ||
      document.querySelector(".content");
    if (mainTarget) {
      if (!mainTarget.id) mainTarget.id = "ws-main-content";
      const skip = document.createElement("a");
      skip.id = "ws-skip-link";
      skip.href = "#" + mainTarget.id;
      skip.textContent = "Skip to main content";
      document.body.prepend(skip);
    }

    // Pause videos and audio
    document.querySelectorAll("video").forEach((v) => {
      v.pause();
      v.setAttribute("data-ws-was-playing", v.autoplay ? "1" : "0");
      v.autoplay = false;
    });
    document.querySelectorAll("audio").forEach((a) => {
      a.pause();
      a.setAttribute("data-ws-was-playing", a.autoplay ? "1" : "0");
      a.autoplay = false;
    });

    // Freeze animated GIFs
    document.querySelectorAll('img[src$=".gif"], img[src*=".gif?"]').forEach((img) => {
      if (img.dataset.wsOrigSrc) return;
      img.dataset.wsOrigSrc = img.src;
      try {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth || img.width || 200;
        c.height = img.naturalHeight || img.height || 200;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, c.width, c.height);
        img.src = c.toDataURL("image/png");
      } catch (_) { /* cross-origin */ }
    });

    // Ensure main landmark
    if (mainTarget && !mainTarget.getAttribute("role")) {
      mainTarget.setAttribute("role", "main");
    }
  }

  function removeSkin() {
    document.body.classList.remove(SKIN_CLASS);
    if (STATE.styleEl) {
      STATE.styleEl.remove();
      STATE.styleEl = null;
    }

    const skip = document.getElementById("ws-skip-link");
    if (skip) skip.remove();

    if (STATE.toastEl) {
      STATE.toastEl.remove();
      STATE.toastEl = null;
    }

    document.querySelectorAll("video[data-ws-was-playing]").forEach((v) => {
      if (v.dataset.wsWasPlaying === "1") v.autoplay = true;
      v.removeAttribute("data-ws-was-playing");
    });
    document.querySelectorAll("audio[data-ws-was-playing]").forEach((a) => {
      if (a.dataset.wsWasPlaying === "1") a.autoplay = true;
      a.removeAttribute("data-ws-was-playing");
    });

    document.querySelectorAll("img[data-ws-orig-src]").forEach((img) => {
      img.src = img.dataset.wsOrigSrc;
      delete img.dataset.wsOrigSrc;
    });

    // Remove rewritten markers
    document.querySelectorAll(".ws-rewritten-text").forEach((el) => {
      el.classList.remove("ws-rewritten-text");
    });

    const main = document.getElementById("ws-main-content");
    if (main) {
      main.removeAttribute("role");
      main.removeAttribute("id");
    }
  }

  /* ---------- Reader Overlay --------------------------------------- */

  function isArticleLike() {
    const inputs = document.querySelectorAll(
      'input, textarea, select, [contenteditable="true"]'
    ).length;
    const buttons = document.querySelectorAll("button, [role='button']").length;
    const forms = document.querySelectorAll("form").length;

    if (inputs > 5 || buttons > 20 || forms > 3) return false;

    const hasArticle = !!document.querySelector(
      "article, [itemtype*='Article'], [role='article']"
    );

    const main =
      document.querySelector("article") ||
      document.querySelector("[role='main']") ||
      document.querySelector("main") ||
      document.body;

    const textLen = (main.innerText || "").length;
    if (textLen < 500) return false;

    const interactiveCount = inputs + buttons + forms;
    if (interactiveCount > 0 && textLen / interactiveCount < 100) return false;

    return hasArticle || textLen > 1500;
  }

  function extractArticleContent() {
    const main =
      document.querySelector("article") ||
      document.querySelector("[role='main']") ||
      document.querySelector("main") ||
      document.querySelector(".post-content") ||
      document.querySelector(".entry-content") ||
      document.querySelector(".article-body") ||
      document.querySelector(".mw-parser-output");

    if (!main) return null;

    const title =
      document.querySelector("h1")?.innerText ||
      document.title || "";

    const clone = main.cloneNode(true);
    clone.querySelectorAll("script, style, nav, form, iframe, [role='navigation']")
      .forEach((el) => el.remove());

    return { title, html: clone.innerHTML };
  }

  function showReaderOverlay(content) {
    if (STATE.readerOverlayEl) return;

    const overlay = document.createElement("div");
    overlay.id = "ws-reader-overlay";
    overlay.innerHTML = `
      <button class="ws-reader-close" aria-label="Close reader view">\u00D7</button>
      <div class="ws-reader-inner">
        <h1>${escapeHTML(content.title)}</h1>
        ${content.html}
      </div>
    `;

    overlay.querySelector(".ws-reader-close").addEventListener("click", () => {
      removeReaderOverlay();
    });

    document.body.appendChild(overlay);
    STATE.readerOverlayEl = overlay;
  }

  function removeReaderOverlay() {
    if (STATE.readerOverlayEl) {
      STATE.readerOverlayEl.remove();
      STATE.readerOverlayEl = null;
    }
  }

  /* ---------- AI Rewrite ------------------------------------------- */

  async function rewriteViaBackground(items) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "REWRITE", items },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response && response.error) {
            reject(new Error(response.error));
            return;
          }
          resolve(response?.items || []);
        }
      );
    });
  }

  async function rewriteTextNodes(nodes) {
    if (nodes.length === 0) return;

    const items = [];
    const nodeMap = new Map();

    for (const node of nodes) {
      if (STATE.originalTexts.has(node)) continue;

      const text = node.textContent.trim();
      if (text.length < MIN_TEXT_LEN) continue;

      const id = String(STATE.nextNodeId++);
      const truncated = text.slice(0, MAX_CHARS_PER_ITEM);

      STATE.originalTexts.set(node, node.textContent);
      items.push({ id, text: truncated });
      nodeMap.set(id, node);
    }

    if (items.length === 0) return;

    // Chunk into batches
    const batches = [];
    let batch = [];
    let batchChars = 0;

    for (const item of items) {
      if (
        batch.length >= BATCH_SIZE ||
        batchChars + item.text.length > MAX_TOTAL_CHARS
      ) {
        batches.push(batch);
        batch = [];
        batchChars = 0;
      }
      batch.push(item);
      batchChars += item.text.length;
    }
    if (batch.length > 0) batches.push(batch);

    let successCount = 0;
    let errorMsg = null;

    for (let i = 0; i < batches.length; i++) {
      const b = batches[i];
      updateToast(`Simplifying text (${i + 1}/${batches.length})...`);

      try {
        const results = await rewriteViaBackground(b);
        for (const r of results) {
          const node = nodeMap.get(r.id);
          if (node && r.text && node.parentElement) {
            node.textContent = r.text;
            // Add subtle marker to the parent element
            node.parentElement.classList.add("ws-rewritten-text");
            successCount++;
          }
        }
      } catch (err) {
        console.warn("[WebSimplify] Rewrite batch failed:", err.message);
        errorMsg = err.message;
      }
    }

    return { successCount, errorMsg };
  }

  /* ---------- MutationObserver ------------------------------------- */

  let mutationTimer = null;

  function startObserving() {
    if (STATE.mutationObserver) return;

    STATE.mutationObserver = new MutationObserver((mutations) => {
      if (!STATE.simplified) return;

      for (const m of mutations) {
        for (const added of m.addedNodes) {
          if (added.nodeType === Node.ELEMENT_NODE) {
            const nodes = collectTextNodes(added);
            nodes.forEach((n) => STATE.pendingNodes.add(n));
          } else if (
            added.nodeType === Node.TEXT_NODE &&
            isRewritable(added)
          ) {
            STATE.pendingNodes.add(added);
          }
        }
      }

      if (STATE.pendingNodes.size > 0 && !mutationTimer) {
        mutationTimer = setTimeout(async () => {
          const nodes = [...STATE.pendingNodes];
          STATE.pendingNodes.clear();
          mutationTimer = null;
          await rewriteTextNodes(nodes);
        }, 800);
      }
    });

    STATE.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function stopObserving() {
    if (STATE.mutationObserver) {
      STATE.mutationObserver.disconnect();
      STATE.mutationObserver = null;
    }
    if (mutationTimer) {
      clearTimeout(mutationTimer);
      mutationTimer = null;
    }
    STATE.pendingNodes.clear();
  }

  /* ---------- Simplify / Restore ----------------------------------- */

  async function simplify() {
    if (STATE.simplified) return { status: "already" };

    STATE.simplified = true;

    // 1) Apply skin
    applySkin();

    // 2) Show progress
    showToast("Simplifying page...", "info");

    // 3) Collect text nodes
    const textNodes = collectTextNodes(document.body);

    if (textNodes.length === 0) {
      updateToast("Page simplified (no text to rewrite).", "success");
      hideToast(2000);
      return { status: "simplified" };
    }

    // 4) Observe for dynamic content
    startObserving();

    // 5) Rewrite text
    const result = await rewriteTextNodes(textNodes);

    // 6) Reader overlay for article-like pages
    if (isArticleLike()) {
      const content = extractArticleContent();
      if (content) {
        showReaderOverlay(content);
      }
    }

    // 7) Show result
    if (result?.errorMsg) {
      updateToast("API error: " + result.errorMsg, "error");
      hideToast(5000);
    } else if (result?.successCount > 0) {
      updateToast(`Simplified ${result.successCount} text blocks.`, "success");
      hideToast(2500);
    } else {
      updateToast("Done! Page cleaned up.", "success");
      hideToast(2000);
    }

    return { status: "simplified" };
  }

  function restore() {
    if (!STATE.simplified) return { status: "already" };

    stopObserving();

    for (const [node, originalText] of STATE.originalTexts) {
      if (node.parentElement) {
        node.textContent = originalText;
      }
    }
    STATE.originalTexts.clear();
    STATE.nextNodeId = 0;

    removeReaderOverlay();
    removeSkin();

    STATE.simplified = false;
    return { status: "restored" };
  }

  /* ---------- Message listener ------------------------------------- */

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "SIMPLIFY") {
      simplify()
        .then((r) => sendResponse(r))
        .catch((e) => {
          showToast("Error: " + e.message, "error");
          hideToast(5000);
          sendResponse({ status: "error", error: e.message });
        });
      return true;
    }
    if (msg.type === "RESTORE") {
      sendResponse(restore());
    }
    if (msg.type === "GET_STATE") {
      sendResponse({ simplified: STATE.simplified });
    }
  });
})();
