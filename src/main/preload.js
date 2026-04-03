const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("lmChat", {
  platform: process.platform,
  apiBase: process.env.LM_CHAT_API_BASE_URL || process.env.VITE_API_BASE_URL || "http://127.0.0.1:8000"
});
