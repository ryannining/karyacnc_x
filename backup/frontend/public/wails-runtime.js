// Wails Runtime Wrapper
// This file provides a compatibility layer between Tauri and Wails APIs
// This must be loaded AFTER wailsjs runtime is available

(function () {
    // Wait for Wails runtime to be available
    function initTauriCompat() {
        if (!window.runtime || !window.go) {
            setTimeout(initTauriCompat, 50);
            return;
        }

        // Create a Tauri-like API structure for compatibility
        window.__TAURI__ = {
            core: {
                invoke: async function (command, args = {}) {
                    // Map Tauri commands to Wails methods
                    switch (command) {
                        case 'upload_file':
                            return await window.go.main.App.UploadFile(args.ip, args.filename, args.data);

                        case 'proxy_request':
                            return await window.go.main.App.ProxyRequest(args.url);

                        case 'start_ws_server':
                            return await window.go.main.App.StartWSServer(args.port);

                        case 'start_telegram_server':
                            return await window.go.main.App.StartTelegramServer(args.port);

                        case 'open_devtools':
                            return await window.go.main.App.OpenDevtools();

                        case 'connect_to_machine':
                            return await window.go.main.App.ConnectToMachine(args.ip, args.port);

                        case 'disconnect_from_machine':
                            return await window.go.main.App.DisconnectFromMachine();

                        case 'start_receiving':
                            return await window.go.main.App.StartReceiving();

                        case 'install_inkscape_extension':
                        case 'installInkscapeExtension':
                            return await window.go.main.App.InstallInkscapeExtension(args);

                        default:
                            throw new Error(`Unknown command: ${command}`);
                    }
                }
            },
            event: {
                listen: async function (eventName, callback) {
                    // Wails EventsOn returns the event data directly
                    window.runtime.EventsOn(eventName, (data) => {
                        // Wrap data in Tauri-like event structure
                        callback({ payload: data });
                    });
                }
            },
            window: {
                getCurrentWindow: function () {
                    return {
                        // Add any window methods if needed
                    };
                }
            }
        };

        // Also add global functions for convenience
        window.invoke = window.__TAURI__.core.invoke;
        window.listen = window.__TAURI__.event.listen;

        console.log('Tauri compatibility layer initialized');
    }

    initTauriCompat();
})();
