package main

import (
	"bytes"
	"context"
	"embed"
	"encoding/binary"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime/multipart"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unsafe"

	"github.com/gorilla/websocket"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// SHOWDEBUG controls whether debug/log messages are printed
var SHOWDEBUG = false

//go:embed all:frontend/inkscape_ex
var inkscapeFiles embed.FS

//go:embed all:nestjs/frontend
var nestjsWebFiles embed.FS

// App struct
type App struct {
	ctx                 context.Context
	stream              net.Conn
	streamMutex         sync.Mutex
	wsServer            *http.Server
	wsServerMutex       sync.Mutex
	telegramServer      *http.Server
	telegramServerMutex sync.Mutex

	storedSvgData       string
	storedSvgTimestamp  int64
	storedresultSvgData string
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
	return &App{}
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
		runtime.EventsEmit(a.ctx, "WS_SERVER_STARTED", addr)

		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			if SHOWDEBUG {
				fmt.Printf("[WS] Failed to start WebSocket server: %v\n", err)
			}
		}
	}()
}

// StartTelegramServer starts an HTTP server on the specified port for handling /t endpoint
func (a *App) StartTelegramServer(port uint16) {
	// Close previous server if running
	a.telegramServerMutex.Lock()
	if a.telegramServer != nil {
		if SHOWDEBUG {
			fmt.Println("Closing Telegram server")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer cancel()
		a.telegramServer.Shutdown(ctx)
		a.telegramServer = nil
		time.Sleep(10 * time.Millisecond)
	}
	a.telegramServerMutex.Unlock()

	if SHOWDEBUG {
		fmt.Printf("Starting Telegram server on port %d...\n", port)
	}
	addr := fmt.Sprintf("0.0.0.0:%d", port)

	mux := http.NewServeMux()
	mux.HandleFunc("/t", a.handleTelegramRequest)

	server := &http.Server{
		Addr:    addr,
		Handler: mux,
	}

	a.telegramServerMutex.Lock()
	a.telegramServer = server
	a.telegramServerMutex.Unlock()

	go func() {
		if SHOWDEBUG {
			fmt.Printf("[Telegram] Server listening on %s\n", addr)
		}
		runtime.EventsEmit(a.ctx, "TELEGRAM_SERVER_STARTED", addr)

		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			if SHOWDEBUG {
				fmt.Printf("[Telegram] Failed to start server: %v\n", err)
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
	runtime.EventsEmit(a.ctx, "TELEGRAM_REQUEST", map[string]string{
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
				runtime.EventsEmit(a.ctx, "WS_MESSAGE_RECEIVED", buff.String())

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
	runtime.EventsEmit(a.ctx, "WS_CLIENT_DISCONNECTED", peer)
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
					runtime.EventsEmit(a.ctx, "machine-position", pos)
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
					runtime.EventsEmit(a.ctx, "machine-job", job)
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
	case "/stored-svg", "/stored_svg":
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", 405)
			return
		}
		if a.storedSvgData == "" {
			http.Error(w, "Not found", 404)
			return
		}
		w.Header().Set("Content-Type", "image/svg+xml")
		w.Header().Set("Content-Length", fmt.Sprint(len(a.storedSvgData)))
		io.WriteString(w, a.storedSvgData)
	case "/result-svg", "/result_svg":
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", 405)
			return
		}
		if a.storedresultSvgData == "" {
			http.Error(w, "Not found", 404)
			return
		}
		w.Header().Set("Content-Type", "image/svg+xml")
		w.Header().Set("Content-Length", fmt.Sprint(len(a.storedresultSvgData)))
		io.WriteString(w, a.storedresultSvgData)
	case "/check-svg-timestamp", "/check_svg_timestamp":
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", 405)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"timestamp": %d}`, a.storedSvgTimestamp)
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
			a.storedSvgData = svgStr
			a.storedSvgTimestamp = time.Now().UnixMilli()
		} else if inkscape == "n" {
			a.storedresultSvgData = svgStr
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"success": true, "message": "SVG data received and processed successfully"}`)
	default:
		// Check if we're in development mode by checking if the real directory exists
		devPath := "nestjs/frontend"
		if _, err := os.Stat(devPath); err == nil {
			// Development mode: serve from real folder for faster debugging
			if SHOWDEBUG {
				log.Printf("Serving from development folder: %s", devPath)
			}
			fileServer := http.FileServer(http.Dir(devPath))
			fileServer.ServeHTTP(w, r)
		} else {
			// Production mode: serve from embedded files
			if SHOWDEBUG {
				log.Printf("Serving from embedded files")
			}
			subFS, _ := fs.Sub(nestjsWebFiles, "nestjs/frontend")
			fileServer := http.FileServer(http.FS(subFS))
			fileServer.ServeHTTP(w, r)
		}
	}
}

// Float32frombytes converts a byte slice to float32 (little endian)
func Float32frombytes(b []byte) float32 {
	bits := binary.LittleEndian.Uint32(b)
	return *(*float32)(unsafe.Pointer(&bits))
}
