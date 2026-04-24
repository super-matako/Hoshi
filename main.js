// main.js
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const readline = require('readline');

// --- GLOBAL STATE ---
let mainWindow;
let katagoProcess;
let batchedAnalysisData = [];
let batchInterval;
let currentFilePath = null; // Tracks the active SGF file to enable quick "Save" without a dialog

function createWindow() {
    Menu.setApplicationMenu(null);

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        frame: false, // Disables the native OS window frame for a custom UI
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile('index.html');
}

// --- ENGINE MANAGEMENT ---
function startKataGo(customPaths = {}) {
    // Terminate any running engine instance before booting a new one
    if (katagoProcess) {
        katagoProcess.kill();
        katagoProcess = null;
    }
    if (batchInterval) {
        clearInterval(batchInterval);
        batchInterval = null;
    }

    const exeExtension = process.platform === 'win32' ? '.exe' : '';

    // Dynamically locate the bundled KataGo folder based on the build environment
    const engineFolder = app.isPackaged
        ? path.join(process.resourcesPath, 'KataGo')
        : path.join(__dirname, 'KataGo');

    const defaultExe = path.join(engineFolder, `katago${exeExtension}`);
    const defaultNet = path.join(engineFolder, 'default_model.bin.gz');
    const defaultCfg = path.join(engineFolder, 'analysis_example.cfg');

    // Override defaults if the user provided custom paths via the UI
    const katagoPath = (customPaths.exe && customPaths.exe.trim() !== '') ? customPaths.exe : defaultExe;
    const modelPath = (customPaths.net && customPaths.net.trim() !== '') ? customPaths.net : defaultNet;
    const configPath = (customPaths.cfg && customPaths.cfg.trim() !== '') ? customPaths.cfg : defaultCfg;

    // Check if the executable actually exists before trying to spawn it
    if (!fs.existsSync(katagoPath)) {
        if (mainWindow && !mainWindow.isDestroyed()) {
            // Sneak an error object through the standard data pipe
            mainWindow.webContents.send('analysis-data-batch', [{ error: "engine_missing" }]);
        }
        return;
    }

    try {
        // Boot the KataGo process in analysis mode
        katagoProcess = spawn(katagoPath, [
            'analysis',
            '-model', modelPath,
            '-config', configPath,
            '-override-config', 'reportAnalysisWinratesAs=black'
        ]);

        katagoProcess.stdin.on('error', (err) => {
            console.error("KataGo stdin error (engine likely died):", err);
        });

        // Set up the read stream to capture JSON responses from KataGo
        const rl = readline.createInterface({
            input: katagoProcess.stdout,
            terminal: false
        });

        rl.on('line', (line) => {
            try {
                const data = JSON.parse(line);
                batchedAnalysisData.push(data);
            } catch (e) {
                console.error("Failed to parse KataGo JSON:", e);
            }
        });

        katagoProcess.stderr.on('data', (data) => {
            console.log(`KataGo Log: ${data}`);
        });

        // Throttle updates to the frontend (50ms) to prevent UI lag during heavy analysis
        batchInterval = setInterval(() => {
            if (batchedAnalysisData.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('analysis-data-batch', batchedAnalysisData);
                batchedAnalysisData = [];
            }
        }, 50);
    } catch (error) {
        console.error("Failed to start KataGo:", error);
    }
}

// --- APP INITIALIZATION & IPC LISTENERS ---
app.whenReady().then(() => {
    createWindow();

    ipcMain.on('start-engine', (event, paths) => {
        startKataGo(paths);
    });

    // Provides the frontend with the correct absolute paths for the fallback engine
    ipcMain.handle('get-default-engine-paths', () => {
    let basePath;

    // 1. If running as a single portable .exe, look next to the .exe file
    if (process.env.PORTABLE_EXECUTABLE_DIR) {
        basePath = process.env.PORTABLE_EXECUTABLE_DIR;
    }
    // 2. If running as a standard installed app
    else if (app.isPackaged) {
        basePath = path.dirname(app.getPath('exe'));
    }
    // 3. If running in development (npm start)
    else {
        basePath = __dirname;
    }

    const exeExt = process.platform === 'win32' ? '.exe' : '';

    return {
        exe: path.join(basePath, 'KataGo', `katago${exeExt}`),
        net: path.join(basePath, 'KataGo', 'default_model.bin.gz'),
        cfg: path.join(basePath, 'KataGo', 'analysis_example.cfg')
    };
});

    // --- NATIVE OS FILE PICKERS ---

    // Helper to abstract the dialog boilerplate
    async function handleFileSelection(title, extensions, currentPath) {
        let options = {
            title: title,
            properties: ['openFile'],
            filters: [{ name: 'Allowed Files', extensions: extensions }]
        };

        if (currentPath && currentPath.trim() !== '') {
            options.defaultPath = path.resolve(__dirname, currentPath.trim());
        }

        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, options);
        if (!canceled && filePaths.length > 0) return filePaths[0];
        return null;
    }

    ipcMain.handle('choose-engine-file', (e, p) => handleFileSelection('Select KataGo Executable', ['exe', 'app', '*'], p));
    ipcMain.handle('choose-network-file', (e, p) => handleFileSelection('Select Network Model', ['bin.gz', 'gz'], p));
    ipcMain.handle('choose-config-file', (e, p) => handleFileSelection('Select Configuration File', ['cfg', 'txt'], p));

    // --- ENGINE COMMUNICATION ---
    ipcMain.on('send-analysis-query', (event, queryObj) => {
        if (katagoProcess && !katagoProcess.killed && katagoProcess.stdin.writable) {
            katagoProcess.stdin.write(JSON.stringify(queryObj) + '\n');
        }
    });

    // --- SGF FILE MANAGEMENT ---
    ipcMain.on('open-sgf', async (event) => {
        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
            title: 'Open SGF File',
            properties: ['openFile'],
            filters: [{ name: 'SGF Games', extensions: ['sgf'] }]
        });

        if (!canceled && filePaths.length > 0) {
            currentFilePath = filePaths[0];
            const content = fs.readFileSync(filePaths[0], 'utf-8');
            event.sender.send('sgf-data', content);
            event.sender.send('file-linked');
        }
    });

    // Detaches the current file binding when the user starts a fresh game
    ipcMain.on('reset-file-path', () => {
        currentFilePath = null;
    });

    // Links a dragged-and-dropped file to the active session
        ipcMain.on('set-file-path', (event, filePath) => {
            currentFilePath = filePath;
            event.sender.send('file-linked'); // Tell the UI to lock in the "Save" state
        });

    ipcMain.on('save-sgf', async (event, sgfData, fallbackName) => {
        if (currentFilePath) {
            // Overwrite the existing file silently
            fs.writeFileSync(currentFilePath, sgfData, 'utf-8');
        } else {
            // First time saving, prompt the OS Save dialog
            let defaultPath = path.join(app.getPath('documents'), fallbackName || 'New Game.sgf');

            const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
                title: 'Save SGF File',
                defaultPath: defaultPath,
                filters: [{ name: 'SGF Games', extensions: ['sgf'] }]
            });

            if (!canceled && filePath) {
                currentFilePath = filePath;
                fs.writeFileSync(filePath, sgfData, 'utf-8');
                event.sender.send('file-linked');
            }
        }
    });

    ipcMain.on('save-as-sgf', async (event, sgfData, fallbackName) => {
        let defaultPath = currentFilePath || path.join(app.getPath('documents'), fallbackName || 'New Game.sgf');

        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
            title: 'Save SGF File As',
            defaultPath: defaultPath,
            filters: [{ name: 'SGF Games', extensions: ['sgf'] }]
        });

        if (!canceled && filePath) {
            currentFilePath = filePath;
            fs.writeFileSync(filePath, sgfData, 'utf-8');
            event.sender.send('file-linked');
        }
    });

    // --- CUSTOM WINDOW CONTROLS ---
    ipcMain.on('window-minimize', () => {
        if (mainWindow) mainWindow.minimize();
    });

    ipcMain.on('window-maximize', () => {
        if (mainWindow) {
            if (mainWindow.isMaximized()) {
                mainWindow.unmaximize();
            } else {
                mainWindow.maximize();
            }
        }
    });

    ipcMain.on('window-close', () => {
        if (mainWindow) mainWindow.close();
    });

    ipcMain.on('exit-app', () => app.quit());
});

// --- PROCESS CLEANUP ---
app.on('will-quit', () => {
    if (batchInterval) clearInterval(batchInterval);
    if (katagoProcess) katagoProcess.kill();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
