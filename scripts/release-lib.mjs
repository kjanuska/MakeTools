// Pure helpers for versioning and releases (tested in release-lib.test.mjs).

/**
 * The app version: major.minor from tauri.conf.json, patch = number of
 * commits, so every commit gets a higher version.
 */
export function appVersion(configVersion, commitCount) {
  const m = /^(\d+)\.(\d+)\.\d+$/.exec(configVersion);
  if (!m) throw new Error(`tauri.conf.json version must look like 0.1.0, got "${configVersion}"`);
  if (!Number.isInteger(commitCount) || commitCount < 1) throw new Error(`bad commit count: ${commitCount}`);
  // Windows installers allow at most 65535 in the last part.
  if (commitCount > 65535) throw new Error(`commit count ${commitCount} is over 65535; bump the minor version`);
  return `${m[1]}.${m[2]}.${commitCount}`;
}

/** "owner/repo" from the updater endpoint in tauri.conf.json. */
export function releaseRepo(endpoint) {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/latest\/download\/latest\.json$/.exec(endpoint ?? "");
  if (!m) throw new Error(`updater endpoint is not a GitHub latest.json URL: ${endpoint}`);
  if (m[1] === "OWNER" || m[2] === "REPO") {
    throw new Error("Set the GitHub repo in src-tauri/tauri.conf.json (plugins.updater.endpoints) first.");
  }
  return `${m[1]}/${m[2]}`;
}

export function tagFor(version) {
  return `v${version}`;
}

/** Installer name on the release (no spaces: GitHub turns them into dots). */
export function installerAssetName(version) {
  return `make-tools_${version}_x64-setup.exe`;
}

/** The NSIS installer `tauri build` writes, relative to the bundle folder. */
export function builtInstallerName(productName, version) {
  return `${productName}_${version}_x64-setup.exe`;
}

export function assetUrl(repo, version, name) {
  return `https://github.com/${repo}/releases/download/${tagFor(version)}/${name}`;
}

/** Release notes from commit subjects, newest first. */
export function notesFromSubjects(subjects) {
  const lines = subjects.map((s) => s.trim()).filter(Boolean);
  return lines.length ? lines.map((s) => `- ${s}`).join("\n") : "Small fixes.";
}

/** The latest.json the app's updater reads. */
export function latestJson({ version, notes, pubDate, signature, url }) {
  return (
    JSON.stringify(
      {
        version,
        notes,
        pub_date: pubDate,
        platforms: { "windows-x86_64": { signature: signature.trim(), url } },
      },
      null,
      2,
    ) + "\n"
  );
}
