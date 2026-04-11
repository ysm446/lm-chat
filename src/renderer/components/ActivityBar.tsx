export type AppMode = "chat" | "system-prompt";

type Props = {
  mode: AppMode;
  onSetMode: (m: AppMode) => void;
};

export function ActivityBar({ mode, onSetMode }: Props) {
  return (
    <div className="activity-bar">
      <button
        className={`activity-bar-btn${mode === "chat" ? " active" : ""}`}
        onClick={() => onSetMode("chat")}
        title="チャット"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </button>
      <button
        className={`activity-bar-btn${mode === "system-prompt" ? " active" : ""}`}
        onClick={() => onSetMode("system-prompt")}
        title="システムプロンプト"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
      </button>
    </div>
  );
}
