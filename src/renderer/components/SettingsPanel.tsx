export function SettingsPanel() {
  return (
    <div className="settings-stack">
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Utility</p>
            <h2>Runtime</h2>
          </div>
        </div>
        <div className="stat-list">
          <div className="stat-row">
            <span>llama-server</span>
            <code>bin/llama-server/current/llama-server.exe</code>
          </div>
          <div className="stat-row">
            <span>Search Engine</span>
            <strong>SearXNG</strong>
          </div>
          <div className="stat-row">
            <span>Memory Scope</span>
            <strong>Current Workspace</strong>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Memory</p>
            <h2>Workspace Policy</h2>
          </div>
        </div>
        <ul className="simple-list">
          <li>Chats, history, and memory stay inside one workspace.</li>
          <li>No automatic memory injection from other workspaces.</li>
          <li>New chats are created inside the current workspace.</li>
        </ul>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Setup</p>
            <h2>Next Steps</h2>
          </div>
        </div>
        <ul className="simple-list">
          <li>Add SQLite persistence for history and memory.</li>
          <li>Connect memory search through FastAPI.</li>
          <li>Replace the search stub with live SearXNG results.</li>
        </ul>
      </section>
    </div>
  );
}