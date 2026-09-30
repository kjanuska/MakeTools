// Proxy files (`proxy/*.txt`): one proxy per line, no header.
//   host:port
//   host:port:user:pass
//   localhost
// A file is only rewritten by an edit (typing in the editor, shuffle). Loading
// and saving without one writes the exact bytes back, because the store keeps
// the text as read. Each edit keeps the file's BOM and line ending.
import { splitLines } from "./csvTable";

export interface ProxyFile {
  bom: boolean;
  /** Line texts, without endings. A final line ending doesn't start another line. */
  lines: string[];
  /** Ending used for new text: LF if the file uses LF only, otherwise CRLF (also for 0 or 1 line). */
  eol: "\n" | "\r\n";
  trailingNewline: boolean;
}

export interface OddLine {
  /** 1-based line number. */
  line: number;
  text: string;
  problem: string;
}

export function parseProxies(fileText: string): ProxyFile {
  const bom = fileText.startsWith("﻿");
  const split = splitLines(bom ? fileText.slice(1) : fileText);
  const lfOnly = split.some((l) => l.eol === "\n") && !split.some((l) => l.eol === "\r\n");
  return {
    bom,
    lines: split.map((l) => l.text),
    eol: lfOnly ? "\n" : "\r\n",
    trailingNewline: split.length > 0 && split[split.length - 1].eol !== "",
  };
}

/** Writes `p` with one line ending throughout. Only used for edited files. */
export function serializeProxies(p: ProxyFile): string {
  const body = p.lines.join(p.eol) + (p.trailingNewline && p.lines.length > 0 ? p.eol : "");
  return (p.bom ? "﻿" : "") + body;
}

const isBlank = (line: string) => line.trim() === "";

/** Proxies in the file: its non-blank lines. */
export const countProxies = (p: ProxyFile) => p.lines.filter((l) => !isBlank(l)).length;

/** Why a line isn't a proxy, or null if it is one. */
export function proxyProblem(line: string): string | null {
  if (/\s/.test(line)) return "Contains a space.";
  if (line === "localhost") return null;
  const parts = line.split(":");
  if (parts.length !== 2 && parts.length !== 4) {
    return `Expected host:port or host:port:user:pass (found ${parts.length} ${parts.length === 1 ? "part" : "parts"}).`;
  }
  const [host, port, user, pass] = parts;
  if (host === "") return "The host is empty.";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) return "The port must be a number from 1 to 65535.";
  if (parts.length === 4 && (user === "" || pass === "")) return "The user and password can't be empty.";
  return null;
}

/** Non-blank lines that aren't proxies. Warnings only. */
export function oddLines(lines: readonly string[]): OddLine[] {
  const odd: OddLine[] = [];
  lines.forEach((text, i) => {
    if (isBlank(text)) return;
    const problem = proxyProblem(text);
    if (problem) odd.push({ line: i + 1, text, problem });
  });
  return odd;
}

/** The file as shown in the editor: no BOM, "\n" line endings (what a text box uses). */
export function toEditorText(fileText: string): string {
  const body = fileText.startsWith("﻿") ? fileText.slice(1) : fileText;
  return body.replace(/\r\n/g, "\n");
}

/**
 * Editor text back to file text in the style of `fileText`: its BOM, and its
 * line ending (CRLF, or LF for an LF-only file) on every line. The text is
 * kept as typed otherwise, including a final line ending or none. If the editor
 * text hasn't changed, `fileText` is returned exactly (even with mixed endings).
 */
export function fromEditorText(editorText: string, fileText: string): string {
  const value = editorText.replace(/\r\n?/g, "\n");
  if (value === toEditorText(fileText)) return fileText;
  const p = parseProxies(fileText);
  return (p.bom ? "﻿" : "") + (p.eol === "\n" ? value : value.replace(/\n/g, "\r\n"));
}

/**
 * The file's non-blank lines in a random order, different from the current
 * one whenever that's possible (2+ lines, not all the same). Blank lines are
 * dropped. `random` returns a number in [0, 1), like Math.random.
 */
export function shuffleProxies(fileText: string, random: () => number = Math.random): string {
  const p = parseProxies(fileText);
  const lines = p.lines.filter((l) => !isBlank(l));
  const canDiffer = lines.some((l) => l !== lines[0]);
  let out = lines;
  for (let attempt = 0; attempt < 20; attempt++) {
    out = [...lines];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    if (!canDiffer || out.some((l, i) => l !== lines[i])) break;
  }
  // A random source that keeps giving the same order: move every line one place.
  // That changes the order unless all lines are the same.
  if (canDiffer && out.every((l, i) => l === lines[i])) out = [...lines.slice(1), lines[0]];
  return serializeProxies({ ...p, lines: out });
}
