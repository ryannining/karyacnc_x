package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"reflect"
	"sync"
	"syscall"

	"github.com/gorilla/websocket"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// bridge.go — Mode browser: sajikan UI lewat HTTP + WebSocket bridge, lalu buka
// Chrome/Chromium dengan --app=URL. Dipakai supaya binary Linux dapat engine
// Chromium (cepat) tanpa tergantung WebKitGTK. Wails webview tetap tersedia
// lewat flag --webview.
//
// File ini bagian dari linux-patch/ (lihat build-linux.sh) dan diterapkan
// otomatis setelah sinkronisasi dari share — jangan simpan perubahan hanya di sini.

type bridgeClient struct {
	conn *websocket.Conn
	send chan []byte
}

var (
	bridgeMu            sync.Mutex
	bridgeClients       = map[*bridgeClient]struct{}{}
	bridgeEverConnected bool
)

var (
	bridgeErrorType   = reflect.TypeOf((*error)(nil)).Elem()
	bridgeContextType = reflect.TypeOf((*context.Context)(nil)).Elem()
)

var bridgeUpgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

// emit mengirim event ke webview Wails (kalau ada) dan ke semua client bridge.
func (a *App) emit(eventName string, data interface{}) {
	if a.ctx != nil {
		wailsruntime.EventsEmit(a.ctx, eventName, data)
	}
	bridgeBroadcast(eventName, data)
}

func bridgeBroadcast(eventName string, data interface{}) {
	msg, err := json.Marshal(map[string]interface{}{
		"type": "event",
		"name": eventName,
		"data": data,
	})
	if err != nil {
		return
	}
	bridgeMu.Lock()
	defer bridgeMu.Unlock()
	for c := range bridgeClients {
		select {
		case c.send <- msg:
		default:
		}
	}
}

// callBridgeMethod memanggil method exported di App lewat refleksi, dengan
// decoding argumen JSON ala Wails (context.Context otomatis diisi).
func (a *App) callBridgeMethod(name string, rawArgs []json.RawMessage) (interface{}, error) {
	m := reflect.ValueOf(a).MethodByName(name)
	if !m.IsValid() {
		return nil, fmt.Errorf("unknown method: %s", name)
	}
	mt := m.Type()
	callArgs := make([]reflect.Value, 0, mt.NumIn())
	argIdx := 0
	for i := 0; i < mt.NumIn(); i++ {
		pt := mt.In(i)
		if pt == bridgeContextType {
			callArgs = append(callArgs, reflect.ValueOf(context.Background()))
			continue
		}
		if argIdx >= len(rawArgs) {
			callArgs = append(callArgs, reflect.Zero(pt))
			continue
		}
		v := reflect.New(pt)
		if err := json.Unmarshal(rawArgs[argIdx], v.Interface()); err != nil {
			return nil, fmt.Errorf("arg %d: %w", i, err)
		}
		callArgs = append(callArgs, v.Elem())
		argIdx++
	}

	var result interface{}
	for _, o := range m.Call(callArgs) {
		if o.Type().Implements(bridgeErrorType) {
			if !o.IsNil() {
				return nil, o.Interface().(error)
			}
			continue
		}
		result = o.Interface()
	}
	return result, nil
}

type bridgeRequest struct {
	ID     int64             `json:"id"`
	Type   string            `json:"type"`
	Method string            `json:"method"`
	Args   []json.RawMessage `json:"args"`
}

func handleBridgeWS(w http.ResponseWriter, r *http.Request, app *App) {
	conn, err := bridgeUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	client := &bridgeClient{conn: conn, send: make(chan []byte, 64)}
	bridgeMu.Lock()
	bridgeClients[client] = struct{}{}
	bridgeEverConnected = true
	bridgeMu.Unlock()

	go func() {
		for msg := range client.send {
			if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		}
		conn.Close()
	}()

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			break
		}
		var req bridgeRequest
		if err := json.Unmarshal(raw, &req); err != nil {
			continue
		}
		if req.Type != "call" {
			continue
		}
		go func(req bridgeRequest) {
			value, callErr := app.callBridgeMethod(req.Method, req.Args)
			var resp map[string]interface{}
			if callErr != nil {
				resp = map[string]interface{}{"id": req.ID, "type": "error", "error": callErr.Error()}
			} else {
				resp = map[string]interface{}{"id": req.ID, "type": "result", "value": value}
			}
			msg, err := json.Marshal(resp)
			if err != nil {
				return
			}
			select {
			case client.send <- msg:
			default:
			}
		}(req)
	}

	bridgeMu.Lock()
	delete(bridgeClients, client)
	bridgeMu.Unlock()
	close(client.send)
}

var bridgeBrowsers = []string{
	"chromium",
	"chromium-browser",
	"google-chrome",
	"google-chrome-stable",
	"chrome",
	"brave-browser",
	"brave",
	"microsoft-edge",
	"microsoft-edge-stable",
}

func findBrowser() string {
	for _, name := range bridgeBrowsers {
		if path, err := exec.LookPath(name); err == nil {
			return path
		}
	}
	return ""
}

// listenBridge listen di port tetap 8321 — kalau sudah terpakai berarti ada
// instance KaryaCNC lain yang jalan (single instance).
func listenBridge() net.Listener {
	ln, err := net.Listen("tcp", "127.0.0.1:8321")
	if err != nil {
		fmt.Println("KaryaCNC sudah berjalan (port 8321 terpakai).")
		fmt.Println("Tutup dulu instance lain lewat task manager, lalu jalankan lagi.")
		os.Exit(1)
	}
	return ln
}

func configDir() string {
	dir, err := os.UserConfigDir()
	if err != nil || dir == "" {
		dir = os.TempDir()
	}
	return dir
}

func bridgeSawClient() bool {
	bridgeMu.Lock()
	defer bridgeMu.Unlock()
	return bridgeEverConnected
}

// runBrowserMode menjalankan bridge + UI di Chrome/Chromium. Mengembalikan
// false hanya kalau mode auto dan tidak ada browser Chromium sama sekali
// (caller fallback ke webview Wails).
func runBrowserMode(app *App, requireBrowser bool) bool {
	browserBin := findBrowser()
	if browserBin == "" && !requireBrowser {
		return false
	}

	go app.startServer()
	// web update: blocking sebelum browser dibuka supaya UI langsung versi baru
	StartUpdateCheckBlocking()

	sub, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		fmt.Println("ERROR: aset frontend tidak tersedia:", err)
		os.Exit(1)
	}
	embedded := http.FileServer(http.FS(sub))

	ln := listenBridge()
	url := fmt.Sprintf("http://%s/", ln.Addr().String())

	mux := http.NewServeMux()
	mux.HandleFunc("/__bridge", func(w http.ResponseWriter, r *http.Request) {
		handleBridgeWS(w, r, app)
	})
	// Sketcher iframe di :8321 same-origin -> /save-sketch harus dilayani di
	// sini juga (di dev iframe-nya :3000, jadi route ini ada di app.go).
	// Tanpa route ini Save MiniSketch jatuh ke unduhan diam-diam tanpa dialog.
	mux.HandleFunc("/save-sketch", app.handleSaveSketch)
	mux.HandleFunc("/save_sketch", app.handleSaveSketch)
	// web update: serve from cache if fresh copy exists, else embedded
	if dir := webAssetDir(); dir != "" {
		mux.Handle("/", serveWebAsset(dir, embedded))
	} else {
		mux.Handle("/", embedded)
	}
	go http.Serve(ln, mux)

	fmt.Println("Mode browser: UI di", url)
	var browserCmd *exec.Cmd
	if browserBin != "" {
		// user-data-dir khusus supaya Chrome app jalan sebagai proses mandiri:
		// menutup jendela = prosesnya keluar = aplikasi ikut berhenti.
		profileDir := filepath.Join(configDir(), "karyacnc", "webprofile")
		_ = os.MkdirAll(profileDir, 0o755)
		fmt.Println("Membuka", browserBin)
		browserCmd = exec.Command(browserBin, "--app="+url, "--user-data-dir="+profileDir)
		if err := browserCmd.Start(); err != nil {
			fmt.Println("ERROR: gagal membuka browser:", err)
			browserCmd = nil
		} else {
			go func() {
				_ = browserCmd.Wait()
				if bridgeSawClient() {
					fmt.Println("\nJendela ditutup — KaryaCNC berhenti.")
					os.Exit(0)
				}
				fmt.Println("Browser tertutup sebelum UI termuat — buka manual:", url)
			}()
		}
	} else {
		fmt.Println("Chrome/Chromium tidak ditemukan — buka manual URL di atas.")
	}

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
	if browserCmd != nil && browserCmd.Process != nil {
		_ = browserCmd.Process.Kill()
	}
	fmt.Println("\nBridge dihentikan.")
	return true
}
