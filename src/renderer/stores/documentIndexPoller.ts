import { listDocuments as listDocumentsRequest, type ApiDocument } from "../api";

const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 40;

const pollAttempts = new Map<string, number>();
const pollTimers = new Map<string, number>();

export function scheduleDocumentIndexPolling(
  workspaceId: string,
  setDocuments: (docs: ApiDocument[]) => void,
): void {
  if (pollTimers.has(workspaceId)) return;

  const poll = async () => {
    const attempts = (pollAttempts.get(workspaceId) ?? 0) + 1;
    pollAttempts.set(workspaceId, attempts);

    try {
      const docs = await listDocumentsRequest(workspaceId);
      setDocuments(docs);
      const hasPending = docs.some((doc) => doc.indexed_at == null);
      if (hasPending && attempts < POLL_MAX_ATTEMPTS) {
        pollTimers.set(workspaceId, window.setTimeout(poll, POLL_INTERVAL_MS));
        return;
      }
    } catch {
      if (attempts < POLL_MAX_ATTEMPTS) {
        pollTimers.set(workspaceId, window.setTimeout(poll, POLL_INTERVAL_MS));
        return;
      }
    }

    pollAttempts.delete(workspaceId);
    pollTimers.delete(workspaceId);
  };

  pollTimers.set(workspaceId, window.setTimeout(poll, POLL_INTERVAL_MS));
}
