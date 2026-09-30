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
  /** A blank line or one that isn't in the account format. Shown, never changed. */
  | { kind: "raw"; line: number; text: string };

export interface AccountsDoc {
  bom: boolean;
  lines: AccountLine[];
  /** Ending used for appended lines: the file's most common one, CRLF on a tie or for an empty file. */
  eol: "\n" | "\r\n";
  trailingNewline: boolean;
}

/** Why a line isn't a valid account, or null if it is. `parts` is the line split on ":". */
function problemOf(parts: string[]): string | null {
  if (![2, 4, 6].includes(parts.length)) {
    return `Expected email:password, optionally followed by :host:port and :user:pass (found ${parts.length} ${parts.length === 1 ? "part" : "parts"}).`;
  }
  const [email, password, host, port, user, pass] = parts;
  if (!email.includes("@")) return "The email has no @.";
  if (/\s/.test(email)) return "The email contains a space.";
  if (password === "") return "The password is empty.";
  if (parts.length >= 4) {
    if (host === "") return "The proxy host is empty.";
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) return "The proxy port must be a number from 1 to 65535.";
  }
  if (parts.length === 6 && (user === "" || pass === "")) return "The proxy user and password can't be empty.";
  return null;
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

/** Emails are compared without case. */
export const emailKey = (email: string) => email.toLowerCase();

export interface ImportPlan {
  /** Lines to append, trimmed, in the order pasted. */
  add: { line: number; text: string; account: Account }[];
  /** Emails already in the file, or earlier in the paste. Skipped. */
  duplicates: { line: number; email: string; inFile: boolean }[];
  invalid: { line: number; text: string; reason: string }[];
}

/**
 * Sorts pasted text into accounts to add, duplicates and invalid lines.
 * Blank lines are ignored; spaces around a line are trimmed.
 */
export function planImport(pasted: string, existingEmails: Iterable<string>): ImportPlan {
  const inFile = new Set([...existingEmails].map(emailKey));
  const seen = new Set<string>();
  const plan: ImportPlan = { add: [], duplicates: [], invalid: [] };
  const text = pasted.startsWith("﻿") ? pasted.slice(1) : pasted;
  splitLines(text).forEach((l, i) => {
    const line = i + 1;
    const t = l.text.trim();
    if (t === "") return;
    const parts = t.split(":");
    const reason = problemOf(parts);
    if (reason) {
      plan.invalid.push({ line, text: t, reason });
      return;
    }
    const key = emailKey(parts[0]);
    if (inFile.has(key) || seen.has(key)) {
      plan.duplicates.push({ line, email: parts[0], inFile: inFile.has(key) });
      return;
    }
    seen.add(key);
    plan.add.push({ line, text: t, account: toAccount(parts) });
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
