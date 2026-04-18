interface LmChatBridge {
  platform: string;
  apiBase: string;
  chooseExportArchivePath: () => Promise<string | null>;
  chooseImportArchivePath: () => Promise<string | null>;
}

declare global {
  interface Window {
    lmChat?: LmChatBridge;
  }
}

export {};
