export function SettingsPanel() {
  return (
    <div className="settings-stack">
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">システム</p>
            <h2>実行環境</h2>
          </div>
        </div>
        <div className="stat-list">
          <div className="stat-row">
            <span>推論サーバー</span>
            <code>bin/llama-server/current/llama-server.exe</code>
          </div>
          <div className="stat-row">
            <span>検索エンジン</span>
            <strong>SearXNG</strong>
          </div>
          <div className="stat-row">
            <span>記憶スコープ</span>
            <strong>現在のワークスペース</strong>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">記憶</p>
            <h2>ワークスペースポリシー</h2>
          </div>
        </div>
        <ul className="simple-list">
          <li>チャット、履歴、記憶は同一ワークスペース内に保持されます。</li>
          <li>他のワークスペースの記憶は自動注入されません。</li>
          <li>新規チャットは現在のワークスペース内に作成されます。</li>
        </ul>
      </section>
    </div>
  );
}
