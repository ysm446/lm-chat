export function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function HighlightText({ text, query, current }: { text: string; query: string; current: boolean }) {
  if (!query.trim()) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRegex(query)})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
          ? <mark key={i} className={`search-highlight${current ? " current" : ""}`}>{part}</mark>
          : part
      )}
    </>
  );
}

function hastHighlight(node: any, query: string, className: string[]) {
  if (!node.children) return;
  const newChildren: any[] = [];
  for (const child of node.children) {
    if (child.type === "text") {
      const parts = child.value.split(new RegExp(`(${escapeRegex(query)})`, "gi"));
      if (parts.length === 1) {
        newChildren.push(child);
      } else {
        for (const part of parts) {
          if (!part) continue;
          if (part.toLowerCase() === query.toLowerCase()) {
            newChildren.push({
              type: "element", tagName: "mark",
              properties: { className },
              children: [{ type: "text", value: part }],
            });
          } else {
            newChildren.push({ type: "text", value: part });
          }
        }
      }
    } else {
      hastHighlight(child, query, className);
      newChildren.push(child);
    }
  }
  node.children = newChildren;
}

export function makeHighlightPlugin(query: string, isCurrent: boolean) {
  const className = isCurrent ? ["search-highlight", "current"] : ["search-highlight"];
  return () => (tree: any) => {
    if (!query.trim()) return;
    hastHighlight(tree, query, className);
  };
}

export function resizeTextareaToContent(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

export function parseThinking(content: string): { thinking: string | null; response: string; streaming: boolean } {
  const complete = content.match(/^<think>([\s\S]*?)<\/think>\n?/);
  if (complete) {
    return { thinking: complete[1].trim(), response: content.slice(complete[0].length), streaming: false };
  }
  if (content.startsWith("<think>")) {
    return { thinking: content.slice(7), response: "", streaming: true };
  }
  return { thinking: null, response: content, streaming: false };
}
