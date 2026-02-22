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
      /* ============================================================
         WebSimplify – Accessible UI Skin
         ADHD & Dyslexia friendly (WCAG-aligned)
         ============================================================ */

      /* --- Design tokens --- */
      body.${SKIN_CLASS} {
        --ws-bg: #fdf6e3;
        --ws-text: #2d2d2d;
        --ws-muted: #5c5c5c;
        --ws-accent: #0055cc;
        --ws-accent-bg: #dbeafe;
        --ws-heading: #1a1a1a;
        --ws-link: #0047ab;
        --ws-link-visited: #6b21a8;
        --ws-focus: #e85d04;
        --ws-border: #d1c4a9;
        --ws-success: #15803d;
        --ws-radius: 8px;
        --ws-font: "Atkinson Hyperlegible", "Verdana", "Tahoma", system-ui, sans-serif;
        --ws-font-size: 1.15rem;
        --ws-line-height: 1.9;
        --ws-letter-spacing: 0.04em;
        --ws-word-spacing: 0.12em;
        --ws-paragraph-spacing: 1.4em;
        --ws-max-width: 65ch;
      }

      @media (prefers-color-scheme: dark) {
        body.${SKIN_CLASS} {
          --ws-bg: #1e1e1e;
          --ws-text: #e8e6e3;
          --ws-muted: #aaaaaa;
          --ws-accent: #79b8ff;
          --ws-accent-bg: #1c3a5c;
          --ws-heading: #f5f5f5;
          --ws-link: #79b8ff;
          --ws-link-visited: #c4a7e7;
          --ws-focus: #ffb347;
          --ws-border: #444444;
          --ws-success: #4ade80;
        }
      }

      /* ==========================================================
         1. PERCEIVABLE – Colour, Contrast, Size
         ========================================================== */

      /* Base typography: large, well-spaced, dyslexia-friendly font */
      body.${SKIN_CLASS} {
        background-color: var(--ws-bg) !important;
        color: var(--ws-text) !important;
        font-family: var(--ws-font) !important;
        font-size: var(--ws-font-size) !important;
        line-height: var(--ws-line-height) !important;
        letter-spacing: var(--ws-letter-spacing) !important;
        word-spacing: var(--ws-word-spacing) !important;
        text-align: left !important;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        text-rendering: optimizeLegibility;
      }

      /* All text containers: inherit accessible spacing */
      body.${SKIN_CLASS} p,
      body.${SKIN_CLASS} li,
      body.${SKIN_CLASS} td,
      body.${SKIN_CLASS} th,
      body.${SKIN_CLASS} dd,
      body.${SKIN_CLASS} dt,
      body.${SKIN_CLASS} span,
      body.${SKIN_CLASS} div,
      body.${SKIN_CLASS} blockquote,
      body.${SKIN_CLASS} label {
        line-height: var(--ws-line-height) !important;
        letter-spacing: var(--ws-letter-spacing) !important;
        word-spacing: var(--ws-word-spacing) !important;
        text-align: left !important;
      }

      body.${SKIN_CLASS} p,
      body.${SKIN_CLASS} blockquote {
        margin-bottom: var(--ws-paragraph-spacing) !important;
      }

      /* Never justify text – left align only (dyslexia) */
      body.${SKIN_CLASS} * {
        text-align: left !important;
        text-justify: none !important;
      }
      body.${SKIN_CLASS} [style*="text-align: center"],
      body.${SKIN_CLASS} [style*="text-align:center"],
      body.${SKIN_CLASS} .text-center,
      body.${SKIN_CLASS} center {
        text-align: left !important;
      }

      /* ==========================================================
         2. UNDERSTANDABLE – Clear Headings & Hierarchy
         ========================================================== */

      /* Strong visual heading hierarchy */
      body.${SKIN_CLASS} h1,
      body.${SKIN_CLASS} h2,
      body.${SKIN_CLASS} h3,
      body.${SKIN_CLASS} h4,
      body.${SKIN_CLASS} h5,
      body.${SKIN_CLASS} h6 {
        font-family: var(--ws-font) !important;
        color: var(--ws-heading) !important;
        line-height: 1.3 !important;
        margin-top: 1.8em !important;
        margin-bottom: 0.6em !important;
        letter-spacing: 0.01em !important;
        border-bottom: none !important;
      }

      body.${SKIN_CLASS} h1 {
        font-size: 2rem !important;
        font-weight: 800 !important;
        border-bottom: 3px solid var(--ws-accent) !important;
        padding-bottom: 0.3em !important;
      }

      body.${SKIN_CLASS} h2 {
        font-size: 1.6rem !important;
        font-weight: 700 !important;
        border-left: 4px solid var(--ws-accent) !important;
        padding-left: 0.5em !important;
      }

      body.${SKIN_CLASS} h3 {
        font-size: 1.35rem !important;
        font-weight: 600 !important;
      }

      body.${SKIN_CLASS} h4,
      body.${SKIN_CLASS} h5,
      body.${SKIN_CLASS} h6 {
        font-size: 1.15rem !important;
        font-weight: 600 !important;
        text-transform: uppercase !important;
        letter-spacing: 0.06em !important;
        color: var(--ws-muted) !important;
      }

      /* ==========================================================
         3. ORGANIZED – Content Structure & Readability
         ========================================================== */

      /* Constrain line width for readability */
      body.${SKIN_CLASS} article,
      body.${SKIN_CLASS} .post-content,
      body.${SKIN_CLASS} .entry-content,
      body.${SKIN_CLASS} .article-body,
      body.${SKIN_CLASS} [role="main"],
      body.${SKIN_CLASS} main,
      body.${SKIN_CLASS} .mw-parser-output {
        max-width: var(--ws-max-width) !important;
      }

      /* Better list formatting */
      body.${SKIN_CLASS} ul,
      body.${SKIN_CLASS} ol {
        padding-left: 2em !important;
        margin-bottom: 1em !important;
      }

      body.${SKIN_CLASS} li {
        margin-bottom: 0.5em !important;
        padding-left: 0.3em !important;
      }

      body.${SKIN_CLASS} li::marker {
        color: var(--ws-accent) !important;
        font-weight: 700 !important;
      }

      /* Tables: clear borders, alternating rows */
      body.${SKIN_CLASS} table {
        border-collapse: collapse !important;
        width: 100% !important;
        margin: 1em 0 !important;
      }

      body.${SKIN_CLASS} th,
      body.${SKIN_CLASS} td {
        border: 1px solid var(--ws-border) !important;
        padding: 0.7em 1em !important;
        text-align: left !important;
      }

      body.${SKIN_CLASS} th {
        background: var(--ws-accent-bg) !important;
        font-weight: 700 !important;
      }

      body.${SKIN_CLASS} tr:nth-child(even) td {
        background: rgba(0,0,0,0.03) !important;
      }

      @media (prefers-color-scheme: dark) {
        body.${SKIN_CLASS} tr:nth-child(even) td {
          background: rgba(255,255,255,0.04) !important;
        }
      }

      /* ==========================================================
         4. OPERABLE – Links, Buttons, Focus, Navigation
         ========================================================== */

      /* Links: clearly distinguishable, underlined, icon hint */
      body.${SKIN_CLASS} a {
        color: var(--ws-link) !important;
        text-decoration: underline !important;
        text-decoration-thickness: 2px !important;
        text-underline-offset: 3px !important;
        font-weight: 600 !important;
        text-decoration-color: var(--ws-link) !important;
      }

      body.${SKIN_CLASS} a:visited {
        color: var(--ws-link-visited) !important;
        text-decoration-color: var(--ws-link-visited) !important;
      }

      body.${SKIN_CLASS} a:hover {
        background-color: var(--ws-accent-bg) !important;
        border-radius: 3px !important;
        text-decoration-thickness: 3px !important;
      }

      /* Buttons: large click targets, clear borders */
      body.${SKIN_CLASS} button,
      body.${SKIN_CLASS} [role="button"],
      body.${SKIN_CLASS} input[type="submit"],
      body.${SKIN_CLASS} input[type="button"] {
        min-height: 44px !important;
        min-width: 44px !important;
        padding: 0.6em 1.2em !important;
        font-size: 1rem !important;
        font-family: var(--ws-font) !important;
        border: 2px solid var(--ws-border) !important;
        border-radius: var(--ws-radius) !important;
        cursor: pointer !important;
        letter-spacing: 0.02em !important;
      }

      /* Strong focus indicators (WCAG 2.4.7 + 2.4.13) */
      body.${SKIN_CLASS} a:focus-visible,
      body.${SKIN_CLASS} button:focus-visible,
      body.${SKIN_CLASS} input:focus-visible,
      body.${SKIN_CLASS} select:focus-visible,
      body.${SKIN_CLASS} textarea:focus-visible,
      body.${SKIN_CLASS} [tabindex]:focus-visible,
      body.${SKIN_CLASS} [role="button"]:focus-visible {
        outline: 3px solid var(--ws-focus) !important;
        outline-offset: 3px !important;
        box-shadow: 0 0 0 6px rgba(232, 93, 4, 0.25) !important;
        border-radius: 4px !important;
      }

      /* Form inputs: larger, clearer */
      body.${SKIN_CLASS} input[type="text"],
      body.${SKIN_CLASS} input[type="email"],
      body.${SKIN_CLASS} input[type="password"],
      body.${SKIN_CLASS} input[type="search"],
      body.${SKIN_CLASS} input[type="number"],
      body.${SKIN_CLASS} input[type="tel"],
      body.${SKIN_CLASS} input[type="url"],
      body.${SKIN_CLASS} textarea,
      body.${SKIN_CLASS} select {
        font-size: 1rem !important;
        font-family: var(--ws-font) !important;
        padding: 0.6em 0.8em !important;
        border: 2px solid var(--ws-border) !important;
        border-radius: var(--ws-radius) !important;
        background: var(--ws-bg) !important;
        color: var(--ws-text) !important;
        min-height: 44px !important;
      }

      /* ==========================================================
         5. ADHD-FRIENDLY – Reduce Distractions
         ========================================================== */

      /* Kill ALL animations, transitions, auto-play (WCAG 2.2.2) */
      body.${SKIN_CLASS} *,
      body.${SKIN_CLASS} *::before,
      body.${SKIN_CLASS} *::after {
        animation-duration: 0.001ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.001ms !important;
        scroll-behavior: auto !important;
      }

      /* Dim distracting noise: sidebars, ads, cookie popups, promos */
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
      body.${SKIN_CLASS} [class*="Newsletter"],
      body.${SKIN_CLASS} [class*="popup"],
      body.${SKIN_CLASS} [class*="Popup"],
      body.${SKIN_CLASS} [class*="modal"],
      body.${SKIN_CLASS} [class*="Modal"],
      body.${SKIN_CLASS} [class*="overlay"]:not(#ws-reader-overlay),
      body.${SKIN_CLASS} [class*="toast"],
      body.${SKIN_CLASS} [class*="notification"],
      body.${SKIN_CLASS} [class*="ticker"],
      body.${SKIN_CLASS} marquee {
        opacity: 0.15 !important;
        filter: blur(1px) grayscale(1) !important;
        pointer-events: none !important;
      }

      body.${SKIN_CLASS} aside:hover,
      body.${SKIN_CLASS} [role="complementary"]:hover,
      body.${SKIN_CLASS} [class*="sidebar"]:hover,
      body.${SKIN_CLASS} [class*="Sidebar"]:hover,
      body.${SKIN_CLASS} [id*="sidebar"]:hover {
        opacity: 1 !important;
        filter: none !important;
        pointer-events: auto !important;
      }

      /* Hide blinking/scrolling elements */
      body.${SKIN_CLASS} marquee,
      body.${SKIN_CLASS} blink {
        display: none !important;
      }

      /* Mute background images/decorations (reduce visual noise) */
      body.${SKIN_CLASS} [class*="hero"],
      body.${SKIN_CLASS} [class*="Hero"],
      body.${SKIN_CLASS} [class*="jumbotron"],
      body.${SKIN_CLASS} [class*="carousel"],
      body.${SKIN_CLASS} [class*="slider"],
      body.${SKIN_CLASS} [class*="Slider"] {
        background-image: none !important;
        min-height: auto !important;
      }

      /* ==========================================================
         6. SCREEN READER & KEYBOARD – Skip Link, ARIA
         ========================================================== */

      /* Skip-to-content link */
      #ws-skip-link {
        position: fixed !important;
        top: -100px !important;
        left: 1rem !important;
        z-index: 2147483647 !important;
        background: var(--ws-focus) !important;
        color: #fff !important;
        padding: 0.8em 1.5em !important;
        font-size: 1rem !important;
        font-weight: 700 !important;
        border-radius: 0 0 var(--ws-radius) var(--ws-radius) !important;
        text-decoration: none !important;
        font-family: var(--ws-font) !important;
      }

      #ws-skip-link:focus {
        top: 0 !important;
        outline: 3px solid var(--ws-accent) !important;
      }

      /* Images missing alt text: show warning border */
      body.${SKIN_CLASS} img:not([alt]),
      body.${SKIN_CLASS} img[alt=""] {
        outline: 3px dashed #dc2626 !important;
        outline-offset: 2px !important;
      }

      /* Rewritten text marker */
      .ws-rewritten {
        border-left: 4px solid var(--ws-accent, #0055cc) !important;
        padding-left: 0.75em !important;
        margin-left: 0 !important;
        background: var(--ws-accent-bg, #dbeafe) !important;
        border-radius: 0 var(--ws-radius) var(--ws-radius) 0 !important;
      }

      /* ==========================================================
         7. READER OVERLAY – Accessible version
         ========================================================== */

      #ws-reader-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        background: var(--ws-bg, #fdf6e3);
        color: var(--ws-text, #2d2d2d);
        overflow-y: auto;
        padding: 2rem 1rem;
        font-family: var(--ws-font);
        font-size: var(--ws-font-size);
        line-height: var(--ws-line-height);
        letter-spacing: var(--ws-letter-spacing);
        word-spacing: var(--ws-word-spacing);
      }

      #ws-reader-overlay .ws-reader-inner {
        max-width: var(--ws-max-width, 65ch);
        margin: 0 auto;
        padding-bottom: 6rem;
      }

      #ws-reader-overlay h1 {
        font-size: 2rem;
        font-weight: 800;
        margin-bottom: 1rem;
        line-height: 1.3;
        border-bottom: 3px solid var(--ws-accent);
        padding-bottom: 0.3em;
      }

      #ws-reader-overlay h2 {
        font-size: 1.5rem;
        font-weight: 700;
        margin: 1.5rem 0 0.5rem;
        border-left: 4px solid var(--ws-accent);
        padding-left: 0.5em;
      }

      #ws-reader-overlay p,
      #ws-reader-overlay li {
        font-size: var(--ws-font-size);
        margin-bottom: 0.75rem;
      }

      #ws-reader-overlay img {
        max-width: 100%;
        border-radius: var(--ws-radius, 8px);
        margin: 1rem 0;
      }

      #ws-reader-overlay a {
        color: var(--ws-link, #0047ab);
        text-decoration: underline;
        text-decoration-thickness: 2px;
        font-weight: 600;
      }

      #ws-reader-overlay .ws-reader-close {
        position: fixed;
        top: 1rem;
        right: 1.5rem;
        background: var(--ws-accent, #0055cc);
        color: #fff;
        border: none;
        padding: 0.7rem 1.5rem;
        border-radius: 999px;
        font-size: 1rem;
        font-weight: 700;
        cursor: pointer;
        z-index: 2147483647;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        min-height: 44px;
        min-width: 44px;
      }

      #ws-reader-overlay .ws-reader-close:focus-visible {
        outline: 3px solid var(--ws-focus) !important;
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
      if (img.dataset.wsOrigSrc) return; // already processed
      img.dataset.wsOrigSrc = img.src;
      // freeze by setting loading attribute to pause decode
      img.style.setProperty("image-rendering", "auto", "important");
      // Create a still frame via canvas
      try {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth || img.width || 200;
        c.height = img.naturalHeight || img.height || 200;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, c.width, c.height);
        img.src = c.toDataURL("image/png");
      } catch (_) {
        // cross-origin images can't be snapshotted – leave as-is
      }
    });

    // 4. Add aria-label to images missing alt text
    document.querySelectorAll("img:not([alt]), img[alt='']").forEach((img) => {
      if (!img.getAttribute("aria-label")) {
        img.setAttribute("aria-label", "Image – no description provided");
        img.setAttribute("role", "img");
      }
    });

    // 5. Ensure main landmark exists
    if (mainTarget && !mainTarget.getAttribute("role")) {
      mainTarget.setAttribute("role", "main");
    }

    // 6. Stop marquee elements
    document.querySelectorAll("marquee").forEach((m) => {
      m.stop && m.stop();
    });
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
      img.style.removeProperty("image-rendering");
    });

    // Remove added aria-labels for missing alt
    document.querySelectorAll('img[aria-label="Image – no description provided"]').forEach((img) => {
      img.removeAttribute("aria-label");
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
