package main

// ai_bridge.go — Pure streaming proxy between the MiniSketch AI chat tab and an
// OpenAI-compatible LLM provider.
//
// This is the Go counterpart of the (also policy-free) Node bridge
// (minisketch repo: server/ai-bridge.js). It owns NO policy: no system prompt,
// no tool list, no skills. Those live on the FRONTEND (minisketch/ai/prompt.js +
// system-prompt.txt + tools.json + skills.js), which assembles the full
// `messages` (system message first) and the `tools` array and sends them here.
// Tuning the prompt or tools therefore never needs rebuilding this binary —
// push a web update and it's live.
//
// What this file owns (mechanism, rarely changes):
//   - forward {baseUrl, apiKey, model, messages, tools} to {baseUrl}/chat/completions
//     with stream:true and an IDLE (not total) timeout, so a slow reasoning model
//     is never killed mid-answer.
//   - translate the provider's OpenAI SSE chunks into the tiny bridge SSE the
//     frontend reads: {delta:{thinking|content}} live, then one final
//     {done, reply, thinking, tool_calls}. Errors travel as {error} on the SAME
//     stream (the 200 status line is already on the wire, so an HTTP error body
//     would never be read and the chat would hang on "…").
//   - assemble tool_calls from streamed deltas and clamp their numeric arguments
//     to the world frame (mirrors the old bridge's sanitizeArgs). Tool-name
//     filtering/validation is left to the frontend, which owns the executor.
//   - no keep-alive + serialize upstream + retry-once on 429, because some
//     providers count OPEN CONNECTIONS as "active sessions".
//
// The API key belongs to whoever runs the app: it arrives with each request and
// is never stored here. A key baked into the source is a key that leaks with it.

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

// logf membungkus log.Printf agar debug AI konsisten berawalan "[ai]".
func logf(format string, args ...interface{}) {
	log.Printf("[ai] "+format, args...)
}

// aiHTTPClient tanpa total timeout: jawaban model reasoning bisa beberapa menit.
// Idle timeout penanganan body per-request di sseLines (120s), bukan batas total.
// ResponseHeaderTimeout dibiarkan SANGAT longgar (600s) — Node bridge tidak
// punya batas tunggu header sama sekali, sehingga provider berpikir panjang
// (Gemini dkk.) yang belum mengirim byte pertama >60s tidak boleh dibunuh.
var aiHTTPClient = &http.Client{
	Transport: &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           (&net.Dialer{Timeout: 15 * time.Second}).DialContext,
		TLSHandshakeTimeout:   15 * time.Second,
		ResponseHeaderTimeout: 600 * time.Second,
		DisableKeepAlives:     true, // tutup socket tiap respons: provider hitung koneksi terbuka sebagai "sesi"
		MaxIdleConns:          1,
		IdleConnTimeout:       1 * time.Second,
	},
}

// aiBridgeRequest adalah body yang dikirim chat.js ke /api/chat. Frontend-lah
// yang menyusun system message + tools; proxy ini hanya meneruskan.
type aiBridgeRequest struct {
	Messages []json.RawMessage `json:"messages"`
	Tools    []json.RawMessage `json:"tools"`
	Settings struct {
		BaseURL string `json:"baseUrl"`
		APIKey  string `json:"apiKey"`
		Model   string `json:"model"`
		// 'off' | 'low' | 'normal' (Settings > AI reasoning level)
		Thinking string `json:"thinking"`
	} `json:"settings"`
}

// isGeminiBase mendeteksi provider Google Gemini dari base URL (kebalikan
// kebiasaan Node bridge yang memakai regex; Go memakai substring sama).
func isGeminiBase(base string) bool {
	return strings.Contains(base, "generativelanguage.googleapis.com") ||
		strings.Contains(base, "generativelanguage.google.com")
}

// isLocalHost mendeteksi provider lokal/LAN (Ollama, LM Studio, llama.cpp,
// vLLM) yang biasanya tidak memakai API key — parity dengan Node bridge
// (ai-bridge.js isLocalHost).
func isLocalHost(base string) bool {
	u, err := url.Parse(base)
	if err != nil {
		return false
	}
	h := strings.ToLower(u.Hostname())
	if h == "localhost" || h == "127.0.0.1" || h == "::1" {
		return true
	}
	if strings.HasPrefix(h, "10.") || strings.HasPrefix(h, "192.168.") {
		return true
	}
	for i := 16; i <= 31; i++ {
		if strings.HasPrefix(h, fmt.Sprintf("172.%d.", i)) {
			return true
		}
	}
	return false
}

// isGlmHost mendeteksi host GLM/z.ai (parity dengan Node isGlmHost) —
// provider ini memakai flag `thinking` untuk mengendalikan reasoning.
func isGlmHost(base string) bool {
	u, err := url.Parse(base)
	if err != nil {
		return false
	}
	h := strings.ToLower(u.Hostname())
	return strings.Contains(h, "bigmodel.cn") || h == "z.ai" || strings.HasSuffix(h, ".z.ai")
}

// aiToolCall satu panggilan tool yang sudah dirakit: nama + argumen (objek).
// Bentuk inilah yang dibaca chat.js: {name, arguments:{...}}.
type aiToolCall struct {
	Name      string                 `json:"name"`
	Arguments map[string]interface{} `json:"arguments"`
}

// aiUsage menampung pemakaian token dari provider (parity dengan Node bridge:
// event final SSE menyertakan `usage` bila tersedia).
type aiUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// aiUpstreamResult adalah pesan assistant final yang sudah dirakit dari stream.
type aiUpstreamResult struct {
	Content   string
	Reasoning string
	ToolCalls []aiToolCall
	Usage     *aiUsage
}

// normalizeAIBase menerima base URL dalam bentuk apa pun yang dipakai user
// (dengan/kurang trailing slash, atau URL lengkap ".../v1/chat/completions").
func normalizeAIBase(base string) string {
	b := strings.TrimSpace(base)
	b = strings.TrimRight(b, "/")
	if strings.HasSuffix(strings.ToLower(b), "/chat/completions") {
		b = b[:len(b)-len("/chat/completions")]
		b = strings.TrimRight(b, "/")
	}
	return b
}

// clampAINum membatasi angka ke bingkai dunia (+/-10000); constraint `value`
// ke +/-100000 — sama seperti clampNum/value-clamp di bridge Node.
func clampAINum(n, limit float64) float64 {
	if n < -limit {
		return -limit
	}
	if n > limit {
		return limit
	}
	return n
}

// sanitizeAIArgs meng-clamp semua angka pada argumen (rekursif) agar output
// model yang liar tidak mengirim koordinat tak masuk akal ke worksheet.
func sanitizeAIArgs(args map[string]interface{}) map[string]interface{} {
	if args == nil {
		return map[string]interface{}{}
	}
	for k, v := range args {
		switch val := v.(type) {
		case float64:
			limit := 10000.0
			if k == "value" {
				limit = 100000.0
			}
			args[k] = clampAINum(val, limit)
		case map[string]interface{}:
			args[k] = sanitizeAIArgs(val)
		case []interface{}:
			for i, item := range val {
				if m, ok := item.(map[string]interface{}); ok {
					val[i] = sanitizeAIArgs(m)
				} else if f, ok := item.(float64); ok {
					val[i] = clampAINum(f, 10000.0)
				}
			}
		}
	}
	return args
}

// ---- Google Gemini adapter (paritas dengan Node ai-bridge.js) --------------
// chat.js selalu berbicara bentuk OpenAI (messages/tools, SSE
// {delta:{thinking|content}} lalu {done, reply, thinking, tool_calls}).
// Adapter ini satu-satunya bagian yang tahu protokol Gemini.

type geminiInline struct {
	MimeType string `json:"mimeType"`
	Data     string `json:"data"`
}

type geminiFunctionCall struct {
	Name string                 `json:"name"`
	Args map[string]interface{} `json:"args"`
}

type geminiPart struct {
	Text         string              `json:"text,omitempty"`
	InlineData   *geminiInline       `json:"inlineData,omitempty"`
	Thought      bool                `json:"thought,omitempty"`
	FunctionCall *geminiFunctionCall `json:"functionCall,omitempty"`
}

// aiGeminiParts: content OpenAI (string | parts[]) -> parts Gemini.
func aiGeminiParts(content json.RawMessage) []geminiPart {
	var s string
	if json.Unmarshal(content, &s) == nil {
		if s == "" {
			return nil
		}
		return []geminiPart{{Text: s}}
	}
	var arr []json.RawMessage
	if json.Unmarshal(content, &arr) != nil {
		return nil
	}
	var out []geminiPart
	for _, raw := range arr {
		var p struct {
			Type     string `json:"type"`
			Text     string `json:"text"`
			ImageURL struct {
				URL string `json:"url"`
			} `json:"image_url"`
		}
		if json.Unmarshal(raw, &p) != nil {
			continue
		}
		switch p.Type {
		case "text":
			if p.Text != "" {
				out = append(out, geminiPart{Text: p.Text})
			}
		case "image_url":
			// data:image/png;base64,.... -> inlineData
			if i := strings.Index(p.ImageURL.URL, ";base64,"); i >= 0 && strings.HasPrefix(p.ImageURL.URL, "data:image/") {
				mime := strings.TrimPrefix(p.ImageURL.URL[:i], "data:")
				out = append(out, geminiPart{InlineData: &geminiInline{MimeType: mime, Data: p.ImageURL.URL[i+len(";base64,"):]}})
			}
		}
	}
	return out
}

// aiGeminiRequest menyusun body generateContent Gemini dari input gaya OpenAI.
func aiGeminiRequest(req aiBridgeRequest, model, level string) (map[string]interface{}, error) {
	var contents []map[string]interface{}
	var sysText strings.Builder
	push := func(role string, parts []geminiPart) {
		if len(parts) == 0 {
			return
		}
		if n := len(contents); n > 0 && contents[n-1]["role"] == role {
			existing := contents[n-1]["parts"].([]geminiPart)
			contents[n-1]["parts"] = append(existing, parts...)
		} else {
			contents = append(contents, map[string]interface{}{"role": role, "parts": parts})
		}
	}
	for _, rawM := range req.Messages {
		var m struct {
			Role    string          `json:"role"`
			Content json.RawMessage `json:"content"`
		}
		if json.Unmarshal(rawM, &m) != nil {
			continue
		}
		switch m.Role {
		case "system":
			var s string
			if json.Unmarshal(m.Content, &s) == nil && s != "" {
				if sysText.Len() > 0 {
					sysText.WriteString("\n\n")
				}
				sysText.WriteString(s)
			}
		case "assistant", "model":
			push("model", aiGeminiParts(m.Content))
		default:
			push("user", aiGeminiParts(m.Content))
		}
	}
	body := map[string]interface{}{"contents": contents}
	if sysText.Len() > 0 {
		body["systemInstruction"] = map[string]interface{}{
			"parts": []map[string]string{{"text": sysText.String()}},
		}
	}
	if len(req.Tools) > 0 {
		var decls []map[string]interface{}
		for _, rawT := range req.Tools {
			var t struct {
				Function struct {
					Name        string          `json:"name"`
					Description string          `json:"description"`
					Parameters  json.RawMessage `json:"parameters"`
				} `json:"function"`
				Name string `json:"name"`
			}
			if json.Unmarshal(rawT, &t) != nil {
				continue
			}
			name := t.Function.Name
			if name == "" {
				name = t.Name
			}
			if name == "" {
				continue
			}
			d := map[string]interface{}{"name": name, "description": t.Function.Description}
			if len(t.Function.Parameters) > 0 {
				var params interface{}
				if json.Unmarshal(t.Function.Parameters, &params) == nil {
					d["parameters"] = params
				}
			}
			decls = append(decls, d)
		}
		if len(decls) > 0 {
			body["tools"] = []map[string]interface{}{{"functionDeclarations": decls}}
		}
	}
	if level != "" {
		if tc := geminiThinkingConfig(model, level); tc != nil {
			body["thinkingConfig"] = tc
		}
	}
	return body, nil
}

// geminiThinkingConfig menyusun generationConfig.thinkingConfig sesuai level
// reasoning ('off'|'low'|'normal') dan generasi model — parity dengan Node
// ai-bridge.js geminiThinkingConfig.
func geminiThinkingConfig(model, level string) map[string]interface{} {
	off := level == "off"
	low := level == "low"
	m := strings.ToLower(model)
	isGen34 := strings.HasPrefix(m, "gemini-3") || strings.HasPrefix(m, "gemini-4")
	isGen25 := strings.HasPrefix(m, "gemini-2.5")
	if off {
		if isGen25 {
			if strings.Contains(m, "pro") {
				return map[string]interface{}{"includeThoughts": false, "thinkingBudget": 128}
			}
			return map[string]interface{}{"includeThoughts": false, "thinkingBudget": 0}
		}
		if isGen34 {
			if strings.Contains(m, "flash-lite") {
				return map[string]interface{}{"includeThoughts": false, "thinkingLevel": "MINIMAL"}
			}
			return map[string]interface{}{"includeThoughts": false, "thinkingLevel": "LOW"}
		}
		return nil
	}
	if low {
		if isGen34 {
			return map[string]interface{}{"includeThoughts": true, "thinkingLevel": "LOW"}
		}
		if isGen25 {
			return map[string]interface{}{"includeThoughts": true, "thinkingBudget": 1024}
		}
		return map[string]interface{}{"includeThoughts": true}
	}
	return map[string]interface{}{"includeThoughts": true}
}

// aiCallGeminiUpstream: SATU permintaan streaming ke Gemini
// (…/v1beta/models/{model}:streamGenerateContent?alt=sse). Mengurai part
// thought -> thinking, text -> content, functionCall -> tool_calls.
func aiCallGeminiUpstream(ctx context.Context, base, key, model string, req aiBridgeRequest, level string, onDelta aiDeltaFn) (aiUpstreamResult, error) {
	var out aiUpstreamResult

	payload, err := aiGeminiRequest(req, model, level)
	if err != nil {
		return out, fmt.Errorf("gemini request: %w", err)
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return out, fmt.Errorf("encode payload: %w", err)
	}

	root := strings.TrimRight(base, "/")
	root = strings.TrimSuffix(root, "/v1beta")
	endpoint := root + "/v1beta/models/" + url.PathEscape(model) + ":streamGenerateContent?alt=sse"
	httpReq, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(body))
	if err != nil {
		return out, fmt.Errorf("buat request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	httpReq.Header.Set("x-goog-api-key", key)
	httpReq.Header.Set("Connection", "close")

	resp, err := aiHTTPClient.Do(httpReq)
	if err != nil {
		return out, fmt.Errorf("upstream unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return out, fmt.Errorf("upstream %d: %s", resp.StatusCode, readAISnippet(resp.Body, 600))
	}

	content := &strings.Builder{}
	reasoning := &strings.Builder{}
	var streamErr error
	err = sseLines(resp.Body, 120*time.Second, func(data string) {
		var ev struct {
			Candidates []struct {
				Content struct {
					Parts []geminiPart `json:"parts"`
				} `json:"content"`
			} `json:"candidates"`
			UsageMetadata *struct {
				PromptTokenCount     int `json:"promptTokenCount"`
				CandidatesTokenCount int `json:"candidatesTokenCount"`
				ThoughtsTokenCount   int `json:"thoughtsTokenCount"`
				TotalTokenCount      int `json:"totalTokenCount"`
			} `json:"usageMetadata"`
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal([]byte(data), &ev) != nil {
			return
		}
		if ev.Error != nil {
			streamErr = fmt.Errorf("gemini stream: %s", ev.Error.Message)
			return
		}
		if len(ev.Candidates) == 0 {
			return
		}
		for _, part := range ev.Candidates[0].Content.Parts {
			switch {
			case part.Thought:
				reasoning.WriteString(part.Text)
				if onDelta != nil && part.Text != "" {
					onDelta(map[string]interface{}{"delta": map[string]string{"thinking": part.Text}})
				}
			case part.Text != "":
				content.WriteString(part.Text)
				if onDelta != nil {
					onDelta(map[string]interface{}{"delta": map[string]string{"content": part.Text}})
				}
			case part.FunctionCall != nil && part.FunctionCall.Name != "":
				args := part.FunctionCall.Args
				if args == nil {
					args = map[string]interface{}{}
				}
				out.ToolCalls = append(out.ToolCalls, aiToolCall{Name: part.FunctionCall.Name, Arguments: sanitizeAIArgs(args)})
			}
		}
		if um := ev.UsageMetadata; um != nil {
			pt := um.PromptTokenCount
			ct := um.CandidatesTokenCount + um.ThoughtsTokenCount
			total := um.TotalTokenCount
			if total == 0 {
				total = pt + ct
			}
			out.Usage = &aiUsage{PromptTokens: pt, CompletionTokens: ct, TotalTokens: total}
		}
	})
	if err != nil {
		return out, err
	}
	if streamErr != nil {
		return out, streamErr
	}
	out.Content = content.String()
	out.Reasoning = reasoning.String()
	return out, nil
}

// HandleAIChat adalah endpoint POST /api/chat: proxy streaming murni ke provider
// OpenAI-compatible. System prompt, tools dan skills TIDAK disentuh di sini —
// semuanya sudah termasuk dalam req.Messages / req.Tools dari frontend.
func (a *App) HandleAIChat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	defer r.Body.Close()
	var req aiBridgeRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 8<<20)).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusBadRequest)
		fmt.Fprint(w, `{"error":"bad json body"}`)
		return
	}

	base := normalizeAIBase(req.Settings.BaseURL)
	key := strings.TrimSpace(req.Settings.APIKey)
	model := strings.TrimSpace(req.Settings.Model)
	gemini := isGeminiBase(base)
	local := !gemini && isLocalHost(base)
	// Parity dengan Node bridge: provider lokal/OLLama tidak wajib API key.
	if base == "" || (key == "" && !local) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusBadRequest)
		fmt.Fprint(w, `{"error":"No API key or base URL. Isi \"AI API base URL\" dan \"AI API key\" di Settings › AI chat."}`)
		return
	}
	if len(req.Messages) == 0 {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusBadRequest)
		fmt.Fprint(w, `{"error":"empty messages"}`)
		return
	}
	if SHOWDEBUG {
		logf("[ai] proxy -> %s model=%s msgs=%d tools=%d", base, model, len(req.Messages), len(req.Tools))
	}

	// SSE ke frontend: status 200 + event-stream. Setelah ini semua hasil
	// (termasuk error) harus lewat event di stream yang sama.
	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	flusher, _ := w.(http.Flusher)
	w.WriteHeader(http.StatusOK)
	if flusher != nil {
		flusher.Flush()
	}
	send := func(obj interface{}) {
		b, err := json.Marshal(obj)
		if err != nil {
			return
		}
		fmt.Fprintf(w, "data: %s\n\n", b)
		if flusher != nil {
			flusher.Flush()
		}
	}

	// Reasoning level dari frontend: 'off' | 'low' | 'normal' (default normal).
	//   off    -> tanpa reasoning (cepat/murah)
	//   low    -> reasoning singkat + reasoning_effort=low (provider OpenAI-compatible)
	//   normal -> reasoning penuh
	// Bila provider menolak flag (400), coba sekali lagi tanpa flag.
	ctx := r.Context()
	thinkRaw := strings.ToLower(strings.TrimSpace(req.Settings.Thinking))
	wantThink := thinkRaw != "off"
	lowThink := thinkRaw == "low"

	call := func(withThinking, bare bool) (aiUpstreamResult, error) {
		if gemini {
			return aiCallGeminiUpstream(ctx, base, key, model, req, thinkRaw, send)
		}
		return aiCallUpstream(ctx, base, key, model, req, withThinking, lowThink && withThinking, bare, send)
	}

	upstream, err := call(wantThink, false)
	if err != nil && isAIStatus(err, 400) {
		if SHOWDEBUG {
			logf("[ai] provider menolak flag thinking/usage (400) — mencoba ulang tanpa flag")
		}
		upstream, err = call(false, true)
	}
	if err != nil && isAIStatus(err, 429) {
		// 429 = batas sesi/rate. Tunggu sekali lalu ulang: provider biasanya
		// membebaskan sesi dalam hitungan detik.
		if SHOWDEBUG {
			logf("[ai] upstream 429 — menunggu 6 detik, mencoba sekali lagi")
		}
		time.Sleep(6 * time.Second)
		upstream, err = call(wantThink, false)
	}
	if err != nil {
		text := err.Error()
		if strings.Contains(text, "is not found") || strings.Contains(text, "not found for API version") {
			text = "Model tidak ditemukan di provider — periksa nama/versi model (untuk Gemini: tombol \"Muat daftar model\" di Settings). Pesan provider: " + text
		}
		send(map[string]interface{}{"error": text})
		return
	}

	thinking := upstream.Reasoning
	if len(thinking) > 8000 {
		thinking = thinking[:8000]
	}
	event := map[string]interface{}{
		"done":       true,
		"reply":      upstream.Content,
		"thinking":   thinking,
		"tool_calls": upstream.ToolCalls,
	}
	if upstream.Usage != nil {
		event["usage"] = upstream.Usage
	}
	send(event)
}

// HandleAIModels adalah endpoint POST /api/models: daftar model Gemini yang bisa
// dipanggil dengan key ini (ListModels). Hanya untuk base URL Google.
func (a *App) HandleAIModels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	defer r.Body.Close()
	var req struct {
		Settings struct {
			BaseURL string `json:"baseUrl"`
			APIKey  string `json:"apiKey"`
		} `json:"settings"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 256<<10)).Decode(&req); err != nil {
		http.Error(w, `{"error":"bad json body"}`, http.StatusBadRequest)
		return
	}
	base := normalizeAIBase(req.Settings.BaseURL)
	key := strings.TrimSpace(req.Settings.APIKey)
	if base == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		fmt.Fprint(w, `{"error":"Base URL kosong — pilih provider atau isi AI API base URL."}`)
		return
	}
	if key == "" && !isLocalHost(base) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		fmt.Fprint(w, `{"error":"Isi dulu AI API key."}`)
		return
	}
	root := strings.TrimRight(base, "/")
	root = strings.TrimSuffix(root, "/v1beta")
	gemini := isGeminiBase(base)
	endpoint := root + "/models"
	if gemini {
		endpoint = root + "/v1beta/models"
	}
	httpReq, err := http.NewRequestWithContext(r.Context(), "GET", endpoint, nil)
	if err != nil {
		http.Error(w, `{"error":"buat request gagal"}`, http.StatusInternalServerError)
		return
	}
	httpReq.Header.Set("Accept", "application/json")
	if gemini {
		httpReq.Header.Set("x-goog-api-key", key)
	} else {
		httpReq.Header.Set("Authorization", "Bearer "+key)
	}
	resp, err := aiHTTPClient.Do(httpReq)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		fmt.Fprintf(w, `{"error":%q}`, err.Error())
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		fmt.Fprintf(w, `{"error":%q}`, readAISnippet(resp.Body, 400))
		return
	}
	names := []string{}
	if gemini {
		var j struct {
			Models []struct {
				Name                      string   `json:"name"`
				SupportedGenerationMethods []string `json:"supportedGenerationMethods"`
			} `json:"models"`
		}
		_ = json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(&j)
		for _, m := range j.Models {
			ok := false
			for _, meth := range m.SupportedGenerationMethods {
				if meth == "generateContent" {
					ok = true
					break
				}
			}
			if ok {
				names = append(names, strings.TrimPrefix(m.Name, "models/"))
			}
		}
	} else {
		// OpenAI standard: { data: [{ id, ... }] }
		var j struct {
			Data []struct {
				ID string `json:"id"`
			} `json:"data"`
			Models []struct {
				ID string `json:"id"`
			} `json:"models"`
		}
		_ = json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(&j)
		for _, m := range j.Data {
			if m.ID != "" {
				names = append(names, m.ID)
			}
		}
		if len(names) == 0 {
			for _, m := range j.Models {
				if m.ID != "" {
					names = append(names, m.ID)
				}
			}
		}
	}
	sort.Strings(names)
	// de-dupe
	uniq := names[:0]
	var prev string
	for _, n := range names {
		if n != prev {
			uniq = append(uniq, n)
			prev = n
		}
	}
	if len(uniq) > 300 {
		uniq = uniq[:300]
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"models": uniq})
}

// isAIStatus mengenali kode status provider dari pesan error ("upstream <code>").
func isAIStatus(err error, code int) bool {
	return err != nil && strings.Contains(err.Error(), fmt.Sprintf("upstream %d", code))
}

// aiDeltaFn dipanggil live untuk setiap potongan reasoning/content sehingga
// panel "pikiran model" terisi sementara model berpikir. Tandanya func(interface{})
// agar cocok dengan `send` (penerbit event SSE) di HandleAIChat.
type aiDeltaFn func(obj interface{})

// aiCallUpstream melakukan SATU permintaan streaming ke {base}/chat/completions
// dan merakit hasilnya. onDelta dipakai untuk mengirim delta live ke frontend.
// lowThink menambahkan reasoning_effort=low (didukung GLM/z.ai; tidak ada
// dampak jika provider mengabaikannya).
func aiCallUpstream(ctx context.Context, base, key, model string, req aiBridgeRequest, withThinking, lowThink, bare bool, onDelta aiDeltaFn) (aiUpstreamResult, error) {
	var out aiUpstreamResult

	payload := map[string]interface{}{
		"model":    model,
		"messages": req.Messages,
		"stream":   true,
	}
	// tool_choice hanya dikirim bila ada tools — beberapa provider
	// OpenAI-compatible menolak (400) `tool_choice:"auto"` tanpa `tools`
	// (mode SVG mengirim tools kosong). Parity dengan Node openaiRequest.
	if len(req.Tools) > 0 {
		payload["tools"] = req.Tools
		payload["tool_choice"] = "auto"
	}
	if !bare {
		payload["stream_options"] = map[string]interface{}{"include_usage": true}
	}
	glm := isGlmHost(base)
	if glm {
		// Model GLM-family: reasoning dikendalikan via flag `thinking`.
		if withThinking {
			payload["thinking"] = map[string]string{"type": "enabled"}
		} else {
			payload["thinking"] = map[string]string{"type": "disabled"}
		}
	}
	if lowThink && withThinking {
		payload["reasoning_effort"] = "low"
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return out, fmt.Errorf("encode payload: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", base+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return out, fmt.Errorf("buat request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	httpReq.Header.Set("Authorization", "Bearer "+key)
	httpReq.Header.Set("Connection", "close")

	resp, err := aiHTTPClient.Do(httpReq)
	if err != nil {
		return out, fmt.Errorf("upstream unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return out, fmt.Errorf("upstream %d: %s", resp.StatusCode, readAISnippet(resp.Body, 500))
	}

	// Parsing SSE provider: kumpulkan reasoning + content delta, dan rakit
	// tool_calls dari delta bertahap (index -> {name, arguments}).
	content := &strings.Builder{}
	reasoning := &strings.Builder{}
	tcb := map[int]*aiTCSlot{}
	var usage *aiUsage

	// forward menerbitkan satu event delta SSE {delta:{thinking|content}} —
	// bentuk persis yang dibaca chat.js. onDelta = send (func(interface{})).
	forward := func(field, text string) {
		if onDelta != nil && text != "" {
			onDelta(map[string]interface{}{
				"delta": map[string]string{field: text},
			})
		}
	}

	err = sseLines(resp.Body, 60*time.Second, func(data string) {
		if data == "[DONE]" {
			return
		}
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content          string `json:"content"`
					ReasoningContent string `json:"reasoning_content"`
					Reasoning        string `json:"reasoning"`
					ToolCalls        []struct {
						Index    *int `json:"index"`
						Function struct {
							Name      string `json:"name"`
							Arguments string `json:"arguments"`
						} `json:"function"`
					} `json:"tool_calls"`
				} `json:"delta"`
			} `json:"choices"`
			Usage *struct {
				PromptTokens     int `json:"prompt_tokens"`
				CompletionTokens int `json:"completion_tokens"`
				TotalTokens      int `json:"total_tokens"`
			} `json:"usage"`
		}
		if json.Unmarshal([]byte(data), &chunk) != nil || len(chunk.Choices) == 0 {
			return
		}
		d := chunk.Choices[0].Delta
		if d.ReasoningContent != "" {
			reasoning.WriteString(d.ReasoningContent)
			forward("thinking", d.ReasoningContent)
		} else if d.Reasoning != "" {
			// sebagian provider memakai "reasoning", bukan "reasoning_content"
			reasoning.WriteString(d.Reasoning)
			forward("thinking", d.Reasoning)
		}
		if d.Content != "" {
			content.WriteString(d.Content)
			forward("content", d.Content)
		}
		for _, tc := range d.ToolCalls {
			idx := 0
			if tc.Index != nil {
				idx = *tc.Index
			}
			slot := tcb[idx]
			if slot == nil {
				slot = &aiTCSlot{}
				tcb[idx] = slot
			}
			if tc.Function.Name != "" {
				slot.name += tc.Function.Name
			}
			if tc.Function.Arguments != "" {
				slot.args.WriteString(tc.Function.Arguments)
			}
		}
		if chunk.Usage != nil {
			u := chunk.Usage
			if u.TotalTokens == 0 {
				u.TotalTokens = u.PromptTokens + u.CompletionTokens
			}
			usage = &aiUsage{PromptTokens: u.PromptTokens, CompletionTokens: u.CompletionTokens, TotalTokens: u.TotalTokens}
		}
	})
	if err != nil {
		return out, err
	}

	out.Content = content.String()
	out.Reasoning = reasoning.String()
	out.ToolCalls = assembleAIToolCalls(tcb)
	out.Usage = usage
	return out, nil
}

// readAISnippet membaca paling banyak max byte dari body untuk pesan error.
func readAISnippet(r io.Reader, max int) string {
	buf := make([]byte, max)
	n, _ := io.ReadFull(r, buf)
	if n < 0 {
		n = 0
	}
	return strings.TrimSpace(string(buf[:n]))
}

// aiTCSlot menampung satu tool_call yang sedang dirakit dari delta bertahap:
// nama fungsinya + argumen JSON yang terakumulasi.
type aiTCSlot struct {
	name string
	args strings.Builder
}

// assembleAIToolCalls mengubah buffer tool_call mentah menjadi daftar siap pakai.
// Validasi nama tool DILAKUKAN FRONTEND (pemilik executor); di sini hanya
// merakit, mem-parse argumen JSON, meng-clamp angka, membuang duplikat
// (provider kadang mengulang chunk akhir) dan membatasi jumlah op.
func assembleAIToolCalls(tcb map[int]*aiTCSlot) []aiToolCall {
	var out []aiToolCall
	seen := map[string]bool{}
	for i := 0; i < len(tcb); i++ {
		slot := tcb[i]
		if slot == nil || slot.name == "" {
			continue
		}
		args := map[string]interface{}{}
		if raw := strings.TrimSpace(slot.args.String()); raw != "" {
			if err := json.Unmarshal([]byte(raw), &args); err != nil {
				continue // argumen bukan JSON valid: skip, jangan kirim ke worksheet
			}
		}
		sanitized := sanitizeAIArgs(args)
		fp := slot.name + "|" + fmt.Sprint(sanitized)
		if seen[fp] {
			continue
		}
		seen[fp] = true
		out = append(out, aiToolCall{Name: slot.name, Arguments: sanitized})
	}
	if len(out) > 20 {
		out = out[:20] // MAX_OPS: batasi jumlah op per putaran
	}
	return out
}

// sseLines membaca body sebagai aliran SSE dan memanggil onEvent untuk setiap
// payload "data:". Idle timeout: bila tidak ada byte selama idle, koneksi
// dianggap menggantung dan dibatalkan. Setiap byte yang tiba mereset timer,
// jadi jawaban panjang yang sehat tidak pernah dipotong.
func sseLines(body io.Reader, idle time.Duration, onEvent func(string)) error {
	type result struct {
		data    string
		hasData bool
		err     error
	}
	lines := make(chan result, 64)

	go func() {
		defer close(lines)
		reader := bufio.NewReaderSize(body, 32*1024)
		for {
			line, err := reader.ReadString('\n')
			if line != "" {
				t := strings.TrimSpace(line)
				if strings.HasPrefix(t, "data:") {
					payload := strings.TrimSpace(strings.TrimPrefix(t, "data:"))
					lines <- result{data: payload, hasData: true}
				}
			}
			if err != nil {
				lines <- result{err: err}
				return
			}
		}
	}()

	timer := time.NewTimer(idle)
	defer timer.Stop()
	for {
		select {
		case res, ok := <-lines:
			if !ok {
				return nil
			}
			if res.err != nil {
				return nil // akhir body normal (atau dibatalkan): selesai
			}
			if res.hasData {
				if !timer.Stop() {
					select {
					case <-timer.C:
					default:
					}
				}
				timer.Reset(idle)
				onEvent(res.data)
			}
		case <-timer.C:
			return fmt.Errorf("upstream idle >%s — connection closed", idle)
		}
	}
}
