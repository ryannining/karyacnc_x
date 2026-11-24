// ai/ui-flags.js — KaryaCNC-specific UI FLAGS (NOT synced from MiniSketch master).
//
// KaryaCNC serves the AI chat through its own built-in Go proxy at /api/chat on
// the same origin that serves MiniSketch. There is no separate Node bridge to
// point at, so the "AI bridge URL" settings row is hidden. Upstream MiniSketch
// master ships no ai/ui-flags.js at all -> app.js defaults showBridgeUrl to
// true and the row shows there.
//
// This is one of only two app-specific ai/ files (the other is ui-strings.js);
// sync_minisketch.sh deliberately skips both so they are never overwritten.
// Loaded before app.js, which reads window.MiniSketchUI.showBridgeUrl.

window.MiniSketchUI = window.MiniSketchUI || {};
window.MiniSketchUI.showBridgeUrl = false;
