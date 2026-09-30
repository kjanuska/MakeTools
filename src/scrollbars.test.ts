/// <reference types="node" />
// The app-wide scrollbar styles are loaded, cover light and dark, and nothing
// switches them off (in Chromium, `scrollbar-color`/`scrollbar-width` on an
// element make it ignore the ::-webkit-scrollbar styles).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = path.resolve(__dirname);
const read = (file: string) => fs.readFileSync(path.join(src, file), "utf8");

function filesUnder(dir: string, ext: RegExp): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return filesUnder(full, ext);
    return ext.test(e.name) ? [full] : [];
  });
}

describe("scrollbar styles", () => {
  it("are loaded for the whole app", () => {
    expect(read("main.tsx")).toContain('import "./scrollbars.css";');
  });

  it("style the thumb and track, with colors for light and dark", () => {
    const css = read("scrollbars.css");
    for (const part of ["::-webkit-scrollbar {", "::-webkit-scrollbar-thumb {", "::-webkit-scrollbar-track"]) {
      expect(css).toContain(part);
    }
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)[\s\S]*--scrollbar-thumb:/);
    expect(css).toContain("background: var(--scrollbar-thumb);");
  });

  it("aren't switched off by scrollbar-color or scrollbar-width anywhere", () => {
    const offenders = filesUnder(src, /\.(css|tsx)$/).filter((f) => /scrollbar-(color|width)\s*:/.test(fs.readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(src, f))).toEqual([]);
  });
});
