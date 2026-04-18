const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lmChat", {
  platform: process.platform,
  apiBase: process.env.LM_CHAT_API_BASE_URL || process.env.VITE_API_BASE_URL || "http://127.0.0.1:8000",
  chooseExportArchivePath: () => ipcRenderer.invoke("lm-chat:choose-export-archive-path"),
  chooseImportArchivePath: () => ipcRenderer.invoke("lm-chat:choose-import-archive-path")
});
