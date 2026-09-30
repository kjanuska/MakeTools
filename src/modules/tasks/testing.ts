// Test helpers for the tasks UI: a fake Makebot folder behind the Tauri IPC mock.
import { mockIPC } from "@tauri-apps/api/mocks";
import { PROFILE_HEADER } from "../../lib/formats/profiles";
import { TASK_HEADER } from "../../lib/formats/tasks";
import type { FileEntry } from "../../lib/fs";

export const ROOT = "C:\\Makebot";
export const H = TASK_HEADER;
export const profile = (name: string) =>
  `${name},Jane,Doe,jane${name}@example.com,101 Main St,,Springfield,IL,62701,US,2175550100,4111111111111111,01,28,123`;

export type T = {
  group?: string;
  name?: string;
  proxy?: string;
  account?: string;
  input?: string;
  size?: string;
  color?: string;
  site?: string;
  mode?: string;
  qty?: string;
  delay?: string;
};
export const task = (o: T = {}) =>
  [
    o.group ?? "25",
    o.name ?? "ALL",
    o.proxy ?? "wealth",
    o.account ?? "example",
    o.input ?? "box logo -tee",
    o.size ?? "random",
    o.color ?? "random",
    o.site ?? "kith.com",
    o.mode ?? "preload",
    o.qty ?? "1",
    o.delay ?? "3000",
  ].join(",");
export const taskFile = (rows: string[]) => `${H}\n${rows.map((r) => `${r}\n`).join("")}`;

/** A Makebot folder: profile groups 25 (3 profiles) and 5 (1), proxies, accounts, task files. */
export function backend(tasks: Record<string, string>, extra: Record<string, string> = {}) {
  const disk = new Map<string, string>([
    [`${ROOT}\\profile\\25.csv`, `${PROFILE_HEADER}\r\n${profile("1")}\r\n${profile("2")}\r\n${profile("3")}\r\n`],
    [`${ROOT}\\profile\\5.csv`, `${PROFILE_HEADER}\r\n${profile("7")}\r\n`],
    [`${ROOT}\\proxy\\wealth.txt`, "1.2.3.4:80\n"],
    [`${ROOT}\\proxy\\us.txt`, "5.6.7.8:80\n"],
    [`${ROOT}\\account\\example.txt`, "a:b\n"],
    ...Object.entries(tasks).map(([n, t]) => [`${ROOT}\\task\\${n}`, t] as [string, string]),
    ...Object.entries(extra),
  ]);
  const calls: { cmd: string; args: Record<string, unknown> }[] = [];
  mockIPC((cmd, a) => {
    const args = a as Record<string, string>;
    calls.push({ cmd, args });
    switch (cmd) {
      case "list_files":
        return [...disk.keys()]
          .filter((p) => p.startsWith(args.dir + "\\") && p.endsWith("." + args.extension))
          .sort()
          .map((path): FileEntry => ({ name: path.slice(args.dir.length + 1), path, size: disk.get(path)!.length, modifiedMs: 1 }));
      case "read_text":
        return { text: disk.get(args.path)!, lineEnding: "lf", hasBom: false };
      case "save_text":
        disk.set(args.path, args.text);
        return null;
      case "list_backups":
        return [];
      case "create_file":
        if (disk.has(args.path)) throw "The file exists. (os error 80)";
        disk.set(args.path, args.text);
        return null;
      default:
        throw `unexpected command ${cmd}`;
    }
  });
  const saves = () => calls.filter((c) => c.cmd === "save_text").map((c) => c.args);
  return { disk, saves };
}
