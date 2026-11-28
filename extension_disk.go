package main

// extension_disk.go — Disk persistence for AI-built extensions.
//
// Mirrors the Node bridge endpoints (minisketch server/ai-bridge.js):
//   POST   /api/extensions/save   -> write extensions/saved/<id>.js
//   GET    /api/extensions/saved  -> list saved extensions
//   DELETE /api/extensions/saved?id=... -> remove a saved file
//
// Private-network guard: allowed from loopback + LAN (10/8, 172.16/12,
// 192.168/16), refused from public addresses.

import (
	"encoding/json"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// extensionsSavedDir returns the folder that holds saved extension sources.
// Overridable with KARYACNC_EXT_DIR; defaults to <executable dir>/extensions/saved.
func extensionsSavedDir() string {
	if d := strings.TrimSpace(os.Getenv("KARYACNC_EXT_DIR")); d != "" {
		return d
	}
	exe, err := os.Executable()
	if err == nil {
		return filepath.Join(filepath.Dir(exe), "extensions", "saved")
	}
	return filepath.Join("extensions", "saved")
}

// privateNetAllowed is the Go-side twin of the frontend isLoopbackHost().
func privateNetAllowed(r *http.Request) bool {
	host := strings.ToLower(strings.TrimSpace(r.Host))
	if host == "localhost" || strings.HasPrefix(host, "127.") || strings.HasPrefix(host, "[::1]") {
		return true
	}
	ip := net.ParseIP(strings.TrimPrefix(r.RemoteAddr, "[::1]"))
	// r.RemoteAddr may include port; strip it.
	if h, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		ip = net.ParseIP(h)
	}
	if ip == nil {
		return false
	}
	if ip.IsLoopback() {
		return true
	}
	v4 := ip.To4()
	if v4 == nil {
		return false
	}
	a, b := int(v4[0]), int(v4[1])
	if a == 10 {
		return true
	}
	if a == 172 && b >= 16 && b <= 31 {
		return true
	}
	if a == 192 && b == 168 {
		return true
	}
	return false
}

var safeIDRe = regexp.MustCompile(`[^a-z0-9_-]`)

func (a *App) handleExtensionSaveDisk(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
		return
	}
	if !privateNetAllowed(r) {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "save-to-disk is private-network only"})
		return
	}
	var payload struct {
		ID    string `json:"id"`
		Label string `json:"label"`
		Code  string `json:"code"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512<<10)).Decode(&payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "bad json"})
		return
	}
	id := strings.TrimSpace(payload.ID)
	code := strings.TrimSpace(payload.Code)
	if id == "" || code == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "id and code are required"})
		return
	}
	fileName := safeIDRe.ReplaceAllString(id, "-") + ".js"
	dir := extensionsSavedDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	label := strings.ReplaceAll(payload.Label, "\n", " ")
	header := "// saved by MiniSketch (server disk) — id: " + id + "\n" +
		"// label: " + label + "\n"
	path := filepath.Join(dir, fileName)
	if err := os.WriteFile(path, []byte(header+code+"\n"), 0o644); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "file": fileName, "dir": dir})
}

func (a *App) handleExtensionSavedDisk(w http.ResponseWriter, r *http.Request) {
	if !privateNetAllowed(r) {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "private-network only"})
		return
	}
	dir := extensionsSavedDir()
	switch r.Method {
	case http.MethodGet:
		entries := []map[string]any{}
		files, err := os.ReadDir(dir)
		if err != nil {
			// folder not created yet → empty list, not an error
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "saved": entries})
			return
		}
		for _, f := range files {
			if f.IsDir() || !strings.HasSuffix(f.Name(), ".js") {
				continue
			}
			full := filepath.Join(dir, f.Name())
			b, err := os.ReadFile(full)
			if err != nil {
				continue
			}
			code := string(b)
			rec := map[string]any{"file": f.Name(), "id": strings.TrimSuffix(f.Name(), ".js"), "label": "", "code": code}
			if m := regexp.MustCompile(`id:\s*([A-Za-z0-9_-]+)`).FindStringSubmatch(code); len(m) > 1 {
				rec["id"] = m[1]
			}
			if m := regexp.MustCompile(`label:\s*(.*)`).FindStringSubmatch(code); len(m) > 1 {
				rec["label"] = strings.TrimSpace(m[1])
			}
			entries = append(entries, rec)
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "saved": entries})
	case http.MethodDelete:
		id := strings.TrimSpace(r.URL.Query().Get("id"))
		if id == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "id required"})
			return
		}
		fileName := safeIDRe.ReplaceAllString(id, "-") + ".js"
		full := filepath.Join(dir, fileName)
		if _, err := os.Stat(full); os.IsNotExist(err) {
			writeJSON(w, http.StatusNotFound, map[string]any{"ok": false, "error": "not found"})
			return
		}
		if err := os.Remove(full); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "file": fileName})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
