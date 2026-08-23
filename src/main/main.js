"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
let mainWindow = null;
const WINDOW_RESOLUTIONS = {
    "1920x1080": { width: 1920, height: 1080 },
    "1600x900": { width: 1600, height: 900 },
};
const DEFAULT_WINDOW_RESOLUTION = "1920x1080";
function getWindowResolutionSize(resolution) {
    const key = typeof resolution === "string" && resolution in WINDOW_RESOLUTIONS
        ? resolution
        : DEFAULT_WINDOW_RESOLUTION;
    return WINDOW_RESOLUTIONS[key];
}
function loadWindowResolutionSize() {
    const settingsPath = node_path_1.default.join(__dirname, "../../data/settings.json");
    try {
        const settings = JSON.parse(node_fs_1.default.readFileSync(settingsPath, "utf-8"));
        return getWindowResolutionSize(settings.window_resolution);
    }
    catch {
        return getWindowResolutionSize(DEFAULT_WINDOW_RESOLUTION);
    }
}
function buildExportFileName() {
    const now = new Date();
    const pad = (value) => value.toString().padStart(2, "0");
    return `lm-chat-data-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.zip`;
}
function sanitizeFileNamePart(value) {
    const cleaned = value.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/\s+/g, "_");
    return cleaned.replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
}
function buildWorkspaceExportFileName(workspaceName) {
    const now = new Date();
    const pad = (value) => value.toString().padStart(2, "0");
    const namePart = sanitizeFileNamePart(workspaceName || "") || "workspace";
    return `lm-chat-workspace-${namePart}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.zip`;
}
function createWindow() {
    const { width, height } = loadWindowResolutionSize();
    const win = new electron_1.BrowserWindow({
        width,
        height,
        useContentSize: true,
        minWidth: 1200,
        minHeight: 760,
        show: false,
        backgroundColor: "#0f141c",
        autoHideMenuBar: true,
        icon: node_path_1.default.join(__dirname, "../../assets/icon.ico"),
        webPreferences: {
            preload: node_path_1.default.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (devUrl) {
        void win.loadURL(devUrl);
    }
    else {
        void win.loadFile(node_path_1.default.join(__dirname, "../../dist/index.html"));
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
electron_1.app.commandLine.appendSwitch("disable-gpu-disk-cache");
const gotSingleInstanceLock = electron_1.app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    electron_1.app.quit();
}
else {
    electron_1.app.on("second-instance", () => {
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
    electron_1.app.whenReady().then(() => {
        electron_1.ipcMain.handle("lm-chat:choose-export-archive-path", async (_event, suggestedName) => {
            const focusedWindow = electron_1.BrowserWindow.getFocusedWindow();
            const defaultFileName = suggestedName ? buildWorkspaceExportFileName(suggestedName) : buildExportFileName();
            const options = {
                title: "データをエクスポート",
                buttonLabel: "保存",
                defaultPath: node_path_1.default.join(electron_1.app.getPath("documents"), defaultFileName),
                filters: [{ name: "ZIP Archive", extensions: ["zip"] }]
            };
            const result = focusedWindow
                ? await electron_1.dialog.showSaveDialog(focusedWindow, options)
                : await electron_1.dialog.showSaveDialog(options);
            return result.canceled ? null : (result.filePath ?? null);
        });
        electron_1.ipcMain.handle("lm-chat:choose-import-archive-path", async () => {
            const focusedWindow = electron_1.BrowserWindow.getFocusedWindow();
            const options = {
                title: "データをインポート",
                buttonLabel: "選択",
                properties: ["openFile"],
                filters: [{ name: "ZIP Archive", extensions: ["zip"] }]
            };
            const result = focusedWindow
                ? await electron_1.dialog.showOpenDialog(focusedWindow, options)
                : await electron_1.dialog.showOpenDialog(options);
            return result.canceled ? null : (result.filePaths[0] ?? null);
        });
        electron_1.ipcMain.handle("lm-chat:choose-library-folder", async (_event, mode) => {
            const focusedWindow = electron_1.BrowserWindow.getFocusedWindow();
            const options = {
                title: mode === "create" ? "新しいライブラリの場所を選択" : "ライブラリを開く",
                buttonLabel: mode === "create" ? "ここに作成" : "開く",
                properties: ["openDirectory", "createDirectory"],
                defaultPath: electron_1.app.getPath("documents")
            };
            const result = focusedWindow
                ? await electron_1.dialog.showOpenDialog(focusedWindow, options)
                : await electron_1.dialog.showOpenDialog(options);
            return result.canceled ? null : (result.filePaths[0] ?? null);
        });
        electron_1.ipcMain.handle("lm-chat:choose-models-folder", async (_event, currentPath) => {
            const focusedWindow = electron_1.BrowserWindow.getFocusedWindow();
            const options = {
                title: "モデルフォルダを選択",
                buttonLabel: "選択",
                properties: ["openDirectory"],
                defaultPath: currentPath || electron_1.app.getPath("documents")
            };
            const result = focusedWindow
                ? await electron_1.dialog.showOpenDialog(focusedWindow, options)
                : await electron_1.dialog.showOpenDialog(options);
            return result.canceled ? null : (result.filePaths[0] ?? null);
        });
        electron_1.ipcMain.handle("lm-chat:show-item-in-folder", async (_event, targetPath) => {
            if (!targetPath) {
                return false;
            }
            electron_1.shell.showItemInFolder(node_path_1.default.normalize(targetPath));
            return true;
        });
        electron_1.ipcMain.handle("lm-chat:set-window-resolution", async (_event, resolution) => {
            const focusedWindow = electron_1.BrowserWindow.getFocusedWindow() ?? mainWindow;
            if (!focusedWindow) {
                return false;
            }
            const { width, height } = getWindowResolutionSize(resolution);
            focusedWindow.setContentSize(width, height);
            return true;
        });
        createWindow();
        electron_1.app.on("activate", () => {
            if (electron_1.BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    });
}
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        electron_1.app.quit();
    }
});
