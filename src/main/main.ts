import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";

let mainWindow: BrowserWindow | null = null;

const WINDOW_RESOLUTIONS: Record<string, { width: number; height: number }> = {
  "1920x1080": { width: 1920, height: 1080 },
  "1600x900": { width: 1600, height: 900 },
};
const DEFAULT_WINDOW_RESOLUTION = "1920x1080";

function getWindowResolutionSize(resolution: unknown) {
  const key = typeof resolution === "string" && resolution in WINDOW_RESOLUTIONS
    ? resolution
    : DEFAULT_WINDOW_RESOLUTION;
  return WINDOW_RESOLUTIONS[key];
}

function loadWindowResolutionSize() {
  const settingsPath = path.join(__dirname, "../../data/settings.json");
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as { window_resolution?: unknown };
    return getWindowResolutionSize(settings.window_resolution);
  } catch {
    return getWindowResolutionSize(DEFAULT_WINDOW_RESOLUTION);
  }
}

function buildExportFileName() {
  const now = new Date();
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `lm-chat-data-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.zip`;
}

function sanitizeFileNamePart(value: string) {
  const cleaned = value.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/\s+/g, "_");
  return cleaned.replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
}

function buildWorkspaceExportFileName(workspaceName?: string | null) {
  const now = new Date();
  const pad = (value: number) => value.toString().padStart(2, "0");
  const namePart = sanitizeFileNamePart(workspaceName || "") || "workspace";
  return `lm-chat-workspace-${namePart}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.zip`;
}

function createWindow() {
  const { width, height } = loadWindowResolutionSize();
  const win = new BrowserWindow({
    width,
    height,
    useContentSize: true,
    minWidth: 1200,
    minHeight: 760,
    show: false,
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

  win.once("ready-to-show", () => {
    win.show();
  });

  win.on("closed", () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  mainWindow = win;
}

app.commandLine.appendSwitch("disable-gpu-disk-cache");

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = mainWindow;
    if (!win) {
      return;
    }

    if (win.isMinimized()) {
      win.restore();
    }
    win.show();
    win.focus();
  });

  app.whenReady().then(() => {
    ipcMain.handle("lm-chat:choose-export-archive-path", async (_event, suggestedName?: string) => {
      const focusedWindow = BrowserWindow.getFocusedWindow();
      const defaultFileName = suggestedName ? buildWorkspaceExportFileName(suggestedName) : buildExportFileName();
      const options = {
        title: "データをエクスポート",
        buttonLabel: "保存",
        defaultPath: path.join(app.getPath("documents"), defaultFileName),
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

    ipcMain.handle("lm-chat:choose-library-folder", async (_event, mode?: "open" | "create") => {
      const focusedWindow = BrowserWindow.getFocusedWindow();
      const options = {
        title: mode === "create" ? "新しいライブラリの場所を選択" : "ライブラリを開く",
        buttonLabel: mode === "create" ? "ここに作成" : "開く",
        properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">,
        defaultPath: app.getPath("documents")
      };
      const result = focusedWindow
        ? await dialog.showOpenDialog(focusedWindow, options)
        : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    });

    ipcMain.handle("lm-chat:show-item-in-folder", async (_event, targetPath: string) => {
      if (!targetPath) {
        return false;
      }
      shell.showItemInFolder(path.normalize(targetPath));
      return true;
    });

    ipcMain.handle("lm-chat:set-window-resolution", async (_event, resolution: string) => {
      const focusedWindow = BrowserWindow.getFocusedWindow() ?? mainWindow;
      if (!focusedWindow) {
        return false;
      }
      const { width, height } = getWindowResolutionSize(resolution);
      focusedWindow.setContentSize(width, height);
      return true;
    });

    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
