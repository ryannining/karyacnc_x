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
	"net/url"
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

// cachePathFor maps a manifest path (frontend/... minisketch/... tools_invoice/...)
// to its location in the cache dir.
func cachePathFor(manifestPath string) string {
	return filepath.Join(webCacheDir(), filepath.FromSlash(manifestPath))
}

// servePathFor maps an HTTP request path to a manifest path.
//   /            -> frontend/index.html
//   /app.js      -> frontend/app.js
//   /sketcher/x  -> minisketch/x
//   /invoice.html -> tools_invoice/invoice.html
func servePathFor(reqPath string) (manifestPath string, ok bool) {
	p := strings.TrimPrefix(filepath.ToSlash(reqPath), "/")
	switch {
	case p == "invoice.html" || strings.HasPrefix(p, "invoice/"):
		return "tools_invoice/" + p, true
	case p == "sketcher" || p == "sketcher/":
		return "minisketch/index.html", true
	case strings.HasPrefix(p, "sketcher/"):
		return "minisketch/" + strings.TrimPrefix(p, "sketcher/"), true
	default:
		if p == "" {
			p = "index.html"
		}
		return "frontend/" + p, true
	}
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
// Return: versi terbaru ("" = sudah terbaru), apakah ada update.
func CheckForUpdate() (latestVersion string, updateAvailable bool, err error) {
	updateMu.Lock()
	defer updateMu.Unlock()

	fmt.Println("[update] cek manifest:", manifestURL)
	remote, err := fetchManifest()
	if err != nil {
		fmt.Println("[update] cek gagal:", err)
		return "", false, fmt.Errorf("cek update gagal: %w", err)
	}
	local := readLocalManifest()
	localVer := "tidak ada (pakai embedded)"
	if local != nil {
		localVer = local.Version
	}
	fmt.Printf("[update] versi lokal: %s | remote: %s\n", localVer, remote.Version)
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

	fmt.Printf("[update] update tersedia: %d file dicek...\n", len(remote.Files))
	skipped := 0
	for _, f := range remote.Files {
		if prev, ok := localByPath[f.Path]; ok && prev.Sha256 == f.Sha256 {
			// unchanged: copy from cache
			src := filepath.Join(cacheDir, filepath.FromSlash(f.Path))
			dst := filepath.Join(tmpDir, filepath.FromSlash(f.Path))
			if err := copyFile(src, dst); err != nil {
				// cache missing/corrupt: fall through to download
			} else {
				skipped++
				continue
			}
		}
		// download — release asset name is flat: "assets/x.js" -> "assets__x.js"
		assetName := strings.ReplaceAll(f.Path, "/", "__")
		fmt.Printf("[update] download: %s (%d bytes)\n", f.Path, f.Size)
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
	fmt.Printf("[update] selesai: %d didownload, %d dipakai dari cache (total %d file)\n", downloaded, skipped, len(remote.Files))
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

// StartUpdateCheckBlocking: cek + apply update SEBELUM UI dibuka.
// Dipanggil sinkron dari runBrowserMode / wails OnStartup:
// - online + ada update: download dulu (delta), lalu UI load versi baru
// - offline / gagal: lanjut pakai cache/embed, UI tetap muncul
// Timeout keseluruhan 20s supaya user tidak menunggu lama di layar kosong.
func StartUpdateCheckBlocking() {
	done := make(chan struct{})
	go func() {
		defer close(done)
		ver, ok, err := CheckForUpdate()
		if err != nil {
			fmt.Println("[update] offline / gagal cek (pakai cache/embed):", err)
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
		fmt.Printf("[update] web %s -> %s (%d file didownload). UI memuat versi baru.\n", ver, newVer, n)
	}()
	select {
	case <-done:
	case <-time.After(20 * time.Second):
		fmt.Println("[update] timeout 20s — lanjut pakai cache/embed, update lanjut di background")
	}
}

// UpdateStartup runs in background at startup: check + apply.
func StartUpdateCheck() {
	go func() {
		fmt.Println("[update] auto-check di startup...")
		ver, ok, err := CheckForUpdate()
		if err != nil {
			fmt.Println("[update] offline / gagal cek (pakai cache/embed):", err)
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
		fmt.Printf("[update] web %s -> %s (%d file didownload). Refresh halaman untuk pakai versi baru.\n", ver, newVer, n)
	}()
}

// CheckWebUpdate cek update frontend dari GitHub (dipanggil dari UI).
func (a *App) CheckWebUpdate() (map[string]interface{}, error) {
	ver, ok, err := CheckForUpdate()
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"latestVersion":        ver,
		"updateAvailable":      ok,
		"currentVersion":       currentWebVersion(),
	}, nil
}

// ApplyWebUpdate download + apply update frontend (dipanggil dari UI).
func (a *App) ApplyWebUpdate() (map[string]interface{}, error) {
	ver, n, err := ApplyUpdate()
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"version":    ver,
		"downloaded": n,
		"message":    fmt.Sprintf("Web diupdate ke %s (%d file didownload). Refresh halaman untuk memakai versi baru.", ver, n),
	}, nil
}

func currentWebVersion() string {
	if m := readLocalManifest(); m != nil {
		return m.Version
	}
	return "embedded"
}

// webAssetHandler returns handler for Wails AssetServer: cache first, embedded fallback.
// Cache dicek tiap request (bukan sekali di startup) agar update web yang
// tiba (selama aplikasi hidup) segera diterima tanpa restart.
func webAssetHandler() http.Handler {
	sub, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		panic(err)
	}
	embedded := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		dir := webAssetDir()
		if dir == "" {
			embedded.ServeHTTP(w, r)
			return
		}
		serveWebAsset(dir, embedded).ServeHTTP(w, r)
	})
}

// http handler: serve from cache (frontend/ minisketch/ tools_invoice/),
// fallback ke embedded FS.
func serveWebAsset(cacheDir string, embedded http.Handler) http.Handler {
	msSub, _ := fs.Sub(minisketchWebFiles, "minisketch")
	invSub, _ := fs.Sub(invoiceFiles, "tools_invoice")
	embeddedMinisketch := http.FileServer(http.FS(msSub))
	embeddedInvoice := http.FileServer(http.FS(invSub))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		manifestPath, _ := servePathFor(r.URL.Path)
		full := cachePathFor(manifestPath)
		if st, err := os.Stat(full); err == nil && !st.IsDir() {
			w.Header().Set("Cache-Control", "no-cache")
			http.ServeFile(w, r, full)
			return
		}
		// cache miss: fallback ke embedded
		if strings.HasPrefix(manifestPath, "minisketch/") {
			// sketcher: embedded serve butuh path tanpa prefix
			r2 := new(http.Request)
			*r2 = *r
			r2.URL = new(url.URL)
			*r2.URL = *r.URL
			r2.URL.Path = strings.TrimPrefix(r.URL.Path, "/sketcher")
			if r2.URL.Path == "" || r2.URL.Path == "/" {
				r2.URL.Path = "/index.html"
			}
			embeddedMinisketch.ServeHTTP(w, r2)
			return
		}
		if strings.HasPrefix(manifestPath, "tools_invoice/") {
			embeddedInvoice.ServeHTTP(w, r)
			return
		}
		embedded.ServeHTTP(w, r)
	})
}
