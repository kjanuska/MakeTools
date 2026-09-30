// Account files (`account/*.txt`): one account per line, colon-delimited, no header.
//   email:password
//   email:password:proxyHost:proxyPort
//   email:password:proxyHost:proxyPort:proxyUser:proxyPass
// Nothing is ever rewritten: the file is only read, or has lines appended to it,
// so existing bytes (line endings, BOM, odd lines) stay exactly as they are.
import { splitLines, type Eol } from "./csvTable";

export interface Account {
  email: string;
  password: string;
  proxyHost?: string;
  proxyPort?: string;
  proxyUser?: string;
  proxyPass?: string;
}

export type AccountLine =
  | { kind: "account"; line: number; account: Account }
  /** A blank line or one without 2, 4 or 6 parts. Shown, never changed. */
  | { kind: "raw"; line: number; text: string };

export interface AccountsDoc {
  bom: boolean;
  lines: AccountLine[];
  /** Ending used for appended lines: the file's most common one, CRLF on a tie or for an empty file. */
  eol: "\n" | "\r\n";
  trailingNewline: boolean;
}

/**
 * Why a line isn't in the account format, or null if it is. Only the number
 * of parts is checked: the values themselves can be anything.
 */
function problemOf(parts: string[]): string | null {
  if ([2, 4, 6].includes(parts.length)) return null;
  return `Expected email:password, optionally followed by :host:port and :user:pass (found ${parts.length} ${parts.length === 1 ? "part" : "parts"}).`;
}

function toAccount(parts: string[]): Account {
  const [email, password, proxyHost, proxyPort, proxyUser, proxyPass] = parts;
  const a: Account = { email, password };
  if (parts.length >= 4) Object.assign(a, { proxyHost, proxyPort });
  if (parts.length === 6) Object.assign(a, { proxyUser, proxyPass });
  return a;
}

export function parseAccounts(fileText: string): AccountsDoc {
  const bom = fileText.startsWith("﻿");
  const lines = splitLines(bom ? fileText.slice(1) : fileText);
  let crlf = 0;
  let lf = 0;
  for (const l of lines) {
    if (l.eol === "\r\n") crlf++;
    else if (l.eol === "\n") lf++;
  }
  return {
    bom,
    lines: lines.map((l, i): AccountLine => {
      const parts = l.text.split(":");
      return problemOf(parts) === null
        ? { kind: "account", line: i + 1, account: toAccount(parts) }
        : { kind: "raw", line: i + 1, text: l.text };
    }),
    eol: lf > crlf ? "\n" : "\r\n",
    trailingNewline: lines.length > 0 && lines[lines.length - 1].eol !== "",
  };
}

export const accountsOf = (doc: AccountsDoc): Account[] =>
  doc.lines.flatMap((l) => (l.kind === "account" ? [l.account] : []));

/** Unparseable lines, not counting blank ones. */
export const oddLines = (doc: AccountsDoc) => doc.lines.filter((l) => l.kind === "raw" && l.text.trim() !== "");

export const hasProxy = (a: Account) => a.proxyHost !== undefined;

export interface ImportPlan {
  /** Lines to append, exactly as pasted, in order. */
  add: { line: number; text: string; account: Account }[];
  invalid: { line: number; text: string; reason: string }[];
}

/**
 * Sorts pasted text into lines to add and lines not in the account format.
 * Blank lines are ignored. Nothing else is checked or changed.
 */
export function planImport(pasted: string): ImportPlan {
  const plan: ImportPlan = { add: [], invalid: [] };
  const text = pasted.startsWith("﻿") ? pasted.slice(1) : pasted;
  splitLines(text).forEach((l, i) => {
    const line = i + 1;
    if (l.text.trim() === "") return;
    const parts = l.text.split(":");
    const reason = problemOf(parts);
    if (reason) plan.invalid.push({ line, text: l.text, reason });
    else plan.add.push({ line, text: l.text, account: toAccount(parts) });
  });
  return plan;
}

/**
 * The file with `lines` appended. The existing text is kept byte for byte; a
 * missing final line ending is added first. New lines use the file's line
 * ending and each ends with one.
 */
export function appendLines(fileText: string, lines: readonly string[]): string {
  if (lines.length === 0) return fileText;
  const eol: Eol = parseAccounts(fileText).eol;
  const body = fileText.startsWith("﻿") ? fileText.slice(1) : fileText;
  const joint = body !== "" && !body.endsWith("\n") ? eol : "";
  return fileText + joint + lines.map((l) => l + eol).join("");
}
