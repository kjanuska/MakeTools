import { describe, expect, it } from "vitest";
import {
  appVersion,
  assetUrl,
  builtInstallerName,
  installerAssetName,
  latestJson,
  notesFromSubjects,
  releaseRepo,
  tagFor,
} from "./release-lib.mjs";

describe("appVersion", () => {
  it("uses major.minor from the config and the commit count as patch", () => {
    expect(appVersion("0.1.0", 72)).toBe("0.1.72");
    expect(appVersion("2.13.0", 1)).toBe("2.13.1");
  });

  it("ignores the config's own patch number", () => {
    expect(appVersion("0.1.9", 72)).toBe("0.1.72");
  });

  it("goes up with every commit", () => {
    expect(appVersion("0.1.0", 73) > appVersion("0.1.0", 72)).toBe(true);
  });

  it("rejects a malformed config version", () => {
    expect(() => appVersion("0.1", 5)).toThrow(/0\.1\.0/);
    expect(() => appVersion("v0.1.0", 5)).toThrow();
    expect(() => appVersion("0.1.0-beta", 5)).toThrow();
  });

  it("rejects a bad commit count", () => {
    expect(() => appVersion("0.1.0", 0)).toThrow();
    expect(() => appVersion("0.1.0", NaN)).toThrow();
    expect(() => appVersion("0.1.0", 1.5)).toThrow();
  });

  it("stays within the Windows installer limit", () => {
    expect(appVersion("0.1.0", 65535)).toBe("0.1.65535");
    expect(() => appVersion("0.1.0", 65536)).toThrow(/minor/);
  });
});

describe("releaseRepo", () => {
  it("reads owner/repo from the latest.json URL", () => {
    expect(releaseRepo("https://github.com/kipras/make-tools-releases/releases/latest/download/latest.json")).toBe(
      "kipras/make-tools-releases",
    );
  });

  it("refuses the placeholder", () => {
    expect(() => releaseRepo("https://github.com/OWNER/REPO/releases/latest/download/latest.json")).toThrow(
      /Set the GitHub repo/,
    );
  });

  it("refuses other URLs and a missing endpoint", () => {
    expect(() => releaseRepo("https://example.com/latest.json")).toThrow();
    expect(() => releaseRepo("https://github.com/a/b/releases/download/v1/latest.json")).toThrow();
    expect(() => releaseRepo(undefined)).toThrow();
  });
});

describe("names and URLs", () => {
  it("tags as v<version>", () => {
    expect(tagFor("0.1.72")).toBe("v0.1.72");
  });

  it("uploads the installer under a name without spaces", () => {
    expect(installerAssetName("0.1.72")).toBe("make-tools_0.1.72_x64-setup.exe");
    expect(installerAssetName("0.1.72")).not.toMatch(/\s/);
  });

  it("finds the installer tauri build writes", () => {
    expect(builtInstallerName("Make Tools", "0.1.72")).toBe("Make Tools_0.1.72_x64-setup.exe");
  });

  it("points at the release's download", () => {
    expect(assetUrl("a/b", "0.1.72", "x.exe")).toBe("https://github.com/a/b/releases/download/v0.1.72/x.exe");
  });
});

describe("notesFromSubjects", () => {
  it("lists commit subjects as bullets", () => {
    expect(notesFromSubjects(["Fix A", "Add B"])).toBe("- Fix A\n- Add B");
  });

  it("drops blank lines", () => {
    expect(notesFromSubjects(["", "Fix A", "  "])).toBe("- Fix A");
  });

  it("has a fallback when there are no commits", () => {
    expect(notesFromSubjects([""])).toBe("Small fixes.");
  });
});

describe("latestJson", () => {
  it("writes the updater's format for Windows", () => {
    const json = latestJson({
      version: "0.1.72",
      notes: "- Fix A",
      pubDate: "2026-10-06T12:00:00.000Z",
      signature: "c2lnbmF0dXJl\n",
      url: "https://github.com/a/b/releases/download/v0.1.72/make-tools_0.1.72_x64-setup.exe",
    });
    expect(JSON.parse(json)).toEqual({
      version: "0.1.72",
      notes: "- Fix A",
      pub_date: "2026-10-06T12:00:00.000Z",
      platforms: {
        "windows-x86_64": {
          signature: "c2lnbmF0dXJl",
          url: "https://github.com/a/b/releases/download/v0.1.72/make-tools_0.1.72_x64-setup.exe",
        },
      },
    });
    expect(json.endsWith("}\n")).toBe(true);
  });
});
