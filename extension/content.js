/* ================================================================
   WebSimplify – Content Script
   Handles: Modern UI Skin, AI Rewrite, Reader Overlay, Restore
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
    // Walk up ancestors to catch nested skips
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

  /* ---------- Modern UI Skin --------------------------------------- */

  const SKIN_CLASS = "ws-simplified";

  function buildSkinCSS() {
    return `
      /* ---- WebSimplify Modern UI Skin ---- */
      body.${SKIN_CLASS} {
        --ws-bg: #fafafa;
        --ws-text: #1a1a1a;
        --ws-muted: rgba(0,0,0,0.45);
        --ws-accent: #2563eb;
        --ws-radius: 8px;
        --ws-transition: 0.25s ease;
      }

      @media (prefers-color-scheme: dark) {
        body.${SKIN_CLASS} {
          --ws-bg: #111111;
          --ws-text: #e4e4e7;
          --ws-muted: rgba(255,255,255,0.40);
          --ws-accent: #60a5fa;
        }
      }

      /* Typography */
      body.${SKIN_CLASS} {
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        text-rendering: optimizeLegibility;
      }

      body.${SKIN_CLASS} p,
      body.${SKIN_CLASS} li,
      body.${SKIN_CLASS} td,
      body.${SKIN_CLASS} th,
      body.${SKIN_CLASS} dd,
      body.${SKIN_CLASS} dt,
      body.${SKIN_CLASS} blockquote {
        line-height: 1.75 !important;
        letter-spacing: 0.01em !important;
      }

      body.${SKIN_CLASS} p {
        margin-bottom: 1em !important;
      }

      /* Safe max-width for long text blocks */
      body.${SKIN_CLASS} article,
      body.${SKIN_CLASS} .post-content,
      body.${SKIN_CLASS} .entry-content,
      body.${SKIN_CLASS} .article-body,
      body.${SKIN_CLASS} [role="main"] > p,
      body.${SKIN_CLASS} main > p,
      body.${SKIN_CLASS} .mw-parser-output > p,
      body.${SKIN_CLASS} .mw-parser-output > ul,
      body.${SKIN_CLASS} .mw-parser-output > ol {
        max-width: 72ch !important;
      }

      /* Dim noise: sidebars, ads, cookie popups */
      body.${SKIN_CLASS} aside,
      body.${SKIN_CLASS} [role="complementary"],
      body.${SKIN_CLASS} [class*="sidebar"],
      body.${SKIN_CLASS} [class*="Sidebar"],
      body.${SKIN_CLASS} [id*="sidebar"],
      body.${SKIN_CLASS} [class*="ad-"],
      body.${SKIN_CLASS} [class*="Ad-"],
      body.${SKIN_CLASS} [class*="advert"],
      body.${SKIN_CLASS} [id*="cookie"],
      body.${SKIN_CLASS} [class*="cookie"],
      body.${SKIN_CLASS} [class*="Cookie"],
      body.${SKIN_CLASS} [class*="banner"],
      body.${SKIN_CLASS} [class*="promo"],
      body.${SKIN_CLASS} [class*="Promo"],
      body.${SKIN_CLASS} [class*="newsletter"],
      body.${SKIN_CLASS} [class*="Newsletter"] {
        opacity: 0.35 !important;
        filter: blur(0.5px) saturate(0.3) !important;
        transition: opacity var(--ws-transition), filter var(--ws-transition) !important;
      }

      body.${SKIN_CLASS} aside:hover,
      body.${SKIN_CLASS} [role="complementary"]:hover,
      body.${SKIN_CLASS} [class*="sidebar"]:hover,
      body.${SKIN_CLASS} [class*="Sidebar"]:hover,
      body.${SKIN_CLASS} [id*="sidebar"]:hover,
      body.${SKIN_CLASS} [class*="ad-"]:hover,
      body.${SKIN_CLASS} [class*="Ad-"]:hover,
      body.${SKIN_CLASS} [class*="advert"]:hover,
      body.${SKIN_CLASS} [id*="cookie"]:hover,
      body.${SKIN_CLASS} [class*="cookie"]:hover,
      body.${SKIN_CLASS} [class*="Cookie"]:hover,
      body.${SKIN_CLASS} [class*="banner"]:hover,
      body.${SKIN_CLASS} [class*="promo"]:hover,
      body.${SKIN_CLASS} [class*="Promo"]:hover,
      body.${SKIN_CLASS} [class*="newsletter"]:hover,
      body.${SKIN_CLASS} [class*="Newsletter"]:hover {
        opacity: 1 !important;
        filter: none !important;
      }

      /* Focus rings for a11y */
      body.${SKIN_CLASS} a:focus-visible,
      body.${SKIN_CLASS} button:focus-visible,
      body.${SKIN_CLASS} [tabindex]:focus-visible {
        outline: 3px solid var(--ws-accent) !important;
        outline-offset: 2px !important;
        border-radius: 3px !important;
      }

      /* Smooth link underlines */
      body.${SKIN_CLASS} a {
        text-decoration-thickness: 1px !important;
        text-underline-offset: 3px !important;
      }

      /* Rewritten text marker */
      .ws-rewritten {
        border-left: 3px solid var(--ws-accent, #2563eb);
        padding-left: 0.75em;
        margin-left: 0;
        transition: border-color var(--ws-transition);
      }

      /* Reader overlay */
      #ws-reader-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        background: var(--ws-bg, #fafafa);
        color: var(--ws-text, #1a1a1a);
        overflow-y: auto;
        padding: 2rem 1rem;
        font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
        line-height: 1.8;
        animation: ws-fadein 0.3s ease;
      }

      @keyframes ws-fadein {
        from { opacity: 0; }
        to   { opacity: 1; }
      }

      #ws-reader-overlay .ws-reader-inner {
        max-width: 68ch;
        margin: 0 auto;
        padding-bottom: 6rem;
      }

      #ws-reader-overlay h1 {
        font-size: 2rem;
        font-weight: 700;
        margin-bottom: 1rem;
        line-height: 1.3;
      }

      #ws-reader-overlay h2 {
        font-size: 1.4rem;
        font-weight: 600;
        margin: 1.5rem 0 0.5rem;
      }

      #ws-reader-overlay p,
      #ws-reader-overlay li {
        font-size: 1.1rem;
        margin-bottom: 0.75rem;
      }

      #ws-reader-overlay img {
        max-width: 100%;
        border-radius: var(--ws-radius, 8px);
        margin: 1rem 0;
      }

      #ws-reader-overlay a {
        color: var(--ws-accent, #2563eb);
      }

      #ws-reader-overlay .ws-reader-close {
        position: fixed;
        top: 1rem;
        right: 1.5rem;
        background: var(--ws-accent, #2563eb);
        color: #fff;
        border: none;
        padding: 0.5rem 1.2rem;
        border-radius: 999px;
        font-size: 0.9rem;
        cursor: pointer;
        z-index: 2147483647;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
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
  }

  function removeSkin() {
    document.body.classList.remove(SKIN_CLASS);
    if (STATE.styleEl) {
      STATE.styleEl.remove();
      STATE.styleEl = null;
    }
  }

  /* ---------- Reader Overlay --------------------------------------- */

  /** Heuristic: is this page article-like? */
  function isArticleLike() {
    // Count interactive elements
    const inputs = document.querySelectorAll(
      'input, textarea, select, [contenteditable="true"]'
    ).length;
    const buttons = document.querySelectorAll("button, [role='button']").length;
    const forms = document.querySelectorAll("form").length;

    // Heavy app UI threshold
    if (inputs > 5 || buttons > 20 || forms > 3) return false;

    // Check for article markers
    const hasArticle = !!document.querySelector(
      "article, [itemtype*='Article'], [role='article']"
    );

    // Count text length in main content
    const main =
      document.querySelector("article") ||
      document.querySelector("[role='main']") ||
      document.querySelector("main") ||
      document.body;

    const textLen = (main.innerText || "").length;
    if (textLen < 500) return false; // too little text

    // Ratio: text length vs interactive elements
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

    // Clone the content so we don't disturb the live DOM
    const clone = main.cloneNode(true);

    // Remove scripts, styles, nav, and forms from clone
    clone.querySelectorAll("script, style, nav, form, iframe, [role='navigation']")
      .forEach((el) => el.remove());

    return { title, html: clone.innerHTML };
  }

  function showReaderOverlay(content) {
    if (STATE.readerOverlayEl) return;

    const overlay = document.createElement("div");
    overlay.id = "ws-reader-overlay";
    overlay.innerHTML = `
      <button class="ws-reader-close" aria-label="Close reader view">✕ Close Reader</button>
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

  /**
   * Send text items to background service worker for rewriting.
   * Returns [{id, text}]
   */
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
      if (STATE.originalTexts.has(node)) continue; // already processed

      const text = node.textContent.trim();
      if (text.length < MIN_TEXT_LEN) continue;

      const id = String(STATE.nextNodeId++);
      const truncated = text.slice(0, MAX_CHARS_PER_ITEM);

      STATE.originalTexts.set(node, node.textContent);
      items.push({ id, text: truncated });
      nodeMap.set(id, node);
    }

    if (items.length === 0) return;

    // Chunk into batches respecting limits
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

    // Process batches sequentially to avoid hammering the API
    for (const b of batches) {
      try {
        const results = await rewriteViaBackground(b);
        for (const r of results) {
          const node = nodeMap.get(r.id);
          if (node && r.text && node.parentElement) {
            // Replace text content only – preserves the node reference & listeners
            node.textContent = r.text;
            // Mark parent for visual hint
            if (node.parentElement) {
              node.parentElement.classList.add("ws-rewritten");
            }
          }
        }
      } catch (err) {
        console.warn("[WebSimplify] Rewrite batch failed:", err.message);
        // Continue with other batches
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

      // Debounce
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

    // 1) Apply Modern UI Skin (instant)
    applySkin();

    // 2) Collect text nodes for AI rewrite
    const textNodes = collectTextNodes(document.body);

    // 3) Start MutationObserver for dynamic content
    startObserving();

    // 4) Fire off AI rewrite (async, non-blocking for skin)
    const rewritePromise = rewriteTextNodes(textNodes);

    // 5) Reader overlay (only if article-like)
    if (isArticleLike()) {
      const content = extractArticleContent();
      if (content) {
        showReaderOverlay(content);
      }
    }

    // Wait for rewrite to finish
    await rewritePromise;

    return { status: "simplified" };
  }

  function restore() {
    if (!STATE.simplified) return { status: "already" };

    // Stop observing mutations
    stopObserving();

    // Restore all text nodes
    for (const [node, originalText] of STATE.originalTexts) {
      if (node.parentElement) {
        node.textContent = originalText;
        node.parentElement.classList.remove("ws-rewritten");
      }
    }
    STATE.originalTexts.clear();
    STATE.nextNodeId = 0;

    // Remove reader overlay
    removeReaderOverlay();

    // Remove skin
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
      return true; // async
    }
    if (msg.type === "RESTORE") {
      sendResponse(restore());
    }
    if (msg.type === "GET_STATE") {
      sendResponse({ simplified: STATE.simplified });
    }
  });
})();
