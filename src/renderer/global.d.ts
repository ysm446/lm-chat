interface LmChatBridge {
  platform: string;
  apiBase: string;
}

declare global {
  interface Window {
    lmChat?: LmChatBridge;
  }
}

export {};
