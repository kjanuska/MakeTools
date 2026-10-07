/// <reference types="node" />
// The app's own gear icon is used everywhere: the window/taskbar/exe icons and
// the installer come from src-tauri/icons (generated from icons/source/app-icon.svg
// with `npx tauri icon`), and the page favicon is the same SVG.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file));
const source = "src-tauri/icons/source/app-icon.svg";

describe("app icon", () => {
  const conf = JSON.parse(read("src-tauri/tauri.conf.json").toString("utf8"));

  it("bundle icons and the installer icon exist", () => {
    const icons: string[] = [...conf.bundle.icon, conf.bundle.windows.nsis.installerIcon];
    expect(conf.bundle.windows.nsis.installerIcon).toBe("icons/icon.ico");
    for (const icon of icons) expect(fs.existsSync(path.join(root, "src-tauri", icon))).toBe(true);
  });

  it("icon.ico is a real multi-size icon, including 16, 32 and 256 px", () => {
    const ico = read("src-tauri/icons/icon.ico");
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    const count = ico.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => ico[6 + i * 16] || 256);
    expect(sizes).toEqual(expect.arrayContaining([16, 32, 256]));
  });

  it("the favicon is the same SVG the icons are generated from", () => {
    const html = read("index.html").toString("utf8");
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/app-icon.svg" />');
    expect(html).toContain("<title>Make Tools</title>");
    expect(read("public/app-icon.svg").equals(read(source))).toBe(true);
  });

  it("no template icons are left", () => {
    expect(read("index.html").toString("utf8")).not.toMatch(/vite\.svg|tauri\.svg/);
  });
});
