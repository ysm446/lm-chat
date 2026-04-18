import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";

function buildExportFileName() {
  const now = new Date();
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `lm-chat-data-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.zip`;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: "#0f141c",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "../../assets/icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
}

app.commandLine.appendSwitch("disable-gpu-disk-cache");

app.whenReady().then(() => {
  ipcMain.handle("lm-chat:choose-export-archive-path", async () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    const options = {
      title: "データをエクスポート",
      buttonLabel: "保存",
      defaultPath: path.join(app.getPath("documents"), buildExportFileName()),
      filters: [{ name: "ZIP Archive", extensions: ["zip"] }]
    };
    const result = focusedWindow
      ? await dialog.showSaveDialog(focusedWindow, options)
      : await dialog.showSaveDialog(options);
    return result.canceled ? null : (result.filePath ?? null);
  });

  ipcMain.handle("lm-chat:choose-import-archive-path", async () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    const options = {
      title: "データをインポート",
      buttonLabel: "選択",
      properties: ["openFile"] as Array<"openFile">,
      filters: [{ name: "ZIP Archive", extensions: ["zip"] }]
    };
    const result = focusedWindow
      ? await dialog.showOpenDialog(focusedWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
