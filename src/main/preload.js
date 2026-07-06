"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld("lmChat", {
    platform: process.platform,
    apiBase: process.env.LM_CHAT_API_BASE_URL || process.env.VITE_API_BASE_URL || "http://127.0.0.1:8000",
    chooseExportArchivePath: (suggestedName) => electron_1.ipcRenderer.invoke("lm-chat:choose-export-archive-path", suggestedName),
    chooseImportArchivePath: () => electron_1.ipcRenderer.invoke("lm-chat:choose-import-archive-path"),
    chooseLibraryFolder: (mode) => electron_1.ipcRenderer.invoke("lm-chat:choose-library-folder", mode),
    setWindowResolution: (resolution) => electron_1.ipcRenderer.invoke("lm-chat:set-window-resolution", resolution),
    showItemInFolder: (targetPath) => electron_1.ipcRenderer.invoke("lm-chat:show-item-in-folder", targetPath)
});
