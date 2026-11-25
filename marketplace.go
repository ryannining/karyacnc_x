package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// marketplace.go — Implementasi server-side Extension Marketplace untuk
// KaryaCNC, parity dengan endpoint marketplace di Node bridge
// (minisketch repo: server/ai-bridge.js). Penyimpanan PERSISTEN memakai
// folder writable di config dir user (embedded FS read-only).
//
// Endpoint yang dilayani (rute didaftarkan di app.go, updater.go, bridge.go):
//   GET    /health
//   GET    /api/marketplace/catalog
//   POST   /api/marketplace/publish
//   GET    /api/marketplace/extensions/{id}.js
//   DELETE /api/marketplace/extensions/{id}

var (
	marketplaceIDRe       = regexp.MustCompile(`^[a-z][a-z0-9-]{1,39}$`)
	marketplaceRegRe      = regexp.MustCompile(`(?i)(?:MiniSketchTools|NS)\s*\.\s*register\s*\(`)
	marketplaceMSKToolsRe = regexp.MustCompile(`\bMiniSketchTools\b`)
	marketplaceDotRegRe   = regexp.MustCompile(`\.register\s*\(`)
	marketplaceIDCodeRe   = regexp.MustCompile(`(?i)['"]?\bid['"]?\s*:\s*(['"])([a-z0-9-]+)`)
	marketplaceSvgRe      = regexp.MustCompile(`(?i)<svg\b[^>]*>[\s\S]*?</svg>`)
	marketplaceDangerRe   = regexp.MustCompile(`(?i)<\s*(script|foreignObject|iframe|object|embed|style)\b|on[a-z]+\s*=|javascript:`)
)

const (
	marketplaceMinCode    = 40
	marketplaceMaxCode    = 200 * 1024
	marketplaceMaxPayload = 512 * 1024
)

func marketplaceDir() string {
	return filepath.Join(configDir(), "karyacnc", "marketplace")
}

func marketplacePaths() (extDir, catalogFile string) {
	dir := marketplaceDir()
	return filepath.Join(dir, "extensions"), filepath.Join(dir, "catalog.json")
}

// readMarketplaceCatalog: utamakan store writable; fallback ke embedded
// minisketch/marketplace/catalog.json.
func readMarketplaceCatalog() map[string]interface{} {
	_, catalogFile := marketplacePaths()
	if raw, err := os.ReadFile(catalogFile); err == nil {
		var parsed map[string]interface{}
		if json.Unmarshal(raw, &parsed) == nil {
			if _, ok := parsed["extensions"]; ok {
				return parsed
			}
		}
	}
	if data, err := minisketchWebFiles.ReadFile("minisketch/marketplace/catalog.json"); err == nil {
		var parsed map[string]interface{}
		if json.Unmarshal(data, &parsed) == nil {
			return parsed
		}
	}
	return map[string]interface{}{
		"marketplaceVersion": 1,
		"name":               "MiniSketch Extension Marketplace",
		"updatedAt":          time.Now().UTC().Format(time.RFC3339),
		"extensions":         []interface{}{},
	}
}

// writeFileAtomic menulis lewat temp lalu rename (hindari file paruh jalan).
func writeFileAtomic(target string, content []byte) error {
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	tmp := target + ".tmp-" + fmt.Sprint(os.Getpid()) + "-" + fmt.Sprint(time.Now().UnixNano())
	if err := os.WriteFile(tmp, content, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, target)
}

func publishKeyValid(supplied string) bool {
	expected := strings.TrimSpace(os.Getenv("MARKETPLACE_PUBLISH_KEY"))
	if expected == "" {
		return true
	}
	return strings.TrimSpace(supplied) == expected
}

func sanitizeIcon(raw string) string {
	icon := strings.TrimSpace(raw)
	if icon == "" || !marketplaceSvgRe.MatchString(icon) || marketplaceDangerRe.MatchString(icon) {
		return ""
	}
	if len(icon) > 2048 {
		icon = icon[:2048]
	}
	return icon
}

// validateExtensionPayload meniru validasi Node bridge (tanpa sandbox JS):
// format id, field wajib, panjang & pola kode, dan kecocokan id yang
// diregistrasi.
func validateExtensionPayload(meta map[string]interface{}, code string) (map[string]interface{}, string) {
	id := strings.ToLower(strings.TrimSpace(fmt.Sprint(meta["id"])))
	if !marketplaceIDRe.MatchString(id) {
		return nil, "Extension ID must be 2-40 lowercase letters, digits, or hyphens (starting with a letter)."
	}
	name := strings.TrimSpace(fmt.Sprint(meta["name"]))
	if name == "" {
		return nil, "Extension name is required."
	}
	if len(name) > 80 {
		name = name[:80]
	}
	version := strings.TrimSpace(fmt.Sprint(meta["version"]))
	if version == "" {
		version = "1.0.0"
	}
	if len(version) > 32 {
		version = version[:32]
	}
	author := strings.TrimSpace(fmt.Sprint(meta["author"]))
	if author == "" {
		author = "Community"
	}
	if len(author) > 60 {
		author = author[:60]
	}
	category := strings.TrimSpace(fmt.Sprint(meta["category"]))
	if category == "" {
		category = "CNC Utility"
	}
	if len(category) > 40 {
		category = category[:40]
	}
	description := strings.TrimSpace(fmt.Sprint(meta["description"]))
	if len(description) > 240 {
		description = description[:240]
	}
	if n := len(code); n < marketplaceMinCode || n > marketplaceMaxCode {
		return nil, "Extension code must be between 40 bytes and 200 KB."
	}
	hasReg := marketplaceRegRe.MatchString(code) ||
		(marketplaceMSKToolsRe.MatchString(code) && marketplaceDotRegRe.MatchString(code))
	if !hasReg {
		return nil, "Extension must call MiniSketchTools.register({...})."
	}
	registeredID := ""
	if m := marketplaceIDCodeRe.FindStringSubmatch(code); m != nil {
		registeredID = strings.ToLower(m[2])
	}
	if registeredID == "" || registeredID != id {
		return nil, "Code register({ id }) must match Extension ID \"" + id + "\"."
	}
	entry := map[string]interface{}{
		"id":            id,
		"name":          name,
		"version":       version,
		"author":        author,
		"category":      category,
		"description":   description,
		"scriptUrl":     "extensions/" + id + ".js",
		"minAppVersion": "1.0.0",
		"updatedAt":     time.Now().UTC().Format(time.RFC3339),
	}
	if icon := sanitizeIcon(fmt.Sprint(meta["icon"])); icon != "" {
		entry["icon"] = icon
	}
	return entry, ""
}

func writeJSONErr(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"error": msg})
}

// handleHealth — parity dengan Node bridge GET /health.
func handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	envKey := strings.TrimSpace(os.Getenv("OPENAI_API_KEY")) != ""
	envBase := strings.TrimSpace(os.Getenv("OPENAI_BASE_URL")) != ""
	pubKey := strings.TrimSpace(os.Getenv("MARKETPLACE_PUBLISH_KEY")) != ""
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":                 true,
		"proxy":              true,
		"hasEnvKey":          envKey,
		"hasEnvBase":         envBase,
		"requiresPublishKey": pubKey,
	})
}

// handleMarketplaceAPI dispatch semua endpoint marketplace.
func (a *App) handleMarketplaceAPI(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.URL.Path == "/api/marketplace/catalog":
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		cat := readMarketplaceCatalog()
		resp := map[string]interface{}{"ok": true}
		for k, v := range cat {
			resp[k] = v
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(resp)

	case r.URL.Path == "/api/marketplace/publish":
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		a.marketplacePublish(w, r)

	case strings.HasPrefix(r.URL.Path, "/api/marketplace/extensions/"):
		id := strings.TrimPrefix(r.URL.Path, "/api/marketplace/extensions/")
		id = strings.TrimSuffix(id, ".js")
		switch r.Method {
		case http.MethodGet:
			a.marketplaceExtensionGet(w, r, id)
		case http.MethodDelete:
			a.marketplaceExtensionDelete(w, r, id)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}

	default:
		http.NotFound(w, r)
	}
}

func (a *App) marketplacePublish(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, marketplaceMaxPayload+1))
	if err != nil {
		writeJSONErr(w, 400, "Invalid JSON body.")
		return
	}
	if len(raw) > marketplaceMaxPayload {
		writeJSONErr(w, 413, "Payload too large (max 512 KB).")
		return
	}
	var input struct {
		Meta      map[string]interface{} `json:"meta"`
		Code      string                 `json:"code"`
		Overwrite bool                   `json:"overwrite"`
	}
	if json.Unmarshal(raw, &input) != nil {
		writeJSONErr(w, 400, "Invalid JSON body.")
		return
	}
	meta := input.Meta
	if meta == nil {
		meta = map[string]interface{}{}
	}
	if !publishKeyValid(r.Header.Get("X-Publish-Key")) {
		writeJSONErr(w, 401, "Invalid or missing Publish Key.")
		return
	}
	entry, verr := validateExtensionPayload(meta, input.Code)
	if verr != "" {
		writeJSONErr(w, 400, verr)
		return
	}
	extDir, catalogFile := marketplacePaths()
	id := entry["id"].(string)
	target := filepath.Join(extDir, id+".js")
	if _, statErr := os.Stat(target); statErr == nil && !input.Overwrite {
		writeJSONErr(w, 409, "Extension \""+id+"\" already exists in Marketplace (enable overwrite to update).")
		return
	}
	if werr := writeFileAtomic(target, []byte(input.Code)); werr != nil {
		writeJSONErr(w, 500, werr.Error())
		return
	}
	cat := readMarketplaceCatalog()
	exts, _ := cat["extensions"].([]interface{})
	if exts == nil {
		exts = []interface{}{}
	}
	found := -1
	for i, e := range exts {
		if em, ok := e.(map[string]interface{}); ok && em["id"] == id {
			found = i
			break
		}
	}
	if found >= 0 {
		exts[found] = entry
	} else {
		exts = append(exts, entry)
	}
	cat["extensions"] = exts
	cat["updatedAt"] = time.Now().UTC().Format(time.RFC3339)
	catJSON, _ := json.MarshalIndent(cat, "", "  ")
	catJSON = append(catJSON, '\n')
	if werr := writeFileAtomic(catalogFile, catJSON); werr != nil {
		writeJSONErr(w, 500, werr.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":        true,
		"scriptUrl": entry["scriptUrl"],
		"entry":     entry,
		"catalog":   cat,
	})
}

func (a *App) marketplaceExtensionGet(w http.ResponseWriter, r *http.Request, id string) {
	if !marketplaceIDRe.MatchString(id) {
		writeJSONErr(w, 400, "Invalid extension ID.")
		return
	}
	extDir, _ := marketplacePaths()
	rel := id + ".js"
	if data, err := os.ReadFile(filepath.Join(extDir, rel)); err == nil {
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(data)
		return
	}
	if data, err := minisketchWebFiles.ReadFile("minisketch/marketplace/extensions/" + rel); err == nil {
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(data)
		return
	}
	writeJSONErr(w, 404, "Extension script not found.")
}

func (a *App) marketplaceExtensionDelete(w http.ResponseWriter, r *http.Request, id string) {
	if !publishKeyValid(r.Header.Get("X-Publish-Key")) {
		writeJSONErr(w, 401, "Invalid or missing Publish Key.")
		return
	}
	if !marketplaceIDRe.MatchString(id) {
		writeJSONErr(w, 400, "Invalid extension ID.")
		return
	}
	extDir, catalogFile := marketplacePaths()
	_ = os.Remove(filepath.Join(extDir, id+".js"))
	cat := readMarketplaceCatalog()
	exts, _ := cat["extensions"].([]interface{})
	out := exts[:0]
	for _, e := range exts {
		if em, ok := e.(map[string]interface{}); ok && em["id"] == id {
			continue
		}
		out = append(out, e)
	}
	cat["extensions"] = out
	cat["updatedAt"] = time.Now().UTC().Format(time.RFC3339)
	catJSON, _ := json.MarshalIndent(cat, "", "  ")
	catJSON = append(catJSON, '\n')
	_ = writeFileAtomic(catalogFile, catJSON)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "id": id, "catalog": cat})
}
