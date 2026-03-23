const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("lmChat", {
  platform: process.platform
});