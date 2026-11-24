// ai/ui-strings.js — KaryaCNC-specific USER-FACING STRINGS for the AI chat.
//
// This is the ONLY ai/ file that intentionally differs between the two apps:
//   - KaryaCNC (this file) ships its own policy-free proxy (ai_bridge.go) at
//     /api/chat on the SAME origin that serves MiniSketch. There is no separate
//     Node bridge to start, so the guidance talks about the built-in proxy and
//     the Settings › AI chat provider fields.
//   - The upstream MiniSketch master keeps a Node bridge (server/ai-bridge.js),
//     so its ai/ui-strings.js phrases the same guidance around `node server/serve.js`.
//
// Everything else in ai/ (chat.js, prompt.js, system-prompt.txt, tools.json,
// skills.js) is kept IDENTICAL across both apps and is safe to sync. That is
// exactly why these strings live here and not inline in chat.js.
//
// Read by ai/chat.js as window.MiniSketchAIStrings. Loaded before ai/chat.js.
// Missing keys fall back to chat.js defaults, so a partial file is harmless.

window.MiniSketchAIStrings = {
  // Shown when the chat tab has no endpoint to talk to (file:// / no origin).
  // KaryaCNC: point at the provider fields, not at any bridge server.
  offlineNoEndpoint: 'Chat AI butuh koneksi ke provider. Isi "AI API base URL", "AI API key" dan "AI model" di Settings › AI chat. Offline, perintah sederhana tetap jalan: "kotak 100x60", "lingkaran d50", "pindah 10,0", "hapus".',

  // Prefixed to an upstream/proxy failure. The proxy is built in, so there is
  // no bridge script to check — just the provider settings and the key.
  errorPrefix: 'Error proxy: ',
  errorHint: '. Cek "AI API base URL" + "AI API key" + "AI model" di Settings › AI chat, dan pastikan provider reachable.'
};
