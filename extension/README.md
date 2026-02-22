# WebSimplify – Chrome Extension

A one-click Chrome extension that simplifies any webpage: cleaner UI, rewritten text, and an optional reader overlay.

## Features

- **Simplify** – Applies a modern UI skin, rewrites long text for readability, and shows a reader overlay on article pages.
- **Restore** – Reverts everything to the original state.

## Installation (Developer Mode)

1. Open Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this `extension/` folder.
4. The WebSimplify icon will appear in your toolbar.

## Configuration

The extension calls the WebSimplify cloud backend at:

```
https://websimplify-cloud.vercel.app/api/rewrite
```

To change the backend URL (e.g., for local development), edit the `API_URL` constant at the top of `background.js`:

```js
const API_URL = "http://localhost:3000/api/rewrite";
```

## How It Works

1. **Content Script (`content.js`)** runs on every page and handles:
   - Modern UI Skin (CSS injection, non-destructive)
   - Text node collection via TreeWalker (safe, never touches inputs/scripts)
   - AI rewrite via background service worker
   - Reader overlay (only on article-like pages)
   - MutationObserver for dynamically loaded content
   - Full restore of all changes

2. **Background Service Worker (`background.js`)** proxies rewrite requests to the Vercel backend.

3. **Popup (`popup.html`)** provides two buttons: Simplify and Restore.

## Icons

Replace the placeholder icons in `icons/` with your own 16x16, 48x48, and 128x128 PNG files.
