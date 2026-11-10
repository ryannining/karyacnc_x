// Wails Runtime Wrapper
// This file provides a compatibility layer between Tauri and Wails APIs
// This must be loaded AFTER wailsjs runtime is available
//
// Dua mode:
//  1. Wails webview  : window.runtime + window.go disediakan Wails, perilaku lama.
//  2. Browser bridge : window.go/window.runtime di-polyfill lewat WebSocket
//     /__bridge ke Go binary (dipakai saat binary jalan dengan --browser).

(function () {
    function installCompat() {
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

                        case 'set_profiles':
                        case 'setProfiles':
                            return await window.go.main.App.SetProfiles(args.data);

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

                        case 'capture_screenshot':
                            return await window.go.main.App.CaptureScreenshot();

                        case 'open_invoice':
                            return await window.go.main.App.OpenInvoice();

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

    // Polyfill window.go.main.App + window.runtime lewat WebSocket bridge,
    // supaya semua kode frontend jalan tanpa webview Wails.
    function installBridgePolyfills(ws) {
        var nextId = 1;
        var pending = {};
        var listeners = {};

        function rpc(method, args) {
            return new Promise(function (resolve, reject) {
                if (ws.readyState !== WebSocket.OPEN) {
                    reject(new Error('bridge tidak terhubung'));
                    return;
                }
                var id = nextId++;
                pending[id] = { resolve: resolve, reject: reject };
                ws.send(JSON.stringify({ id: id, type: 'call', method: method, args: args || [] }));
            });
        }

        ws.addEventListener('message', function (ev) {
            var msg;
            try { msg = JSON.parse(ev.data); } catch (e) { return; }
            if (msg.type === 'event') {
                (listeners[msg.name] || []).slice().forEach(function (cb) {
                    try { cb(msg.data); } catch (e) { console.error('event handler error:', e); }
                });
                return;
            }
            var p = pending[msg.id];
            if (!p) return;
            delete pending[msg.id];
            if (msg.type === 'error') p.reject(new Error(msg.error));
            else p.resolve(msg.value);
        });

        ws.addEventListener('close', function () {
            Object.keys(pending).forEach(function (id) {
                pending[id].reject(new Error('bridge terputus'));
                delete pending[id];
            });
        });

        // Proxy: method apapun jadi panggilan RPC ke Go (UploadFile, dst).
        window.go = {
            main: {
                App: new Proxy({}, {
                    get: function (target, name) {
                        if (name === 'then') return undefined;
                        return function () {
                            return rpc(String(name), Array.prototype.slice.call(arguments));
                        };
                    }
                })
            }
        };

        window.runtime = {
            EventsOn: function (eventName, callback) {
                (listeners[eventName] = listeners[eventName] || []).push(callback);
            },
            EventsOnMultiple: function (eventName, callback) {
                (listeners[eventName] = listeners[eventName] || []).push(callback);
            },
            EventsOff: function (eventName) {
                delete listeners[eventName];
            },
            EventsOffAll: function () {
                listeners = {};
            },
            EventsEmit: function () { },
            BrowserOpenURL: function (url) { window.open(url, '_blank'); },
            LogPrint: function () { },
            LogTrace: function () { },
            LogDebug: function () { },
            LogInfo: function () { },
            LogWarning: function () { },
            LogError: function () { },
            LogFatal: function () { },
            WindowSetTitle: function (t) { document.title = t; },
            Quit: function () { window.close(); }
        };
    }

    function startBridge(onFail) {
        var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        var ws;
        try {
            ws = new WebSocket(proto + '//' + location.host + '/__bridge');
        } catch (e) {
            onFail();
            return;
        }
        var settled = false;
        ws.addEventListener('open', function () {
            if (settled) return;
            settled = true;
            console.log('Browser bridge connected — mode engine browser (tanpa webview Wails)');
            installBridgePolyfills(ws);
            installCompat();
        });
        ws.addEventListener('error', function () {
            if (settled) return;
            settled = true;
            onFail();
        });
        ws.addEventListener('close', function () {
            if (settled) return;
            settled = true;
            onFail();
        });
    }

    // Wait for Wails runtime; kalau tidak ada (mode browser), pakai bridge.
    function initTauriCompat() {
        if (window.runtime && window.go) {
            installCompat();
            return;
        }
        startBridge(function () {
            setTimeout(initTauriCompat, 250);
        });
    }

    initTauriCompat();
})();