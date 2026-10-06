# Versions, releases and auto-update

## Version number
The version is `major.minor.<commit count>`, for example `0.1.72`. `major.minor` comes from `version` in `src-tauri/tauri.conf.json`, and the patch number is `git rev-list --count HEAD`. That means every commit gets a higher version, and nothing has to be edited by hand.
- `npm run app-version` prints the current version.
- `npm run tauri dev` and `npm run tauri build` stamp it into the app (`scripts/tauri.mjs`). Settings → Updates shows it.
- For a big release, bump `major.minor` in `tauri.conf.json` (for example to `0.2.0`). The patch keeps counting commits, so the version still goes up.
- The `version` in `package.json` and `Cargo.toml` isn't used.

## How clients get updates
- On start, the app fetches `latest.json` from the updater endpoint in `tauri.conf.json` (`plugins.updater.endpoints`). If that version is newer, it asks "Update now / Later" and shows the release notes.
- Update now first goes through the usual Save all / Discard / Cancel prompt for unsaved changes (Cancel postpones the update). It then downloads the installer, checks its signature, installs it and restarts.
- Later keeps an "Update to X" button in Settings → Updates. That section also has "Check for updates".
- A failed check on start (for example when offline) is silent. A manual check shows the error.
- Clients only see a version once it's published with `npm run release`. Commits on their own don't reach them.

## One-time setup
1. **Signing key.** It's at `~/.tauri/make-tools.key`, outside the repo, with no password. It was generated on 2026-10-06, and its public key is in `tauri.conf.json`. **Back it up.** If it's lost, installed apps reject every future update, and clients have to reinstall by hand. Never commit it.
2. **GitHub repo for releases.** Clients download without logging in, so the releases have to be public. If this code repo stays private, make a separate public repo (for example `make-tools-releases`) with at least one commit, such as a README.
3. Put that repo in `tauri.conf.json`: `https://github.com/<owner>/<repo>/releases/latest/download/latest.json`. The release script refuses to run while it's still `OWNER/REPO`.
4. Install the GitHub CLI and log in: `winget install GitHub.cli`, then `gh auth login`.
5. Clients need one manual install of a build that contains the updater (the first release). After that, updates arrive automatically.

## Publishing a release
```
npm run release
npm run release -- --notes "Fixed the proxy shuffle"
npm run release -- --skip-tests
```
The script:
1. Refuses if there are uncommitted changes, or if this version was already released.
2. Runs `npm test`.
3. Builds the signed NSIS installer.
4. Writes `latest.json`.
5. Creates the GitHub release `v<version>` with both files.
6. Tags the commit locally.

Without `--notes`, the notes are the commit subjects since the last release tag. The files are staged in `src-tauri/target/release/upload/`. The pure parts (version, names, `latest.json`) are in `scripts/release-lib.mjs` and are tested in `scripts/release-lib.test.mjs`.
