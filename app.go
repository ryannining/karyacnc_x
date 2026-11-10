package main

import (
	"bytes"
	"context"
	"embed"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"io/fs"
	"log"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	goruntime "runtime"
	"sort"
	"strings"
	"sync"
	"time"
	"unsafe"

	"github.com/gorilla/websocket"
	"github.com/kbinani/screenshot"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// SHOWDEBUG controls whether debug/log messages are printed
var SHOWDEBUG = false

//go:embed all:frontend/inkscape_ex
var inkscapeFiles embed.FS

//go:embed all:nestjs2/frontend
var nestjs2WebFiles embed.FS

//go:embed all:minisketch
var minisketchWebFiles embed.FS

//go:embed all:tools_invoice
var invoiceFiles embed.FS

// RajaOngkir configuration (digunakan oleh handler proxy di port 3000)
var (
	roKeyMu          sync.RWMutex
	rajaOngkirKey    = "87f1bef2655d3725f9f68d478668887c"
	rajaOngkirBase   = "https://rajaongkir.komerce.id/api/v1"
	defaultOriginID  = 64967
	defaultOriginLbl = "SUKOREJO, GUNUNGPATI, SEMARANG"
	invoicePublicURL = "http://localhost:3000/invoice.html"
)

func getRajaOngkirKey() string {
	roKeyMu.RLock()
	defer roKeyMu.RUnlock()
	return rajaOngkirKey
}

func setRajaOngkirKey(k string) {
	roKeyMu.Lock()
	defer roKeyMu.Unlock()
	rajaOngkirKey = k
}

// ---------- RajaOngkir cache (L1 in-memory + L2 disk JSON) ----------

type roCacheEntry struct {
	Status  int             `json:"status"`
	Body    json.RawMessage `json:"body"`
	Expires int64           `json:"expires"` // unix millis
}

type roCache struct {
	mu      sync.RWMutex
	mem     map[string]roCacheEntry
	baseDir string
}

func (a *App) initRajaOngkirCache() {
	baseDir, err := os.UserConfigDir()
	if err != nil || baseDir == "" {
		baseDir = os.TempDir()
	}
	dir := filepath.Join(baseDir, "karyacnc", "invoice_cache")
	a.roCache = &roCache{
		mem:     make(map[string]roCacheEntry),
		baseDir: dir,
	}
	_ = os.MkdirAll(filepath.Join(dir, "destination"), 0o755)
	_ = os.MkdirAll(filepath.Join(dir, "cost"), 0o755)
	if SHOWDEBUG {
		log.Printf("RajaOngkir cache dir: %s", dir)
	}
}

func sanitizeCacheKey(s string) string {
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'a' && c <= 'z',
			c >= 'A' && c <= 'Z',
			c >= '0' && c <= '9',
			c == '-' || c == '_' || c == '.':
			out = append(out, c)
		default:
			out = append(out, '_')
		}
	}
	return string(out)
}

func (c *roCache) diskPath(endpoint, key string) string {
	return filepath.Join(c.baseDir, endpoint, key+".json")
}

func (c *roCache) Get(key string) (roCacheEntry, bool) {
	c.mu.RLock()
	e, ok := c.mem[key]
	c.mu.RUnlock()
	if ok && e.Expires > time.Now().UnixMilli() {
		return e, true
	}
	if ok {
		// Expired in L1; clean up
		c.mu.Lock()
		delete(c.mem, key)
		c.mu.Unlock()
	}
	// L2 lookup
	ep, fileKey := splitCacheKey(key)
	path := c.diskPath(ep, fileKey)
	data, err := os.ReadFile(path)
	if err != nil {
		return roCacheEntry{}, false
	}
	var entry roCacheEntry
	if err := json.Unmarshal(data, &entry); err != nil {
		return roCacheEntry{}, false
	}
	if entry.Expires <= time.Now().UnixMilli() {
		_ = os.Remove(path)
		return roCacheEntry{}, false
	}
	// Promote to L1
	c.mu.Lock()
	c.mem[key] = entry
	c.mu.Unlock()
	return entry, true
}

func (c *roCache) Set(key string, status int, body []byte, ttl time.Duration) {
	entry := roCacheEntry{
		Status:  status,
		Body:    json.RawMessage(append([]byte(nil), body...)),
		Expires: time.Now().Add(ttl).UnixMilli(),
	}
	// L1
	c.mu.Lock()
	c.mem[key] = entry
	c.mu.Unlock()
	// L2
	ep, fileKey := splitCacheKey(key)
	path := c.diskPath(ep, fileKey)
	tmp := path + ".tmp"
	data, err := json.Marshal(entry)
	if err != nil {
		return
	}
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return
	}
	_ = os.Rename(tmp, path)
}

func (c *roCache) DeleteOne(key string) {
	c.mu.Lock()
	delete(c.mem, key)
	c.mu.Unlock()
	ep, fileKey := splitCacheKey(key)
	_ = os.Remove(c.diskPath(ep, fileKey))
}

func (c *roCache) DeleteAll() int {
	c.mu.Lock()
	count := len(c.mem)
	c.mem = make(map[string]roCacheEntry)
	c.mu.Unlock()
	removed := 0
	for _, sub := range []string{"destination", "cost"} {
		dir := filepath.Join(c.baseDir, sub)
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if !e.IsDir() {
				if err := os.Remove(filepath.Join(dir, e.Name())); err == nil {
					removed++
				}
			}
		}
	}
	return count + removed
}

func (c *roCache) Stats() (memCount, diskCount int) {
	c.mu.RLock()
	memCount = len(c.mem)
	c.mu.RUnlock()
	for _, sub := range []string{"destination", "cost"} {
		entries, err := os.ReadDir(filepath.Join(c.baseDir, sub))
		if err != nil {
			continue
		}
		for _, e := range entries {
			if !e.IsDir() && filepath.Ext(e.Name()) == ".json" {
				diskCount++
			}
		}
	}
	return
}

// buildCacheKey memformat key. Format: "<endpoint>:<sanitized>".
func buildCacheKey(method, target string, body url.Values) string {
	if method == "GET" {
		ep := "destination"
		if strings.Contains(target, "/calculate/") {
			ep = "cost"
		}
		u, _ := url.Parse(target)
		qs := u.Query()
		// Serialize in stable order
		keys := make([]string, 0, len(qs))
		for k := range qs {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		var parts []string
		for _, k := range keys {
			parts = append(parts, k+"="+qs.Get(k))
		}
		return ep + ":" + sanitizeCacheKey(strings.Join(parts, "&"))
	}
	// POST → cost
	keys := make([]string, 0, len(body))
	for k := range body {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var parts []string
	for _, k := range keys {
		parts = append(parts, k+"="+body.Get(k))
	}
	return "cost:" + sanitizeCacheKey(strings.Join(parts, "&"))
}

func splitCacheKey(key string) (endpoint, fileKey string) {
	i := strings.IndexByte(key, ':')
	if i < 0 {
		return "unknown", key
	}
	return key[:i], key[i+1:]
}

// TTL sesuai konvensi plan
func ttlForRajaOngkirStatus(status int) time.Duration {
	switch {
	case status >= 200 && status < 300:
		return 7 * 24 * time.Hour // default success = cost TTL; destination akan override di caller
	case status == 429:
		return 5 * time.Minute
	case status >= 400 && status < 500:
		return 5 * time.Minute
	case status >= 500:
		return 5 * time.Minute
	}
	return 1 * time.Minute
}

// App struct
type App struct {
	ctx            context.Context
	stream         net.Conn
	streamMutex    sync.Mutex
	wsServer       *http.Server
	wsServerMutex  sync.Mutex
	storedSvgMutex sync.Mutex
	roCache        *roCache
	roCacheMu      sync.Mutex

	storedSvgData       string
	storedSvgTimestamp  int64
	storedresultSvgData string

	profilesMutex sync.Mutex
	profilesJSON  string
}

// MachinePosition represents the machine position data
type MachinePosition struct {
	X        float32 `json:"x"`
	Y        float32 `json:"y"`
	Z        float32 `json:"z"`
	Velocity float32 `json:"velocity"`
	MoveID   uint8   `json:"move_id"`
}

// MachineJob represents the machine job data
type MachineJob struct {
	Name     string `json:"name"`
	Status   uint8  `json:"status"`
	Progress uint8  `json:"progress"`
}

// NewApp creates a new App application struct
func NewApp() *App {
	a := &App{}
	a.initRajaOngkirCache()
	return a
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if SHOWDEBUG {
		fmt.Println("Setup called")
	}
	go a.startServer()
}

// UploadFile uploads a file to the specified IP address
func (a *App) UploadFile(ip string, filename string, data []byte) (string, error) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	part, err := writer.CreateFormFile("file1", filename)
	if err != nil {
		return "", fmt.Errorf("failed to create form file: %w", err)
	}

	_, err = part.Write(data)
	if err != nil {
		return "", fmt.Errorf("failed to write file data: %w", err)
	}

	err = writer.Close()
	if err != nil {
		return "", fmt.Errorf("failed to close writer: %w", err)
	}

	url := fmt.Sprintf("http://%s/upload", ip)
	req, err := http.NewRequest("POST", url, body)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", writer.FormDataContentType())

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return "Upload successful", nil
	}

	return "", fmt.Errorf("upload failed with status: %d", resp.StatusCode)
}

// SetProfiles menerima JSON jobsettings dari frontend (PC master) untuk
// diserve ke slave lewat GET /api/profiles.
func (a *App) SetProfiles(profilesJSON string) {
	a.profilesMutex.Lock()
	a.profilesJSON = profilesJSON
	a.profilesMutex.Unlock()
}

// ProxyRequest makes a GET request to the specified URL
func (a *App) ProxyRequest(url string) (string, error) {
	resp, err := http.Get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	return string(body), nil
}

// StartWSServer starts a WebSocket server on the specified port
func (a *App) StartWSServer(port uint16) {
	// Close previous server if running
	a.wsServerMutex.Lock()
	if a.wsServer != nil {
		if SHOWDEBUG {
			fmt.Println("Closing WebSocket server")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer cancel()
		a.wsServer.Shutdown(ctx)
		a.wsServer = nil
		time.Sleep(10 * time.Millisecond)
	}
	a.wsServerMutex.Unlock()

	if SHOWDEBUG {
		fmt.Printf("Starting WebSocket server on port %d...\n", port)
	}
	addr := fmt.Sprintf("0.0.0.0:%d", port)

	mux := http.NewServeMux()
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true
		},
	}

	// Handle Telegram endpoint /t
	mux.HandleFunc("/t", a.handleTelegramRequest)

	// Handle WebSocket at root
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			if SHOWDEBUG {
				fmt.Printf("[WS] Failed to upgrade connection: %v\n", err)
			}
			return
		}
		peer := r.RemoteAddr
		if SHOWDEBUG {
			fmt.Printf("[WS] Incoming WebSocket connection from: %s\n", peer)
		}
		go a.handleConnection(peer, conn)
	})

	server := &http.Server{
		Addr:    addr,
		Handler: mux,
	}

	a.wsServerMutex.Lock()
	a.wsServer = server
	a.wsServerMutex.Unlock()

	go func() {
		if SHOWDEBUG {
			fmt.Printf("[WS] WebSocket server listening on %s\n", addr)
		}
		a.emit("WS_SERVER_STARTED", addr)

		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			if SHOWDEBUG {
				fmt.Printf("[WS] Failed to start WebSocket server: %v\n", err)
			}
		}
	}()
}

func (a *App) handleTelegramRequest(w http.ResponseWriter, r *http.Request) {
	if SHOWDEBUG {
		log.Printf("[Telegram] Received request: %s %s", r.Method, r.URL.Path)
	}

	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", 405)
		return
	}

	// Extract query parameters
	bot := r.URL.Query().Get("bot")
	id := r.URL.Query().Get("id")
	text := r.URL.Query().Get("t")

	if SHOWDEBUG {
		log.Printf("[Telegram] bot=%s, id=%s, text=%s", bot, id, text)
	}

	// Emit event to frontend with the parameters
	a.emit("TELEGRAM_REQUEST", map[string]string{
		"bot":  bot,
		"id":   id,
		"text": text,
	})

	// Return OK response
	w.Header().Set("Content-Type", "text/plain")
	w.Header().Set("Content-Length", "2")
	w.WriteHeader(http.StatusOK)
	io.WriteString(w, "OK")
}

func (a *App) handleConnection(peer string, conn *websocket.Conn) {
	defer conn.Close()

	var buff strings.Builder

	for {
		msgType, message, err := conn.ReadMessage()
		if err != nil {
			if SHOWDEBUG {
				fmt.Printf("[WS] Error reading from %s: %v\n", peer, err)
			}
			break
		}

		if msgType == websocket.TextMessage {
			text := string(message)
			if text == ">REVECTOR2" {
				if SHOWDEBUG {
					fmt.Printf("[WS] Received full message from %s. Processing...\n", peer)
				}
				a.emit("WS_MESSAGE_RECEIVED", buff.String())

				// Acknowledge receipt to the client
				if err := conn.WriteMessage(websocket.TextMessage, []byte("ACK")); err != nil {
					if SHOWDEBUG {
						fmt.Printf("[WS] Failed to send ACK to %s: %v\n", peer, err)
					}
					break
				}

				buff.Reset()
			} else {
				if SHOWDEBUG {
					fmt.Printf("[WS] Received partial message from %s\n", peer)
				}
				buff.WriteString(text)
			}
		} else if msgType == websocket.BinaryMessage {
			if SHOWDEBUG {
				fmt.Printf("[WS] Received unexpected binary message from %s\n", peer)
			}
		} else if msgType == websocket.CloseMessage {
			if SHOWDEBUG {
				fmt.Printf("[WS] Connection with %s closed.\n", peer)
			}
			break
		}
	}

	if SHOWDEBUG {
		fmt.Printf("[WS] Client %s disconnected.\n", peer)
	}
	a.emit("WS_CLIENT_DISCONNECTED", peer)
}

// OpenDevtools opens the developer tools
func (a *App) OpenDevtools() {
	// runtime.OpenWebInspector(a.ctx)
}

// ConnectToMachine connects to the CNC machine
func (a *App) ConnectToMachine(ip string, port uint16) (string, error) {
	addr := fmt.Sprintf("%s:%d", ip, port)
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		return "", fmt.Errorf("connection failed: %w", err)
	}

	a.streamMutex.Lock()
	a.stream = conn
	a.streamMutex.Unlock()

	return fmt.Sprintf("Connected to %s", addr), nil
}

// DisconnectFromMachine disconnects from the CNC machine
func (a *App) DisconnectFromMachine() (string, error) {
	a.streamMutex.Lock()
	defer a.streamMutex.Unlock()

	if a.stream != nil {
		a.stream.Close()
		a.stream = nil
		return "Disconnected", nil
	}

	return "", fmt.Errorf("no active connection")
}

// StartReceiving starts receiving data from the CNC machine
func (a *App) StartReceiving() error {
	a.streamMutex.Lock()
	stream := a.stream
	a.streamMutex.Unlock()

	if stream == nil {
		return fmt.Errorf("no active connection")
	}

	go func() {
		headerBuf := make([]byte, 2)

		for {
			// Read header (2 bytes)
			if _, err := io.ReadFull(stream, headerBuf); err != nil {
				if SHOWDEBUG {
					fmt.Printf("Error reading header: %v\n", err)
				}
				break
			}

			header := binary.LittleEndian.Uint16(headerBuf)
			msgType := uint8(header & 0x07)
			payloadLength := int(header >> 3)

			// Read payload
			payload := make([]byte, payloadLength)
			if _, err := io.ReadFull(stream, payload); err != nil {
				if SHOWDEBUG {
					fmt.Printf("Error reading payload: %v\n", err)
				}
				break
			}

			// Parse based on message type
			switch msgType {
			case 1: // Machine Position
				if len(payload) >= 17 {
					pos := MachinePosition{
						X:        Float32frombytes(payload[0:4]),
						Y:        Float32frombytes(payload[4:8]),
						Z:        Float32frombytes(payload[8:12]),
						Velocity: Float32frombytes(payload[12:16]),
						MoveID:   payload[16],
					}
					a.emit("machine-position", pos)
				}
			case 2: // Machine Job
				if len(payload) >= 66 {
					jobname := strings.TrimRight(string(payload[0:63]), "\x00")
					status := payload[64]
					progress := payload[65]

					job := MachineJob{
						Name:     jobname,
						Status:   status,
						Progress: progress,
					}
					a.emit("machine-job", job)
				}
			default:
				// Unknown message type
			}
		}
	}()

	return nil
}

// InstallInkscapeExtension installs the Inkscape extension by copying files
func (a *App) InstallInkscapeExtension() error {
	// Get the extensions directory
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	extensionsDir := filepath.Join(home, "AppData", "Roaming", "inkscape", "extensions")

	// Ensure the directory exists
	err = os.MkdirAll(extensionsDir, 0755)
	if err != nil {
		return err
	}

	// Check if real folder exists, use that; otherwise use embedded
	devPath := "frontend/inkscape_ex"
	if _, err := os.Stat(devPath); err == nil {
		// Development mode: copy from real folder
		if SHOWDEBUG {
			fmt.Println("Copying Inkscape extension from development folder")
		}
		return filepath.Walk(devPath, func(path string, d os.FileInfo, err error) error {
			if err != nil {
				return err
			}

			// Calculate relative path
			relPath, err := filepath.Rel(devPath, path)
			if err != nil {
				return err
			}
			if relPath == "." {
				return nil
			}

			destPath := filepath.Join(extensionsDir, relPath)

			if d.IsDir() {
				return os.MkdirAll(destPath, 0755)
			}

			// Copy file from real filesystem
			return copyRealFile(path, destPath)
		})
	}

	// Production mode: use embedded files
	if SHOWDEBUG {
		fmt.Println("Copying Inkscape extension from embedded files")
	}
	root := "frontend/inkscape_ex"
	return fs.WalkDir(inkscapeFiles, root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		// Calculate relative path
		relPath, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		if relPath == "." {
			return nil
		}

		destPath := filepath.Join(extensionsDir, relPath)

		if d.IsDir() {
			return os.MkdirAll(destPath, 0755)
		}

		// Copy file from embedded FS
		return copyEmbeddedFile(path, destPath)
	})
}

// copyEmbeddedFile copies a single file from embedded FS
func copyEmbeddedFile(src, dest string) error {
	if SHOWDEBUG {
		fmt.Printf("Copying embedded file from %s to %s\n", src, dest)
	}
	srcFile, err := inkscapeFiles.Open(src)
	if err != nil {
		return err
	}
	defer srcFile.Close()

	destFile, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer destFile.Close()

	_, err = io.Copy(destFile, srcFile)
	return err
}

// copyRealFile copies a single file from real filesystem
func copyRealFile(src, dest string) error {
	if SHOWDEBUG {
		fmt.Printf("Copying real file from %s to %s\n", src, dest)
	}
	srcFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer srcFile.Close()

	destFile, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer destFile.Close()

	_, err = io.Copy(destFile, srcFile)
	return err
}

// startServer starts the nestjs HTTP server on port 3000
func (a *App) startServer() {
	mux := http.NewServeMux()
	mux.HandleFunc("/", a.handleRequest)
	if SHOWDEBUG {
		log.Println("Starting nestjs server on :3000")
	}
	if err := http.ListenAndServe(":3000", mux); err != nil {
		if SHOWDEBUG {
			log.Printf("Error starting nestjs server: %v", err)
		}
	}
}

func (a *App) handleRequest(w http.ResponseWriter, r *http.Request) {
	if SHOWDEBUG {
		log.Printf("NestJS Server received request: %s %s", r.Method, r.URL.Path)
	}
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}
	switch r.URL.Path {
	case "/api/origin":
		a.handleRajaOngkirOrigin(w, r)
		return
	case "/api/destination":
		a.handleRajaOngkirDestination(w, r)
		return
	case "/api/cost":
		a.handleRajaOngkirCost(w, r)
		return
	case "/api/key-status":
		if strings.TrimSpace(getRajaOngkirKey()) == "" {
			fmt.Fprintf(w, "empty")
		} else {
			fmt.Fprintf(w, "set")
		}
		return
	case "/api/shop-config":
		a.handleShopConfig(w, r)
		return
	case "/api/profiles", "/profiles":
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", 405)
			return
		}
		a.profilesMutex.Lock()
		data := a.profilesJSON
		a.profilesMutex.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if data == "" {
			io.WriteString(w, "{}")
		} else {
			io.WriteString(w, data)
		}
	case "/stored-svg", "/stored_svg":
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", 405)
			return
		}
		a.storedSvgMutex.Lock()
		data := a.storedSvgData
		a.storedSvgMutex.Unlock()
		if data == "" {
			http.Error(w, "Not found", 404)
			return
		}
		w.Header().Set("Content-Type", "image/svg+xml")
		w.Header().Set("Content-Length", fmt.Sprint(len(data)))
		io.WriteString(w, data)
	case "/result-svg", "/result_svg":
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", 405)
			return
		}
		a.storedSvgMutex.Lock()
		data := a.storedresultSvgData
		a.storedSvgMutex.Unlock()
		if data == "" {
			http.Error(w, "Not found", 404)
			return
		}
		w.Header().Set("Content-Type", "image/svg+xml")
		w.Header().Set("Content-Length", fmt.Sprint(len(data)))
		io.WriteString(w, data)
	case "/check-svg-timestamp", "/check_svg_timestamp":
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", 405)
			return
		}
		a.storedSvgMutex.Lock()
		ts := a.storedSvgTimestamp
		a.storedSvgMutex.Unlock()
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"timestamp": %d}`, ts)
	case "/save-sketch", "/save_sketch":
		a.handleSaveSketch(w, r)
		return
	case "/upload-svg", "/upload_svg":
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", 405)
			return
		}
		err := r.ParseMultipartForm(32 << 20) // 32MB max
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		file, _, err := r.FormFile("svg_data")
		if err != nil {
			http.Error(w, "No svg_data", 400)
			return
		}
		defer file.Close()
		data, err := io.ReadAll(file)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		svgStr := string(data)
		// Clean: remove all xmlns attributes
		re := regexp.MustCompile(`xmlns="[^"]*"`)
		svgStr = re.ReplaceAllString(svgStr, "")
		// Add xmlns to <svg tag
		svgStr = strings.Replace(svgStr, "<svg", `<svg xmlns="http://www.w3.org/2000/svg"`, 1)
		inkscape := r.FormValue("inkscape")
		if inkscape == "y" {
			a.storedSvgMutex.Lock()
			a.storedSvgData = svgStr
			a.storedSvgTimestamp = time.Now().UnixMilli()
			// Clear any previous nesting result - it's invalidated by the new upload
			a.storedresultSvgData = ""
			a.storedSvgMutex.Unlock()
			a.emit("NESTING_UPLOAD_RECEIVED", a.storedSvgTimestamp)
		} else if inkscape == "n" {
			a.storedSvgMutex.Lock()
			a.storedresultSvgData = svgStr
			a.storedSvgMutex.Unlock()
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"success": true, "message": "SVG data received and processed successfully"}`)
	default:
		// Handle /v2 prefix for nestjs2
		if r.URL.Path == "/v2" {
			http.Redirect(w, r, "/v2/", http.StatusMovedPermanently)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/v2/") {
			r.URL.Path = strings.TrimPrefix(r.URL.Path, "/v2")
			if r.URL.Path == "" {
				r.URL.Path = "/"
			}
			devPath := "nestjs2/frontend"
			if _, err := os.Stat(devPath); err == nil {
				if SHOWDEBUG {
					log.Printf("Serving nestjs2 from development folder: %s", devPath)
				}
				fileServer := http.FileServer(http.Dir(devPath))
				fileServer.ServeHTTP(w, r)
			} else {
				if SHOWDEBUG {
					log.Printf("Serving nestjs2 from embedded files")
				}
				subFS, _ := fs.Sub(nestjs2WebFiles, "nestjs2/frontend")
				fileServer := http.FileServer(http.FS(subFS))
				fileServer.ServeHTTP(w, r)
			}
			return
		}
		// Handle /sketcher prefix for minisketch
		if r.URL.Path == "/sketcher" {
			http.Redirect(w, r, "/sketcher/", http.StatusMovedPermanently)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/sketcher/") {
			r.URL.Path = strings.TrimPrefix(r.URL.Path, "/sketcher")
			if r.URL.Path == "" {
				r.URL.Path = "/"
			}
			devPath := "minisketch"
			if _, err := os.Stat(devPath); err == nil {
				if SHOWDEBUG {
					log.Printf("Serving minisketch from development folder: %s", devPath)
				}
				fileServer := http.FileServer(http.Dir(devPath))
				fileServer.ServeHTTP(w, r)
			} else {
				if SHOWDEBUG {
					log.Printf("Serving minisketch from embedded files")
				}
				subFS, _ := fs.Sub(minisketchWebFiles, "minisketch")
				fileServer := http.FileServer(http.FS(subFS))
				fileServer.ServeHTTP(w, r)
			}
			return
		}
		// Try to serve from tools_invoice first (invoice generator static assets)
		if a.serveInvoiceFile(w, r) {
			return
		}
		http.NotFound(w, r)
	}
}

// saveFileDialog asks the user where to write a file.
//
// Two worlds, one call:
//   - Wails webview: a.ctx exists, so the Wails runtime owns the dialog.
//   - Linux browser mode (see linux-patch/bridge.go): wails.Run never runs, so
//     a.ctx is nil and runtime.SaveFileDialog panics/errors. There the dialog
//     must come from the desktop itself — zenity, kdialog or yad.
//
// Returns ("", nil) when the user cancels.
func (a *App) saveFileDialog(opts runtime.SaveDialogOptions, fallbackName string) (string, error) {
	if a.ctx != nil {
		return runtime.SaveFileDialog(a.ctx, opts)
	}
	return nativeSaveDialog(opts.Title, fallbackName)
}

// nativeSaveDialog shows a GTK/Qt save dialog through whatever helper the
// desktop already ships. Empty string + nil error means "cancelled".
func nativeSaveDialog(title, name string) (string, error) {
	if goruntime.GOOS != "linux" {
		return "", fmt.Errorf("no dialog backend outside Linux without a Wails context")
	}
	if name == "" {
		name = "sketch.sketch"
	}
	// The directory is not pre-filled: letting the dialog remember its own last
	// folder is better than forcing one, and the user picks anyway.
	type attempt struct {
		bin  string
		args []string
	}
	tries := []attempt{
		{"zenity", []string{"--file-selection", "--save", "--confirm-overwrite",
			"--title=" + title, "--filename=" + name,
			"--file-filter=MiniSketch (*.sketch) | *.sketch"}},
		{"kdialog", []string{"--getsavefilename", name, "*.sketch", "--title", title}},
		{"yad", []string{"--file", "--save", "--confirm-overwrite",
			"--title=" + title, "--filename=" + name,
			"--file-filter=*.sketch"}},
	}
	for _, t := range tries {
		bin, err := exec.LookPath(t.bin)
		if err != nil {
			continue
		}
		cmd := exec.Command(bin, t.args...)
		var out bytes.Buffer
		cmd.Stdout = &out
		cmd.Stderr = io.Discard
		err = cmd.Run()
		if err != nil {
			// exit 1 is the dialog's own "Cancel", not a failure worth reporting
			if ee, ok := err.(*exec.ExitError); ok && ee.ExitCode() == 1 {
				return "", nil
			}
			return "", err
		}
		chosen := strings.TrimSpace(out.String())
		if chosen == "" {
			return "", nil
		}
		return chosen, nil
	}
	return "", fmt.Errorf("no save dialog available (install zenity, kdialog or yad)")
}

// handleSaveSketch writes a MiniSketch document through the desktop's own Save
// dialog.
//
// Why it lives here: MiniSketch runs in an iframe, and browsers refuse the File
// System Access API in a cross-origin frame, so the in-page "Save" could only
// ever drop another copy in Downloads. The host process has a REAL save dialog
// (Wails runtime), and the frame is served same-origin from :3000, so a plain
// POST reaches it with no CORS work.
//
// Body: {"name":"kursi.sketch","text":"..."} — `text` is the .sketch JSON.
// Reply: {"status":"saved"|"cancelled"|"error","path":"..."}
func (a *App) handleSaveSketch(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		io.WriteString(w, `{"status":"error","message":"POST only"}`)
		return
	}
	var req struct {
		Name string `json:"name"`
		Text string `json:"text"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<20)).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		io.WriteString(w, `{"status":"error","message":"bad json"}`)
		return
	}
	if req.Text == "" {
		w.WriteHeader(http.StatusBadRequest)
		io.WriteString(w, `{"status":"error","message":"empty text"}`)
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = "sketch.sketch"
	}
	// the extension belongs to the file type, never to the user's typing
	if !strings.HasSuffix(strings.ToLower(name), ".sketch") {
		name += ".sketch"
	}
	path, err := a.saveFileDialog(runtime.SaveDialogOptions{
		Title:           "Simpan sketsa MiniSketch",
		DefaultFilename: name,
		Filters: []runtime.FileFilter{
			{DisplayName: "MiniSketch (*.sketch)", Pattern: "*.sketch"},
		},
	}, name)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		fmt.Fprintf(w, `{"status":"error","message":%q}`, err.Error())
		return
	}
	if path == "" {
		io.WriteString(w, `{"status":"cancelled"}`)
		return
	}
	if err := os.WriteFile(path, []byte(req.Text), 0644); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		fmt.Fprintf(w, `{"status":"error","message":%q}`, err.Error())
		return
	}
	if SHOWDEBUG {
		log.Printf("Saved sketch: %s (%d bytes)", path, len(req.Text))
	}
	fmt.Fprintf(w, `{"status":"saved","path":%q}`, path)
}

// serveInvoiceFile attempts to serve the request from the tools_invoice
// embedded FS or the dev folder. Returns true if the file was served
// (or attempted). Returns false if the path is not under tools_invoice.
func (a *App) serveInvoiceFile(w http.ResponseWriter, r *http.Request) bool {
	clean := strings.TrimPrefix(r.URL.Path, "/")
	if clean == "" {
		return false
	}
	// Only serve known invoice filenames (avoid clashing with NestJS assets)
	if !isInvoiceAsset(clean) {
		return false
	}
	devPath := filepath.Join("tools_invoice", clean)
	if _, err := os.Stat(devPath); err == nil {
		if SHOWDEBUG {
			log.Printf("Serving invoice asset from dev folder: %s", devPath)
		}
		http.ServeFile(w, r, devPath)
		return true
	}
	embedPath := "tools_invoice/" + clean
	data, err := invoiceFiles.ReadFile(embedPath)
	if err != nil {
		return false
	}
	ext := strings.ToLower(filepath.Ext(clean))
	mime := map[string]string{
		".html": "text/html; charset=utf-8",
		".css":  "text/css; charset=utf-8",
		".js":   "application/javascript; charset=utf-8",
		".json": "application/json; charset=utf-8",
		".png":  "image/png",
		".jpg":  "image/jpeg",
		".svg":  "image/svg+xml",
		".ico":  "image/x-icon",
	}
	ct, ok := mime[ext]
	if !ok {
		ct = "application/octet-stream"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Content-Length", fmt.Sprint(len(data)))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
	return true
}

// isInvoiceAsset reports whether the given filename (no leading slash)
// is an asset of the invoice tool that we are willing to serve.
func isInvoiceAsset(name string) bool {
	if name == "invoice.html" {
		return true
	}
	return false
}

// Float32frombytes converts a byte slice to float32 (little endian)
func Float32frombytes(b []byte) float32 {
	bits := binary.LittleEndian.Uint32(b)
	return *(*float32)(unsafe.Pointer(&bits))
}

// CaptureScreenshot captures the application window and returns base64 image data
func (a *App) CaptureScreenshot() (string, error) {
	// Get window position and size
	posX, posY := runtime.WindowGetPosition(a.ctx)
	width, height := runtime.WindowGetSize(a.ctx)

	// Create bounds rectangle for the window
	bounds := image.Rect(posX, posY, posX+width, posY+height)

	// Capture just the window area
	img, err := screenshot.CaptureRect(bounds)
	if err != nil {
		return "", fmt.Errorf("failed to capture window: %w", err)
	}

	// Encode to PNG
	var buf bytes.Buffer
	err = png.Encode(&buf, img)
	if err != nil {
		return "", fmt.Errorf("failed to encode image: %w", err)
	}

	// Convert to base64
	base64Data := "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())

	if SHOWDEBUG {
		fmt.Printf("Screenshot captured: %dx%d at (%d,%d)\n", width, height, posX, posY)
	}

	return base64Data, nil
}

// OpenInvoice opens the invoice generator in the user's default browser.
func (a *App) OpenInvoice() error {
	if SHOWDEBUG {
		fmt.Printf("Opening invoice generator at %s\n", invoicePublicURL)
	}
	runtime.BrowserOpenURL(a.ctx, invoicePublicURL)
	return nil
}

// handleRajaOngkirOrigin returns the default origin (Sukorejo, Gunungpati, Semarang).
func (a *App) handleRajaOngkirOrigin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	fmt.Fprintf(w, `{"meta":{"message":"OK","code":200,"status":"success"},"data":{"id":%d,"label":"%s"}}`,
		defaultOriginID, defaultOriginLbl)
}

// handleRajaOngkirDestination proxies a destination search to RajaOngkir.
func (a *App) handleRajaOngkirDestination(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	if search == "" {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusBadRequest)
		fmt.Fprintf(w, `{"meta":{"message":"Parameter 'search' wajib","code":400,"status":"error"},"data":null}`)
		return
	}
	limit := r.URL.Query().Get("limit")
	if limit == "" {
		limit = "10"
	}
	offset := r.URL.Query().Get("offset")
	if offset == "" {
		offset = "0"
	}
	u := rajaOngkirBase + "/destination/domestic-destination?" + url.Values{
		"search": {search},
		"limit":  {limit},
		"offset": {offset},
	}.Encode()
	a.proxyRajaOngkir(w, "GET", u, nil)
}

// handleRajaOngkirCost proxies a domestic shipping cost calculation.
func (a *App) handleRajaOngkirCost(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := r.ParseForm(); err != nil {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusBadRequest)
		fmt.Fprintf(w, `{"meta":{"message":"Body tidak valid","code":400,"status":"error"},"data":null}`)
		return
	}
	form := url.Values{
		"origin":      {r.FormValue("origin")},
		"destination": {r.FormValue("destination")},
		"weight":      {r.FormValue("weight")},
		"courier":     {r.FormValue("courier")},
		"price":       {r.FormValue("price")},
	}
	if form.Get("origin") == "" || form.Get("destination") == "" ||
		form.Get("weight") == "" || form.Get("courier") == "" {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusBadRequest)
		fmt.Fprintf(w, `{"meta":{"message":"Field origin, destination, weight, courier wajib","code":400,"status":"error"},"data":null}`)
		return
	}
	if form.Get("price") == "" {
		form.Set("price", "lowest")
	}
	a.proxyRajaOngkir(w, "POST", rajaOngkirBase+"/calculate/domestic-cost", form)
}

// proxyRajaOngkir forwards the request to RajaOngkir with the API key and
// streams the JSON response back to the client. Applies L1+L2 cache.
// If the API key is empty, returns a synthetic 503 error without hitting the network.
func (a *App) proxyRajaOngkir(w http.ResponseWriter, method, target string, body url.Values) {
	// Guard: kalau API key kosong, jangan hit RajaOngkir. Balikin error
	// 503 dengan pesan jelas supaya UI bisa tampilkan warning.
	if strings.TrimSpace(getRajaOngkirKey()) == "" {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("X-Cache", "SKIP")
		w.WriteHeader(http.StatusServiceUnavailable)
		fmt.Fprintf(w, `{"meta":{"message":"RajaOngkir API key belum diisi. Isi di menu Connection Settings KaryaCNC.","code":503,"status":"error"},"data":null}`)
		return
	}

	cacheKey := buildCacheKey(method, target, body)

	// Try L1/L2 cache first
	if entry, ok := a.roCache.Get(cacheKey); ok {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("X-Cache", "HIT")
		w.WriteHeader(entry.Status)
		_, _ = w.Write(entry.Body)
		return
	}

	// Cache MISS → upstream
	var reqBody io.Reader
	if body != nil {
		reqBody = strings.NewReader(body.Encode())
	}
	req, err := http.NewRequest(method, target, reqBody)
	if err != nil {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusInternalServerError)
		fmt.Fprintf(w, `{"meta":{"message":"%s","code":500,"status":"error"},"data":null}`, err.Error())
		return
	}
	req.Header.Set("key", getRajaOngkirKey())
	req.Header.Set("User-Agent", "KaryaCNC-Invoice/1.0")
	if body != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusBadGateway)
		fmt.Fprintf(w, `{"meta":{"message":"%s","code":502,"status":"error"},"data":null}`, err.Error())
		return
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusBadGateway)
		fmt.Fprintf(w, `{"meta":{"message":"%s","code":502,"status":"error"},"data":null}`, err.Error())
		return
	}

	// Determine TTL based on status + endpoint
	ttl := ttlForRajaOngkirStatus(resp.StatusCode)
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		if strings.Contains(target, "/destination/") {
			ttl = 30 * 24 * time.Hour
		}
	}
	if resp.StatusCode >= 200 && resp.StatusCode < 600 {
		// Cache the response (including error responses for short TTL)
		a.roCache.Set(cacheKey, resp.StatusCode, data, ttl)
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Cache", "MISS")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(data)
}

// SetRajaOngkirKey sets the API key at runtime (called from the UI).
func (a *App) SetRajaOngkirKey(key string) (string, error) {
	setRajaOngkirKey(strings.TrimSpace(key))
	if SHOWDEBUG {
		fmt.Printf("RajaOngkir API key updated (length=%d)\n", len(key))
	}
	return "API key updated (" + fmt.Sprint(len(key)) + " chars)", nil
}

// GetRajaOngkirKey returns a masked preview of the current API key.
func (a *App) GetRajaOngkirKey() (string, error) {
	k := getRajaOngkirKey()
	if len(k) <= 8 {
		return strings.Repeat("*", len(k)), nil
	}
	return k[:4] + strings.Repeat("*", len(k)-8) + k[len(k)-4:], nil
}

// RajaOngkirKeyStatus melaporkan apakah API key sudah di-set di backend.
// Return "set" atau "empty". Berguna untuk UI menampilkan warning.
func (a *App) RajaOngkirKeyStatus() (string, error) {
	if strings.TrimSpace(getRajaOngkirKey()) == "" {
		return "empty", nil
	}
	return "set", nil
}

// handleShopConfig dipanggil dari invoice.html untuk update konfigurasi toko
// (saat ini hanya API key RajaOngkir, field lain disimpan di localStorage browser).
// Method: POST application/json. Body: {"apiKey": "..."}
func (a *App) handleShopConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	defer r.Body.Close()
	body, err := io.ReadAll(r.Body)
	if err != nil {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusBadRequest)
		fmt.Fprintf(w, `{"ok":false,"error":"%s"}`, err.Error())
		return
	}
	var req struct {
		APIKey string `json:"apiKey"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusBadRequest)
		fmt.Fprintf(w, `{"ok":false,"error":"%s"}`, err.Error())
		return
	}
	setRajaOngkirKey(strings.TrimSpace(req.APIKey))
	if SHOWDEBUG {
		fmt.Printf("API key updated via /api/shop-config (length=%d)\n", len(req.APIKey))
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	fmt.Fprintf(w, `{"ok":true}`)
}

// ClearInvoiceCache removes all entries from L1 + L2.
func (a *App) ClearInvoiceCache() (string, error) {
	count := a.roCache.DeleteAll()
	if SHOWDEBUG {
		fmt.Printf("Invoice cache cleared: %d entries\n", count)
	}
	return fmt.Sprintf("%d entries removed", count), nil
}

// GetInvoiceCacheStats returns the current cache size (mem, disk).
func (a *App) GetInvoiceCacheStats() (string, error) {
	mem, disk := a.roCache.Stats()
	return fmt.Sprintf("mem=%d disk=%d", mem, disk), nil
}

// RefreshSingleCost drops the cache entry for one (origin, destination, weight, courier)
// combination and re-fetches it from RajaOngkir. Returns the new raw JSON body.
func (a *App) RefreshSingleCost(origin, destination string, weight int, courier string) (string, error) {
	form := url.Values{
		"origin":      {origin},
		"destination": {destination},
		"weight":      {fmt.Sprint(weight)},
		"courier":     {courier},
		"price":       {"lowest"},
	}
	key := buildCacheKey("POST", rajaOngkirBase+"/calculate/domestic-cost", form)
	a.roCache.DeleteOne(key)

	req, err := http.NewRequest("POST", rajaOngkirBase+"/calculate/domestic-cost", strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("key", getRajaOngkirKey())
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", "KaryaCNC-Invoice/1.0")
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	ttl := ttlForRajaOngkirStatus(resp.StatusCode)
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		ttl = 7 * 24 * time.Hour
	}
	if resp.StatusCode >= 200 && resp.StatusCode < 600 {
		a.roCache.Set(key, resp.StatusCode, data, ttl)
	}
	return string(data), nil
}
