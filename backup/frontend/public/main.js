// web socket server, to receive gcode from other
window.port = 8888;


let greetInputEl;
let greetMsgEl;
let wsServerStatusEl;
let wsClientsEl;
let wsReceivedDataEl;

const clients = new Set();

// Save original console.log
const origLog = console.log;

console.log = function (...args) {
    // Call backend method
    if (window.backend && window.backend.App && window.backend.App.FrontendLog) {
        window.backend.App.FrontendLog(args.join(" "));
    }
    // Still print in browser console
    origLog.apply(console, args);
};


async function setupEventListeners() {
    // Start the WebSocket server
    await window.invoke('start_ws_server', { port: window.port });

    await window.listen('WS_SERVER_STARTED', (event) => {
        console.log('WS_SERVER_STARTED', event);
        wsServerStatusEl.textContent = `Listening on ${event.payload}`;
        wsServerStatusEl.style.color = 'green';
    });

    // Start Telegram server (for /t endpoint)
    await window.invoke('start_telegram_server', { port: window.port });

    await window.listen('TELEGRAM_SERVER_STARTED', (event) => {
        console.log('TELEGRAM_SERVER_STARTED', event);
    });

    await window.listen('WS_CLIENT_CONNECTED', (event) => {
        console.log('WS_CLIENT_CONNECTED', event);
        clients.add(event.payload);
        updateClientList();
    });

    await window.listen('WS_CLIENT_DISCONNECTED', (event) => {
        console.log('WS_CLIENT_DISCONNECTED', event);
        clients.delete(event.payload);
        updateClientList();
    });

    await window.listen('WS_MESSAGE_RECEIVED', (event) => {
        console.log('WS_MESSAGE_RECEIVED', event);
        //wsReceivedDataEl.value = event.payload;
        buff = event.payload;
        text1 = pathstoText1(buff);
        savehistory(buff);
        refreshgcode();
    });
}
// Connect to machine
async function connectMachine() {
    const ip = document.getElementById('machineIp').value;
    const port = parseInt(document.getElementById('machinePort').value);

    try {
        const result = await window.invoke('connect_to_machine', { ip, port });
        console.log(result);

        // Start receiving data
        await window.invoke('start_receiving');

        // Listen for position updates
        await window.listen('machine-position', (event) => {
            updateDisplay(event.payload);
        });

        // Listen for config updates
        await window.listen('machine-job', (event) => {
            updateJob(event.payload);
        });
    } catch (error) {
        console.error('Connection error:', error);
    }
}
async function disconnectMachine() {
    $('machinestate').style.display = '';
    await window.invoke('disconnect_from_machine');
}


function updateDisplay(data) {
    document.getElementById('posX').textContent = data.x.toFixed(3);
    document.getElementById('posY').textContent = data.y.toFixed(3);
    document.getElementById('posZ').textContent = data.z.toFixed(3);
    document.getElementById('velocity').textContent = data.velocity.toFixed(2);
    document.getElementById('moveId').textContent = data.move_id;
}

function updateJob(job) {
    document.getElementById('mjobname').textContent = job.name;
    document.getElementById('mjobstatus').textContent = job.status;
    document.getElementById('mjobprogress').textContent = job.progress;
}

window.connectMachine = connectMachine;

window.setupEventListeners = setupEventListeners;

// Install Inkscape Extension
document.getElementById('btInstallInkscapeExt').addEventListener('click', async () => {
    try {
        await window.go.main.App.InstallInkscapeExtension();
        alert("Extension installed successfully!");
    } catch (error) {
        alert("Failed to install extension: " + error);
    }
});

