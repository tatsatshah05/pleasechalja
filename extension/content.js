/* ================================================================
   WebSimplify – Content Script
   Handles: Minimal UI Skin, AI Rewrite, Reader Overlay, Restore
   ================================================================ */

(() => {
  "use strict";

  /* ---------- state ------------------------------------------------ */
  const STATE = {
    simplified: false,
    originalTexts: new Map(),   // node → original string
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

  /** True if the node or any ancestor is contenteditable */
  function isEditable(node) {
    let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (el) {
      if (el.isContentEditable) return true;
      el = el.parentElement;
    }
    return false;
  }

  /** True if a text node should be rewritten */
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

  /** Collect rewritable text nodes from a root */
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

  /* ---------- Toast (floating status) ------------------------------- */

  function showToast(text, showSpinner = false) {
    if (!STATE.toastEl) {
      STATE.toastEl = document.createElement("div");
      STATE.toastEl.id = "ws-status-toast";
      document.body.appendChild(STATE.toastEl);
    }
    STATE.toastEl.innerHTML =
      (showSpinner ? '<div class="ws-spinner"></div>' : '') +
      `<span>${escapeHTML(text)}</span>`;
    // Force reflow then show
    void STATE.toastEl.offsetHeight;
    STATE.toastEl.classList.add("ws-visible");
  }

  function updateToast(text) {
    if (!STATE.toastEl) return;
    const span = STATE.toastEl.querySelector("span");
    if (span) span.textContent = text;
  }

  function hideToast(delay = 2000) {
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

  /* ---------- Minimal UI Skin --------------------------------------- */

  const SKIN_CLASS = "ws-simplified";

  function buildSkinCSS() {
    return `
      /* ============================================================
         WebSimplify – Clean Minimal Skin
         ============================================================ */

      /* --- Floating status toast --- */
      #ws-status-toast {
        position: fixed !important;
        bottom: 24px !important;
        right: 24px !important;
        z-index: 2147483645 !important;
        background: #1e293b !important;
        color: #f1f5f9 !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif !important;
        font-size: 13px !important;
        font-weight: 500 !important;
        padding: 10px 18px !important;
        border-radius: 10px !important;
        box-shadow: 0 8px 30px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.08) !important;
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
        opacity: 0 !important;
        transform: translateY(12px) !important;
        transition: opacity 0.3s ease, transform 0.3s ease !important;
        pointer-events: none !important;
        line-height: 1.4 !important;
        letter-spacing: 0 !important;
      }

      #ws-status-toast.ws-visible {
        opacity: 1 !important;
        transform: translateY(0) !important;
      }

      #ws-status-toast .ws-spinner {
        width: 14px !important;
        height: 14px !important;
        border: 2px solid rgba(255,255,255,0.15) !important;
        border-top-color: #60a5fa !important;
        border-radius: 50% !important;
        animation: ws-spin 0.7s linear infinite !important;
        flex-shrink: 0 !important;
      }

      @keyframes ws-spin {
        to { transform: rotate(360deg); }
      }

      /* --- Page-level simplification tweaks --- */
      body.ws-simplified {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        line-height: 1.7 !important;
        word-spacing: 0.05em !important;
      }

      body.ws-simplified p,
      body.ws-simplified li,
      body.ws-simplified td,
      body.ws-simplified th,
      body.ws-simplified span,
      body.ws-simplified div {
        line-height: 1.7 !important;
      }

      /* Reduce visual clutter: dim ads, sidebars, banners */
      body.ws-simplified [class*="ad-"],
      body.ws-simplified [class*="sidebar"],
      body.ws-simplified [class*="banner"],
      body.ws-simplified [class*="promo"],
      body.ws-simplified [id*="ad-"],
      body.ws-simplified [id*="sidebar"],
      body.ws-simplified aside:not(main aside) {
        opacity: 0.3 !important;
        transition: opacity 0.2s !important;
      }

      body.ws-simplified [class*="ad-"]:hover,
      body.ws-simplified [class*="sidebar"]:hover,
      body.ws-simplified [class*="banner"]:hover,
      body.ws-simplified [class*="promo"]:hover,
      body.ws-simplified [id*="ad-"]:hover,
      body.ws-simplified [id*="sidebar"]:hover,
      body.ws-simplified aside:not(main aside):hover {
        opacity: 1 !important;
      }

      /* Kill animations */
      body.ws-simplified *,
      body.ws-simplified *::before,
      body.ws-simplified *::after {
        animation-duration: 0.001ms !important;
        animation-iteration-count: 1 !important;
        scroll-behavior: auto !important;
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
        letter-spacing: 0.01em !important;
        word-spacing: 0.02em !important;
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
        color: inherit !important;
        letter-spacing: -0.02em !important;
      }

      #ws-reader-overlay h2 {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif !important;
        font-size: 1.4rem !important;
        font-weight: 600 !important;
        margin: 2rem 0 0.75rem !important;
        color: inherit !important;
      }

      #ws-reader-overlay h3 {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif !important;
        font-size: 1.15rem !important;
        font-weight: 600 !important;
        margin: 1.5rem 0 0.5rem !important;
        color: inherit !important;
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
        #ws-reader-overlay a {
          color: #60a5fa !important;
        }
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
        font-weight: 400 !important;
        cursor: pointer !important;
        z-index: 2147483647 !important;
        box-shadow: 0 2px 12px rgba(0,0,0,0.15) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        transition: background 0.15s ease !important;
        padding: 0 !important;
        line-height: 1 !important;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif !important;
      }

      @media (prefers-color-scheme: dark) {
        #ws-reader-overlay .ws-reader-close {
          background: #3f3f46 !important;
        }
      }

      #ws-reader-overlay .ws-reader-close:hover {
        background: #2563eb !important;
      }

      #ws-reader-overlay .ws-reader-close:focus-visible {
        outline: 3px solid #f59e0b !important;
        outline-offset: 3px !important;
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

    // --- DOM-level accessibility enhancements ---

    // 1. Skip-to-content link
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
      skip.setAttribute("role", "link");
      document.body.prepend(skip);
    }

    // 2. Pause all videos and auto-playing media
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

    // 3. Replace animated GIFs with static version (canvas snapshot)
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
      } catch (_) {
        // cross-origin images can't be snapshotted
      }
    });

    // 4. Ensure main landmark exists
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

    // Remove skip link
    const skip = document.getElementById("ws-skip-link");
    if (skip) skip.remove();

    // Remove toast
    if (STATE.toastEl) {
      STATE.toastEl.remove();
      STATE.toastEl = null;
    }

    // Restore videos
    document.querySelectorAll("video[data-ws-was-playing]").forEach((v) => {
      if (v.dataset.wsWasPlaying === "1") v.autoplay = true;
      v.removeAttribute("data-ws-was-playing");
    });
    document.querySelectorAll("audio[data-ws-was-playing]").forEach((a) => {
      if (a.dataset.wsWasPlaying === "1") a.autoplay = true;
      a.removeAttribute("data-ws-was-playing");
    });

    // Restore GIFs
    document.querySelectorAll("img[data-ws-orig-src]").forEach((img) => {
      img.src = img.dataset.wsOrigSrc;
      delete img.dataset.wsOrigSrc;
    });

    // Remove added role=main
    const main = document.getElementById("ws-main-content");
    if (main) {
      main.removeAttribute("role");
      main.removeAttribute("id");
    }
  }

  /* ---------- Reader Overlay --------------------------------------- */

  /** Heuristic: is this page article-like? */
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

  /** Extract main content for reader overlay */
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
      document.title ||
      "";

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

  function escapeHTML(str) {
    const div = document.createElement("div");
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
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

  /** Batch-rewrite collected text nodes */
  async function rewriteTextNodes(nodes) {
    if (nodes.length === 0) return;

    // Assign IDs and save originals
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

    // Process batches
    for (let i = 0; i < batches.length; i++) {
      const b = batches[i];
      updateToast(`Simplifying text (${i + 1}/${batches.length})...`);

      try {
        const results = await rewriteViaBackground(b);
        for (const r of results) {
          const node = nodeMap.get(r.id);
          if (node && r.text && node.parentElement) {
            node.textContent = r.text;
          }
        }
      } catch (err) {
        console.warn("[WebSimplify] Rewrite batch failed:", err.message);
      }
    }
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

    // 1) Apply minimal skin (inject CSS + a11y enhancements)
    applySkin();

    // 2) Show progress toast
    showToast("Simplifying page...", true);

    // 3) Collect text nodes for AI rewrite
    const textNodes = collectTextNodes(document.body);

    // 4) Start MutationObserver for dynamic content
    startObserving();

    // 5) Fire off AI rewrite
    const rewritePromise = rewriteTextNodes(textNodes);

    // 6) Reader overlay (only if article-like)
    if (isArticleLike()) {
      const content = extractArticleContent();
      if (content) {
        showReaderOverlay(content);
      }
    }

    // Wait for rewrite to finish
    await rewritePromise;

    // 7) Show completion
    updateToast("Done! Page simplified.");
    hideToast(1500);

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
        .catch((e) => sendResponse({ status: "error", error: e.message }));
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
