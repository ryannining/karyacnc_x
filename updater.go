package main

// Auto-update frontend (web assets) dari GitHub Releases.
//
// Binary Go jarang berubah; HTML/JS sering. Frontend terbaru diunduh dari
// GitHub Release (web.zip + manifest.json), disimpan di cache config dir,
// lalu diserve sebagai pengganti embed fallback.
//
// Struktur manifest.json:
//   {"version":"1.2.3","files":[{"path":"index.html","sha256":"...","size":123},...]}

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	updateRepo  = "ryannining/karyacnc_x"
	manifestURL = "https://github.com/" + updateRepo + "/releases/download/web-latest/manifest.json"
	fileBaseURL = "https://github.com/" + updateRepo + "/releases/download/web-latest/"
)

var updateHTTPClient = &http.Client{Timeout: 15 * time.Second}

var (
	updateMu      sync.Mutex
	currentWebVer = "" // versi web yang sedang aktif di cache
)

type manifestFile struct {
	Path   string `json:"path"`
	Sha256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type manifest struct {
	Version string         `json:"version"`
	Files   []manifestFile `json:"files"`
}

// webCacheDir returns the cache dir, e.g. %APPDATA%/karyacnc/web
func webCacheDir() string {
	return filepath.Join(configDir(), "karyacnc", "web")
}

// fetchManifest downloads manifest.json from GitHub (no token needed for public repo)
func fetchManifest() (*manifest, error) {
	client := updateHTTPClient
	resp, err := client.Get(manifestURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}
	var m manifest
	if err := json.NewDecoder(resp.Body).Decode(&m); err != nil {
		return nil, err
	}
	if m.Version == "" || len(m.Files) == 0 {
		return nil, fmt.Errorf("manifest tidak valid")
	}
	return &m, nil
}

// CheckForUpdate membandingkan manifest remote dengan cache lokal.
// Return: versi terbaru ("" = sudah terbaru), apakah perlu update.
func CheckForUpdate() (latestVersion string, updateAvailable bool, err error) {
	updateMu.Lock()
	defer updateMu.Unlock()

	remote, err := fetchManifest()
	if err != nil {
		return "", false, fmt.Errorf("cek update gagal: %w", err)
	}
	local := readLocalManifest()
	if local != nil && local.Version == remote.Version {
		return remote.Version, false, nil
	}
	return remote.Version, true, nil
}

func readLocalManifest() *manifest {
	data, err := os.ReadFile(filepath.Join(webCacheDir(), "manifest.json"))
	if err != nil {
		return nil
	}
	var m manifest
	if json.Unmarshal(data, &m) != nil || m.Version == "" {
		return nil
	}
	return &m
}

// ApplyUpdate mengunduh file yang berubah saja (delta by sha256), lalu
// atomic-swap manifest. File dengan sha256 sama di-skip.
func ApplyUpdate() (newVersion string, downloaded int, err error) {
	updateMu.Lock()
	defer updateMu.Unlock()

	remote, err := fetchManifest()
	if err != nil {
		return "", 0, fmt.Errorf("fetch manifest gagal: %w", err)
	}
	local := readLocalManifest()
	localByPath := map[string]manifestFile{}
	if local != nil {
		for _, f := range local.Files {
			localByPath[f.Path] = f
		}
	}

	cacheDir := webCacheDir()
	tmpDir := cacheDir + ".tmp"
	_ = os.RemoveAll(tmpDir)
	if err := os.MkdirAll(tmpDir, 0o755); err != nil {
		return "", 0, err
	}

	baseURL := fileBaseURL
	client := updateHTTPClient

	for _, f := range remote.Files {
		if prev, ok := localByPath[f.Path]; ok && prev.Sha256 == f.Sha256 {
			// unchanged: copy from cache
			src := filepath.Join(cacheDir, filepath.FromSlash(f.Path))
			dst := filepath.Join(tmpDir, filepath.FromSlash(f.Path))
			if err := copyFile(src, dst); err != nil {
				// cache missing/corrupt: fall through to download
			} else {
				continue
			}
		}
		// download — release asset name is flat: "assets/x.js" -> "assets__x.js"
		assetName := strings.ReplaceAll(f.Path, "/", "__")
		dst := filepath.Join(tmpDir, filepath.FromSlash(f.Path))
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return "", downloaded, err
		}
		resp, err := client.Get(baseURL + assetName)
		if err != nil {
			return "", downloaded, fmt.Errorf("download %s gagal: %w", f.Path, err)
		}
		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			return "", downloaded, fmt.Errorf("download %s: status %d", f.Path, resp.StatusCode)
		}
		out, err := os.Create(dst)
		if err != nil {
			resp.Body.Close()
			return "", downloaded, err
		}
		h := sha256.New()
		_, copyErr := io.Copy(io.MultiWriter(out, h), resp.Body)
		closeErr := out.Close()
		resp.Body.Close()
		if copyErr != nil {
			return "", downloaded, copyErr
		}
		if closeErr != nil {
			return "", downloaded, closeErr
		}
		got := hex.EncodeToString(h.Sum(nil))
		if got != f.Sha256 {
			return "", downloaded, fmt.Errorf("sha256 mismatch untuk %s", f.Path)
		}
		downloaded++
	}

	// write manifest into tmp
	mb, _ := json.MarshalIndent(remote, "", "  ")
	if err := os.WriteFile(filepath.Join(tmpDir, "manifest.json"), mb, 0o644); err != nil {
		return "", downloaded, err
	}

	// atomic swap: old dir -> .old, tmp -> dir, remove .old
	oldDir := cacheDir + ".old"
	_ = os.RemoveAll(oldDir)
	if err := os.Rename(cacheDir, oldDir); err != nil && !os.IsNotExist(err) {
		return "", downloaded, err
	}
	if err := os.Rename(tmpDir, cacheDir); err != nil {
		// rollback
		_ = os.Rename(oldDir, cacheDir)
		return "", downloaded, err
	}
	_ = os.RemoveAll(oldDir)

	currentWebVer = remote.Version
	return remote.Version, downloaded, nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

// webAssetDir returns the dir to serve web assets from: cache if it has a
// valid manifest, otherwise "" (caller falls back to embedded).
func webAssetDir() string {
	if readLocalManifest() != nil {
		return webCacheDir()
	}
	return ""
}

// UpdateStartup runs in background at startup: check + apply silently.
func StartUpdateCheck() {
	go func() {
		ver, ok, err := CheckForUpdate()
		if err != nil {
			fmt.Println("[update] offline / gagal cek:", err)
			return
		}
		if !ok {
			if m := readLocalManifest(); m != nil {
				currentWebVer = m.Version
			}
			fmt.Println("[update] web sudah versi terbaru", ver)
			return
		}
		newVer, n, err := ApplyUpdate()
		if err != nil {
			fmt.Println("[update] apply gagal (pakai cache lama/embed):", err)
			return
		}
		fmt.Printf("[update] web %s -> %s (%d file didownload)\n", ver, newVer, n)
	}()
}

// webAssetHandler returns handler for Wails AssetServer: cache first, embedded fallback.
func webAssetHandler() http.Handler {
	sub, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		panic(err)
	}
	embedded := http.FileServer(http.FS(sub))
	dir := webAssetDir()
	if dir == "" {
		return embedded // no cache yet: pure embedded
	}
	return serveWebAsset(dir, embedded)
}

// http handler: serve from cache dir if file exists there, else from embedded FS.
// root is either http.FS(embedded) or os dir.
func serveWebAsset(cacheDir string, embedded http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(filepath.ToSlash(r.URL.Path), "/")
		if p == "" {
			p = "index.html"
		}
		full := filepath.Join(cacheDir, filepath.FromSlash(p))
		if !strings.HasPrefix(full, cacheDir) { // path traversal guard
			http.NotFound(w, r)
			return
		}
		if st, err := os.Stat(full); err == nil && !st.IsDir() {
			w.Header().Set("Cache-Control", "no-cache")
			http.ServeFile(w, r, full)
			return
		}
		embedded.ServeHTTP(w, r)
	})
}
