package main

import (
	"context"
	"embed"
	"fmt"
	"os"
	"runtime"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

// This will be callable from JS
func (a *App) FrontendLog(ctx context.Context, msg string) {
	fmt.Println("Frontend:", msg)
}

func main() {
	// Create a new app instance
	app := NewApp()

	// Engine selection.
	//
	// Linux defaults to BROWSER mode: the UI is served over HTTP and opened in
	// Chrome/Chromium (--app), which gives a far faster canvas than the
	// WebKitGTK webview most distros ship, with no runtime dependency beyond a
	// Chromium binary the user already has.
	//
	// Windows and macOS default to the NATIVE Wails webview: there the webview
	// is WebView2/WebKit, both fast and always present, and no browser process
	// is spawned.
	//
	// Both platforms can override: --browser or --webview.
	mode := ""
	explicit := false
	for _, arg := range os.Args[1:] {
		switch arg {
		case "--browser":
			mode = "browser"
			explicit = true
		case "--webview":
			mode = "webview"
		}
	}
	if mode == "" && runtime.GOOS == "linux" {
		mode = "browser"
	}
	if mode == "browser" && !isBindingsGeneration() {
		if runBrowserMode(app, explicit) {
			return
		}
		fmt.Println("Chrome/Chromium tidak ditemukan, fallback ke webview Wails.")
	}

	// Create application with options
	err := wails.Run(&options.App{
		Title:  "KaryaCNC",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},

		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
