// preload.js
const { contextBridge, ipcRenderer, webUtils } = require('electron'); // webUtils

contextBridge.exposeInMainWorld('electronAPI', {
    // Securely extract the file path for Drag and Drop
    getFilePath: (file) => webUtils ? webUtils.getPathForFile(file) : file.path,

    // --- ENGINE CONFIGURATION & STARTUP ---
    startEngine: (paths) => ipcRenderer.send('start-engine', paths),
    getDefaultEnginePaths: () => ipcRenderer.invoke('get-default-engine-paths'),

    // Native OS file dialog triggers for engine settings
    chooseEngineFile: (currentPath) => ipcRenderer.invoke('choose-engine-file', currentPath),
    chooseNetworkFile: (currentPath) => ipcRenderer.invoke('choose-network-file', currentPath),
    chooseConfigFile: (currentPath) => ipcRenderer.invoke('choose-config-file', currentPath),

    // --- ENGINE ANALYSIS COMMUNICATION ---
    sendAnalysisQuery: (query) => ipcRenderer.send('send-analysis-query', query),
    onAnalysisDataBatch: (callback) => ipcRenderer.on('analysis-data-batch', (event, dataArray) => callback(dataArray)),

    // --- SGF FILE MANAGEMENT ---
    openSgf: () => ipcRenderer.send('open-sgf'),
    onSgfData: (callback) => ipcRenderer.on('sgf-data', (event, data) => callback(data)),
    setFilePath: (path) => ipcRenderer.send('set-file-path', path),

    // File binding listeners to enable seamless "Save" vs "Save As" functionality
    onFileLinked: (callback) => ipcRenderer.on('file-linked', () => callback()),
    resetFilePath: () => ipcRenderer.send('reset-file-path'),

    saveSgf: (data, defaultName) => ipcRenderer.send('save-sgf', data, defaultName),
    saveAsSgf: (data, defaultName) => ipcRenderer.send('save-as-sgf', data, defaultName),

    // --- WINDOW & APPLICATION CONTROLS ---
    minimizeWindow: () => ipcRenderer.send('window-minimize'),
    maximizeWindow: () => ipcRenderer.send('window-maximize'),
    closeWindow: () => ipcRenderer.send('window-close'),
    exitApp: () => ipcRenderer.send('exit-app')

});
