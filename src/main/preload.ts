import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("lmChat", {
  platform: process.platform
});
