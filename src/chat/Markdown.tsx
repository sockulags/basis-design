import { Fragment, type ReactNode } from "react";
import styles from "./ChatPanel.module.css";

/** Inline `code` and **bold**. */
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
      return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

/** Just enough Markdown for agent replies: paragraphs, lists, headings and fenced code. */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.startsWith("```")) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").startsWith("```")) body.push(lines[i++] ?? "");
      i += 1;
      blocks.push(<pre key={blocks.length}>{body.join("\n")}</pre>);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*([-*]|\d+\.)\s+/, ""));
        i += 1;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={blocks.length}>
          {items.map((item, index) => (
            <li key={index}>{inline(item)}</li>
          ))}
        </List>,
      );
      continue;
    }
    if (/^#{1,4}\s/.test(line)) {
      blocks.push(
        <p key={blocks.length} className={styles.mdHeading}>
          {inline(line.replace(/^#+\s/, ""))}
        </p>,
      );
      i += 1;
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() && !/^(```|\s*([-*]|\d+\.)\s+|#{1,4}\s)/.test(lines[i] ?? "")) {
      paragraph.push(lines[i++] ?? "");
    }
    blocks.push(<p key={blocks.length}>{inline(paragraph.join("\n"))}</p>);
  }
  return <div className={styles.markdown}>{blocks}</div>;
}
