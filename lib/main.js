const axios = require('axios');
const { app, BrowserWindow, Menu, dialog, globalShortcut, session } = require('electron');
const path = require('path');
const fs = require('fs');
const DiscordRPC = require('discord-rpc');

const url = 'https://moshionline.net';
const rpcFallbackId = '1111839940599349259';
const zoomKey = 'mo_client_zoom_level';
const rpcKey = 'mo_client_discord_rpc_enabled';
const alertsKey = 'mo_client_alerts_enabled';

let mainWindow;
let apiData = {};
let rpc;
let rpcTimer;
let startTimestamp;
let rpcEnabled = true;
let alertsEnabled = false;

function firstExisting(paths) {
    return paths.find((file) => file && fs.existsSync(file));
}

function appFile(file) {
    const appPath = app.getAppPath ? app.getAppPath() : __dirname;
    return firstExisting([
        path.join(__dirname, '..', file),
        path.join(__dirname, file),
        path.join(appPath, file),
        path.join(process.resourcesPath || '', file),
        path.join(process.resourcesPath || '', 'app.asar.unpacked', file)
    ]);
}

function flashFile() {
    if (process.platform === 'win32') {
        return process.arch === 'ia32' || process.arch === 'x32'
            ? appFile('flash/pepflashplayer32_34_0_0_330.dll')
            : appFile('flash/pepflashplayer64_34_0_0_330.dll');
    }
    if (process.platform === 'linux') return appFile('flash/libpepflashplayer.so');
    if (process.platform === 'darwin') return appFile('flash/flash.plugin');
    return null;
}

function iconFile() {
    const files = process.platform === 'darwin'
        ? ['icons.icns', 'icon.icns', 'icon.png']
        : process.platform === 'win32'
            ? ['icon.ico', 'icon.png']
            : ['icon.png', 'icon.ico'];
    return firstExisting(files.map((file) => path.join(__dirname, '..', file)));
}

async function getClientInfo() {
    try {
        const res = await axios.get(`${url}/api?clientInfo`, {
            timeout: 10000,
            responseType: 'text',
            transformResponse: [(data) => data]
        });
        const text = String(res.data || '').replace(/("clientId"\s*:\s*)([0-9]{15,30})/, '$1"$2"');
        apiData = JSON.parse(text);
    } catch (_) {
        apiData = {};
    }
}

function clientInfo() {
    return apiData && typeof apiData.clientInfo === 'object' ? apiData.clientInfo : apiData;
}

async function pageStorage(key, value) {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    const script = value === undefined
        ? `localStorage.getItem(${JSON.stringify(key)})`
        : `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(String(value))})`;
    try {
        return await mainWindow.webContents.executeJavaScript(`(() => { try { return ${script}; } catch (_) { return null; } })()`, true);
    } catch (_) {
        return null;
    }
}

function clampZoom(level) {
    return Math.max(-3, Math.min(3, level));
}

async function setZoom(level) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const zoom = clampZoom(level);
    mainWindow.webContents.setZoomLevel(zoom);
    await pageStorage(zoomKey, zoom);
}

async function loadPrefs() {
    const zoom = Number(await pageStorage(zoomKey));
    if (Number.isFinite(zoom)) mainWindow.webContents.setZoomLevel(clampZoom(zoom));
    else await pageStorage(zoomKey, mainWindow.webContents.getZoomLevel());

    const savedRpc = await pageStorage(rpcKey);
    rpcEnabled = savedRpc === null ? true : savedRpc === 'true';
    if (savedRpc === null) await pageStorage(rpcKey, 'true');

    alertsEnabled = await pageStorage(alertsKey) === 'true';
    buildMenu();
    startRpc();
}

function stopRpc() {
    if (rpcTimer) clearInterval(rpcTimer);
    rpcTimer = null;
    if (rpc) {
        const oldRpc = rpc;
        rpc = null;
        try { oldRpc.clearActivity().catch(() => {}); } catch (_) {}
        try { oldRpc.destroy().catch(() => {}); } catch (_) {}
    }
}

async function updateRpc() {
    if (!rpc) return;
    let username = null;
    try {
        const cookies = await session.defaultSession.cookies.get({ url });
        const cookie = cookies.find((item) => item.name === 'lastUsername');
        username = cookie && cookie.value;
    } catch (_) {}

    const info = clientInfo();
    const activity = {
        details: 'Exploring Monstro city...',
        startTimestamp,
        state: username ? `Logged in as: ${username}` : 'Not logged in',
        buttons: [{ label: 'Play now!', url }]
    };
    if (info.imgLogo) activity.largeImageKey = String(info.imgLogo);

    try { rpc.setActivity(activity); } catch (_) {}
}

function startRpc() {
    const info = clientInfo();
    const clientId = info.clientId ? String(info.clientId) : rpcFallbackId;
    if (!rpcEnabled || info.discordRPC === false || rpc) return;

    try {
        DiscordRPC.register(clientId);
        rpc = new DiscordRPC.Client({ transport: 'ipc' });
        startTimestamp = new Date();
        rpc.on('ready', () => {
            updateRpc();
            rpcTimer = setInterval(updateRpc, 15000);
        });
        rpc.login({ clientId }).catch(stopRpc);
    } catch (_) {
        stopRpc();
    }
}

async function setRpc(enabled) {
    rpcEnabled = enabled;
    await pageStorage(rpcKey, enabled ? 'true' : 'false');
    buildMenu();
    if (enabled) startRpc();
    else stopRpc();
}

async function setAlerts(enabled) {
    alertsEnabled = enabled;
    await pageStorage(alertsKey, enabled ? 'true' : 'false');
    buildMenu();
}

async function clearCache() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    await mainWindow.webContents.session.clearCache();
    await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Cache Cleared',
        message: 'The cache has been cleared. Please reopen the app.',
        buttons: ['OK']
    });
    app.quit();
}

function buildMenu() {
    const menu = Menu.buildFromTemplate([
        {
            label: 'View',
            submenu: [
                { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => setZoom(mainWindow.webContents.getZoomLevel() + 0.5) },
                { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => setZoom(mainWindow.webContents.getZoomLevel() - 0.5) },
                { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', click: () => setZoom(0) }
            ]
        },
        {
            label: 'Audio',
            submenu: [
                { label: 'Mute', accelerator: 'CmdOrCtrl+M', click: () => mainWindow.webContents.setAudioMuted(true) },
                { label: 'Unmute', accelerator: 'CmdOrCtrl+Shift+M', click: () => mainWindow.webContents.setAudioMuted(false) }
            ]
        },
        {
            label: 'Edit',
            submenu: [{ label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWindow.reload() }]
        },
        {
            label: 'Settings',
            submenu: [{ label: 'Discord RPC Enabled', type: 'checkbox', checked: rpcEnabled, click: (item) => setRpc(item.checked) }]
        },
        {
            label: 'Debug',
            submenu: [
                { label: 'Clear Cache', click: clearCache },
                {
                    label: 'Error Alerts',
                    submenu: [
                        { label: 'on', type: 'radio', checked: alertsEnabled, click: () => setAlerts(true) },
                        { label: 'off', type: 'radio', checked: !alertsEnabled, click: () => setAlerts(false) }
                    ]
                },
                {
                    label: 'Devtools',
                    accelerator: 'CmdOrCtrl+Shift+I',
                    click: () => {
                        mainWindow.webContents.openDevTools();
                        dialog.showMessageBox(mainWindow, {
                            type: 'warning',
                            title: 'Warning!',
                            message: 'Developer Tools are to be used to troubleshoot bugs for the Moshi Online Team. Any attempts to exploit for beneficial gain either for yourself or others could lead to a permanent ban on your accounts.',
                            buttons: ['OK']
                        });
                    }
                }
            ]
        }
    ]);
    Menu.setApplicationMenu(menu);
}

function registerKeys() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    globalShortcut.register('CommandOrControl+=', () => setZoom(mainWindow.webContents.getZoomLevel() + 0.1));
    globalShortcut.register('CommandOrControl+-', () => setZoom(mainWindow.webContents.getZoomLevel() - 0.1));
    globalShortcut.register('CommandOrControl+0', () => setZoom(0));
    globalShortcut.register('CommandOrControl+M', () => mainWindow.webContents.setAudioMuted(true));
    globalShortcut.register('CommandOrControl+Shift+M', () => mainWindow.webContents.setAudioMuted(false));
    globalShortcut.register('CommandOrControl+Shift+I', () => mainWindow.webContents.openDevTools());
    globalShortcut.register('CommandOrControl+R', () => mainWindow.reload());
    globalShortcut.register('F11', () => mainWindow.setFullScreen(!mainWindow.isFullScreen()));
}

async function createWindow() {
    await getClientInfo();

    mainWindow = new BrowserWindow({
        width: 1270,
        height: 800,
        useContentSize: true,
        show: true,
        autoHideMenuBar: true,
        title: 'Launching Moshi Online Client...',
        icon: iconFile(),
        webPreferences: {
            plugins: true,
            backgroundThrottling: true,
            sandbox: true,
            enableRemoteModule: true,
            webSecurity: true,
            contextIsolation: true,
            nodeIntegration: true,
            audioMuted: false
        }
    });

    buildMenu();
    mainWindow.webContents.setUserAgent(`Moshi Online Client v${apiData.version || app.getVersion()}`);
    mainWindow.loadURL(url);

    mainWindow.webContents.on('context-menu', (_, props) => Menu.getApplicationMenu().popup({
        window: mainWindow,
        x: props.x,
        y: props.y
    }));

    mainWindow.webContents.session.webRequest.onCompleted({ urls: ['*://moshionline.net/*', '*://*.moshionline.net/*'] }, (details) => {
        if (alertsEnabled && details.statusCode === 500) {
            dialog.showMessageBox(mainWindow, {
                type: 'error',
                title: 'Moshi Online Error',
                message: `Error: '${details.url}'`,
                detail: 'Please screenshot this and contact a developer.',
                buttons: ['OK']
            });
        }
    });

    mainWindow.webContents.on('did-finish-load', () => {
        registerKeys();
        loadPrefs();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
        globalShortcut.unregisterAll();
        stopRpc();
    });
    mainWindow.on('blur', () => globalShortcut.unregisterAll());
    mainWindow.on('focus', registerKeys);
    mainWindow.on('will-activate', registerKeys);
    mainWindow.on('will-become-inactive', () => globalShortcut.unregisterAll());
    mainWindow.on('minimize', () => globalShortcut.unregisterAll());
}

if (require('electron-squirrel-startup')) app.quit();
if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox');

const flash = flashFile();
if (flash) {
    app.commandLine.appendSwitch('ppapi-flash-path', flash);
    app.commandLine.appendSwitch('ppapi-flash-version', '32.0.0.465');
    app.commandLine.appendSwitch('enable-plugins');
}
app.commandLine.appendSwitch('ignore-certificate-errors');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.whenReady().then(() => {
        const icon = iconFile();
        if (process.platform === 'darwin' && app.dock && icon) app.dock.setIcon(icon);
        createWindow();
    });

    app.on('second-instance', () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    });
    app.on('will-quit', () => {
        globalShortcut.unregisterAll();
        stopRpc();
    });
    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit();
    });
    app.on('activate', () => {
        if (!mainWindow && BrowserWindow.getAllWindows().length === 0) createWindow();
    });
}
