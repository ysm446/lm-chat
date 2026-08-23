interface LmChatBridge {
  platform: string;
  apiBase: string;
  chooseExportArchivePath: (suggestedName?: string) => Promise<string | null>;
  chooseImportArchivePath: () => Promise<string | null>;
  chooseLibraryFolder: (mode?: "open" | "create") => Promise<string | null>;
  chooseModelsFolder: (currentPath?: string) => Promise<string | null>;
  setWindowResolution: (resolution: string) => Promise<boolean>;
  showItemInFolder: (targetPath: string) => Promise<boolean>;
}

declare global {
  interface Window {
    lmChat?: LmChatBridge;
  }
}

export {};
