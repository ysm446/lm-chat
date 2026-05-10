import type { Message } from "../../api";

interface Props {
  message: Message;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteConfirmModal({ message, onConfirm, onCancel }: Props) {
  const roleLabel =
    message.role === "assistant" ? "アシスタント"
    : message.role === "user" ? "ユーザー"
    : "システム";

  return (
    <div className="modal-backdrop" onClick={onCancel} role="dialog" aria-modal="true" aria-label="メッセージ削除の確認">
      <div className="delete-confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="delete-confirm-header">
          <h2>途中のメッセージを削除しますか？</h2>
          <p>最後以外のメッセージを削除すると、この会話の文脈や後続返信とのつながりが崩れることがあります。</p>
        </div>
        <div className="delete-confirm-preview">
          <span>{roleLabel}</span>
          <p>{message.content.trim() || "添付画像のみのメッセージ"}</p>
        </div>
        <div className="delete-confirm-actions">
          <button type="button" className="delete-confirm-cancel" onClick={onCancel}>キャンセル</button>
          <button type="button" className="delete-confirm-delete" onClick={onConfirm}>削除</button>
        </div>
      </div>
    </div>
  );
}
