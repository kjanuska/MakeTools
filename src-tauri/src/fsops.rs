//! File I/O for Makebot data files: listing, exact reads, atomic saves with
//! backups, backup retention and restore. No Tauri types here so everything
//! can be unit-tested against temporary folders.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Backups older than this are deleted.
pub const RETENTION_MS: u64 = 7 * 24 * 60 * 60 * 1000;

const BACKUP_EXT: &str = "bak";
const BACKUP_ID_LEN: usize = 15;
const SOURCE_FILE: &str = "source.txt";

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Serialize, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum LineEnding {
    /// No line breaks at all.
    None,
    Lf,
    Crlf,
    /// Both CRLF and bare LF occur.
    Mixed,
}

pub fn detect_line_ending(text: &str) -> LineEnding {
    let bytes = text.as_bytes();
    let (mut lf, mut crlf) = (0usize, 0usize);
    for (i, &b) in bytes.iter().enumerate() {
        if b == b'\n' {
            if i > 0 && bytes[i - 1] == b'\r' {
                crlf += 1;
            } else {
                lf += 1;
            }
        }
    }
    match (lf, crlf) {
        (0, 0) => LineEnding::None,
        (_, 0) => LineEnding::Lf,
        (0, _) => LineEnding::Crlf,
        _ => LineEnding::Mixed,
    }
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub modified_ms: u64,
}

/// Files directly inside `dir` whose extension matches `extension`
/// (case-insensitive, without the dot), sorted by name.
pub fn list_files(dir: &Path, extension: &str) -> io::Result<Vec<FileEntry>> {
    let mut out = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let meta = entry.metadata()?;
        if !meta.is_file() {
            continue;
        }
        let path = entry.path();
        let ext_matches = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case(extension));
        if !ext_matches {
            continue;
        }
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push(FileEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: path.to_string_lossy().into_owned(),
            size: meta.len(),
            modified_ms,
        });
    }
    out.sort_by_key(|f| f.name.to_lowercase());
    Ok(out)
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    /// The file's exact contents, including a BOM if present.
    pub text: String,
    pub line_ending: LineEnding,
    pub has_bom: bool,
}

/// Reads a file verbatim. Refuses files that are not valid UTF-8 rather than
/// decoding lossily, since saving a lossy decode would corrupt the file.
pub fn read_text(path: &Path) -> io::Result<TextFile> {
    let bytes = fs::read(path)?;
    let has_bom = bytes.starts_with(&[0xEF, 0xBB, 0xBF]);
    let text = String::from_utf8(bytes).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "file is not valid UTF-8; not opened to avoid corrupting it",
        )
    })?;
    Ok(TextFile {
        line_ending: detect_line_ending(&text),
        text,
        has_bom,
    })
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub id: String,
    pub created_ms: u64,
    pub size: u64,
}

/// Backup store. Layout: `<root>/<hash of source path>/<created ms, 15 digits>.bak`,
/// plus `source.txt` holding the original path.
pub struct Backups {
    root: PathBuf,
}

impl Backups {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    fn dir_for(&self, file: &Path) -> io::Result<PathBuf> {
        let abs = std::path::absolute(file)?;
        let mut key = abs.to_string_lossy().into_owned();
        if cfg!(windows) {
            // Windows paths are case-insensitive; keep one history per file.
            key = key.to_lowercase();
        }
        let hash = Sha256::digest(key.as_bytes());
        let hex: String = hash[..16].iter().map(|b| format!("{b:02x}")).collect();
        Ok(self.root.join(hex))
    }

    /// Stores `contents` as a backup of `file`. If a backup with the same
    /// timestamp exists, the timestamp is bumped so none is overwritten.
    pub fn create(&self, file: &Path, contents: &[u8], now_ms: u64) -> io::Result<BackupEntry> {
        let dir = self.dir_for(file)?;
        fs::create_dir_all(&dir)?;
        fs::write(
            dir.join(SOURCE_FILE),
            std::path::absolute(file)?.to_string_lossy().as_bytes(),
        )?;
        let mut ms = now_ms;
        let path = loop {
            let p = dir.join(backup_file_name(ms));
            if !p.exists() {
                break p;
            }
            ms += 1;
        };
        fs::write(&path, contents)?;
        Ok(BackupEntry {
            id: backup_id(ms),
            created_ms: ms,
            size: contents.len() as u64,
        })
    }

    /// Backups of `file`, newest first.
    pub fn list(&self, file: &Path) -> io::Result<Vec<BackupEntry>> {
        let dir = self.dir_for(file)?;
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e),
        };
        let mut out = Vec::new();
        for entry in entries {
            let entry = entry?;
            if let Some(ms) = parse_backup_name(&entry.file_name().to_string_lossy()) {
                out.push(BackupEntry {
                    id: backup_id(ms),
                    created_ms: ms,
                    size: entry.metadata()?.len(),
                });
            }
        }
        out.sort_by(|a, b| b.created_ms.cmp(&a.created_ms));
        Ok(out)
    }

    pub fn read(&self, file: &Path, id: &str) -> io::Result<Vec<u8>> {
        if !is_valid_id(id) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid backup id"));
        }
        fs::read(self.dir_for(file)?.join(format!("{id}.{BACKUP_EXT}")))
    }

    /// Deletes backups at least `RETENTION_MS` old, and folders left empty.
    /// Returns how many backups were deleted.
    pub fn prune(&self, now_ms: u64) -> io::Result<usize> {
        let dirs = match fs::read_dir(&self.root) {
            Ok(d) => d,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(0),
            Err(e) => return Err(e),
        };
        let mut deleted = 0;
        for dir in dirs {
            let dir = dir?;
            if !dir.file_type()?.is_dir() {
                continue;
            }
            let mut remaining = 0;
            for entry in fs::read_dir(dir.path())? {
                let entry = entry?;
                if let Some(ms) = parse_backup_name(&entry.file_name().to_string_lossy()) {
                    if ms.saturating_add(RETENTION_MS) <= now_ms {
                        fs::remove_file(entry.path())?;
                        deleted += 1;
                    } else {
                        remaining += 1;
                    }
                }
            }
            if remaining == 0 {
                fs::remove_dir_all(dir.path())?;
            }
        }
        Ok(deleted)
    }
}

fn backup_id(ms: u64) -> String {
    format!("{ms:0width$}", width = BACKUP_ID_LEN)
}

fn backup_file_name(ms: u64) -> String {
    format!("{}.{BACKUP_EXT}", backup_id(ms))
}

fn is_valid_id(id: &str) -> bool {
    id.len() == BACKUP_ID_LEN && id.bytes().all(|b| b.is_ascii_digit())
}

fn parse_backup_name(name: &str) -> Option<u64> {
    let id = name.strip_suffix(&format!(".{BACKUP_EXT}"))?;
    if !is_valid_id(id) {
        return None;
    }
    id.parse().ok()
}

/// Writes `data` to a temp file next to `path`, flushes it to disk, then
/// renames it over `path`, so a crash never leaves a half-written file.
fn write_atomic(path: &Path, data: &[u8]) -> io::Result<()> {
    let dir = path.parent().unwrap_or(Path::new("."));
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no file name"))?;
    let tmp = dir.join(format!(".{}.make-tools.tmp", name.to_string_lossy()));
    let result = (|| {
        let mut f = File::create(&tmp)?;
        f.write_all(data)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// Saves `data` to `path` exactly as given: backs up the current file (if
/// any), writes atomically, then prunes old backups.
pub fn save_bytes(backups: &Backups, path: &Path, data: &[u8], now_ms: u64) -> io::Result<()> {
    match fs::read(path) {
        Ok(current) => {
            backups.create(path, &current, now_ms)?;
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(e),
    }
    write_atomic(path, data)?;
    // The save already succeeded; a failed cleanup is retried on the next one.
    let _ = backups.prune(now_ms);
    Ok(())
}

/// Replaces `path` with backup `id`. Goes through `save_bytes`, so the
/// current contents are backed up first and the restore can be undone.
pub fn restore_backup(backups: &Backups, path: &Path, id: &str, now_ms: u64) -> io::Result<()> {
    let data = backups.read(path, id)?;
    save_bytes(backups, path, &data, now_ms)
}

/// Creates `path` containing exactly `data`. Fails if anything already
/// exists there, so it can never overwrite a file.
pub fn create_file(path: &Path, data: &[u8]) -> io::Result<()> {
    let mut f = OpenOptions::new().write(true).create_new(true).open(path)?;
    let result = f.write_all(data).and_then(|_| f.sync_all());
    if result.is_err() {
        drop(f);
        let _ = fs::remove_file(path);
    }
    result
}

fn same_path(a: &Path, b: &Path) -> io::Result<bool> {
    let (a, b) = (std::path::absolute(a)?, std::path::absolute(b)?);
    let (a, b) = (a.to_string_lossy(), b.to_string_lossy());
    Ok(if cfg!(windows) { a.to_lowercase() == b.to_lowercase() } else { a == b })
}

/// Renames `from` to `to` after backing up `from` (under its old path).
/// Refuses to replace an existing file, except for a case-only rename of
/// the same file on Windows.
pub fn rename_file(backups: &Backups, from: &Path, to: &Path, now_ms: u64) -> io::Result<()> {
    let current = fs::read(from)?;
    if fs::symlink_metadata(to).is_ok() && !same_path(from, to)? {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "a file with that name already exists",
        ));
    }
    backups.create(from, &current, now_ms)?;
    fs::rename(from, to)
}

/// Deletes `path` after backing it up.
pub fn delete_file(backups: &Backups, path: &Path, now_ms: u64) -> io::Result<()> {
    let current = fs::read(path)?;
    backups.create(path, &current, now_ms)?;
    fs::remove_file(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const DAY: u64 = 24 * 60 * 60 * 1000;
    const T0: u64 = 1_790_000_000_000;

    struct Env {
        _tmp: TempDir,
        data: PathBuf,
        backups: Backups,
    }

    fn env() -> Env {
        let tmp = TempDir::new().unwrap();
        let data = tmp.path().join("data");
        fs::create_dir(&data).unwrap();
        let backups = Backups::new(tmp.path().join("backups"));
        Env { _tmp: tmp, data, backups }
    }

    // ---- line endings ----

    #[test]
    fn detects_line_endings() {
        assert_eq!(detect_line_ending(""), LineEnding::None);
        assert_eq!(detect_line_ending("a:b"), LineEnding::None);
        assert_eq!(detect_line_ending("a\nb\n"), LineEnding::Lf);
        assert_eq!(detect_line_ending("a\nb"), LineEnding::Lf);
        assert_eq!(detect_line_ending("a\r\nb\r\n"), LineEnding::Crlf);
        assert_eq!(detect_line_ending("\r\n"), LineEnding::Crlf);
        assert_eq!(detect_line_ending("\n"), LineEnding::Lf);
        assert_eq!(detect_line_ending("a\r\nb\n"), LineEnding::Mixed);
        assert_eq!(detect_line_ending("a\nb\r\n"), LineEnding::Mixed);
        // A lone CR is not a line break.
        assert_eq!(detect_line_ending("a\rb"), LineEnding::None);
        assert_eq!(detect_line_ending("a\r\rb\r\n"), LineEnding::Crlf);
    }

    // ---- list_files ----

    #[test]
    fn lists_only_matching_files_sorted() {
        let e = env();
        fs::write(e.data.join("b.csv"), "12345").unwrap();
        fs::write(e.data.join("A.CSV"), "").unwrap();
        fs::write(e.data.join("c.txt"), "").unwrap();
        fs::write(e.data.join("b.csvcom.dropbox.attrs"), "").unwrap();
        fs::write(e.data.join("noext"), "").unwrap();
        fs::create_dir(e.data.join("dir.csv")).unwrap();
        let files = list_files(&e.data, "csv").unwrap();
        let names: Vec<_> = files.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["A.CSV", "b.csv"]);
        assert_eq!(files[1].size, 5);
        assert_eq!(PathBuf::from(&files[1].path), e.data.join("b.csv"));
        assert!(files[1].modified_ms > 0);
    }

    #[test]
    fn list_files_errors_on_missing_dir() {
        let e = env();
        assert!(list_files(&e.data.join("nope"), "csv").is_err());
    }

    // ---- read_text ----

    #[test]
    fn reads_text_verbatim() {
        let e = env();
        let p = e.data.join("f.csv");
        let content = "h1,h2\r\nä,\"x,y\"\r\n\r\n";
        fs::write(&p, content).unwrap();
        let t = read_text(&p).unwrap();
        assert_eq!(t.text, content);
        assert_eq!(t.line_ending, LineEnding::Crlf);
        assert!(!t.has_bom);
    }

    #[test]
    fn keeps_bom_in_text() {
        let e = env();
        let p = e.data.join("f.csv");
        fs::write(&p, b"\xEF\xBB\xBFa\nb").unwrap();
        let t = read_text(&p).unwrap();
        assert!(t.has_bom);
        assert_eq!(t.text.as_bytes(), b"\xEF\xBB\xBFa\nb");
    }

    #[test]
    fn refuses_invalid_utf8() {
        let e = env();
        let p = e.data.join("f.csv");
        fs::write(&p, b"a\xFFb").unwrap();
        let err = read_text(&p).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn read_then_save_roundtrips_bytes_exactly() {
        let e = env();
        let samples: [&[u8]; 7] = [
            b"",
            b"a:b:c",
            b"a:b\r\nc:d\r\n",
            b"a:b\nc:d\n",
            b"a\r\nb\nc\r\n\n\r\n",
            b"\xEF\xBB\xBFh,1\r\n\"q,\"\"x\"\"\",\xC3\xA4\r\n",
            b"  trailing space \t\r\n\r\n\r\n",
        ];
        for (i, s) in samples.iter().enumerate() {
            let p = e.data.join(format!("f{i}.csv"));
            fs::write(&p, s).unwrap();
            let t = read_text(&p).unwrap();
            save_bytes(&e.backups, &p, t.text.as_bytes(), T0).unwrap();
            assert_eq!(fs::read(&p).unwrap(), *s, "sample {i}");
        }
    }

    // ---- save ----

    #[test]
    fn save_writes_exact_bytes_and_backs_up_previous() {
        let e = env();
        let p = e.data.join("f.txt");
        fs::write(&p, b"old\r\n").unwrap();
        save_bytes(&e.backups, &p, b"new\r\n", T0).unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"new\r\n");
        let list = e.backups.list(&p).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].created_ms, T0);
        assert_eq!(list[0].size, 5);
        assert_eq!(e.backups.read(&p, &list[0].id).unwrap(), b"old\r\n");
    }

    #[test]
    fn save_makes_backup_every_time_even_if_unchanged() {
        let e = env();
        let p = e.data.join("f.txt");
        fs::write(&p, b"same").unwrap();
        for i in 0..3 {
            save_bytes(&e.backups, &p, b"same", T0 + i).unwrap();
        }
        assert_eq!(e.backups.list(&p).unwrap().len(), 3);
    }

    #[test]
    fn save_new_file_creates_it_without_backup() {
        let e = env();
        let p = e.data.join("new.csv");
        save_bytes(&e.backups, &p, b"x", T0).unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"x");
        assert!(e.backups.list(&p).unwrap().is_empty());
    }

    #[test]
    fn save_leaves_no_temp_file() {
        let e = env();
        let p = e.data.join("f.txt");
        fs::write(&p, b"a").unwrap();
        save_bytes(&e.backups, &p, b"b", T0).unwrap();
        let names: Vec<_> = fs::read_dir(&e.data)
            .unwrap()
            .map(|d| d.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["f.txt"]);
    }

    #[test]
    fn failed_save_keeps_original_and_cleans_temp() {
        let e = env();
        // Target is a directory, so the final rename fails.
        let p = e.data.join("f.txt");
        fs::create_dir(&p).unwrap();
        fs::write(p.join("inner"), b"keep").unwrap();
        assert!(write_atomic(&p, b"x").is_err());
        assert_eq!(fs::read(p.join("inner")).unwrap(), b"keep");
        assert!(!e.data.join(".f.txt.make-tools.tmp").exists());
    }

    #[test]
    fn save_errors_when_folder_missing() {
        let e = env();
        let p = e.data.join("missing").join("f.txt");
        assert!(save_bytes(&e.backups, &p, b"x", T0).is_err());
    }

    // ---- backups ----

    #[test]
    fn same_millisecond_backups_do_not_overwrite() {
        let e = env();
        let p = e.data.join("f.txt");
        e.backups.create(&p, b"one", T0).unwrap();
        e.backups.create(&p, b"two", T0).unwrap();
        let list = e.backups.list(&p).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].created_ms, T0 + 1);
        assert_eq!(e.backups.read(&p, &list[0].id).unwrap(), b"two");
        assert_eq!(e.backups.read(&p, &list[1].id).unwrap(), b"one");
    }

    #[test]
    fn backups_are_listed_newest_first() {
        let e = env();
        let p = e.data.join("f.txt");
        for ms in [T0 + 5, T0, T0 + 9] {
            e.backups.create(&p, b"x", ms).unwrap();
        }
        let ms: Vec<_> = e.backups.list(&p).unwrap().iter().map(|b| b.created_ms).collect();
        assert_eq!(ms, [T0 + 9, T0 + 5, T0]);
    }

    #[test]
    fn backups_are_separate_per_file_path() {
        let e = env();
        fs::create_dir(e.data.join("sub")).unwrap();
        let a = e.data.join("f.txt");
        let b = e.data.join("sub").join("f.txt");
        e.backups.create(&a, b"a", T0).unwrap();
        e.backups.create(&b, b"b", T0).unwrap();
        let la = e.backups.list(&a).unwrap();
        let lb = e.backups.list(&b).unwrap();
        assert_eq!(la.len(), 1);
        assert_eq!(lb.len(), 1);
        assert_eq!(e.backups.read(&a, &la[0].id).unwrap(), b"a");
        assert_eq!(e.backups.read(&b, &lb[0].id).unwrap(), b"b");
    }

    #[cfg(windows)]
    #[test]
    fn backups_ignore_path_case_on_windows() {
        let e = env();
        let p = e.data.join("f.txt");
        e.backups.create(&p, b"x", T0).unwrap();
        let upper = PathBuf::from(p.to_string_lossy().to_uppercase());
        assert_eq!(e.backups.list(&upper).unwrap().len(), 1);
    }

    #[test]
    fn backup_records_source_path() {
        let e = env();
        let p = e.data.join("f.txt");
        e.backups.create(&p, b"x", T0).unwrap();
        let dir = e.backups.dir_for(&p).unwrap();
        let src = fs::read_to_string(dir.join(SOURCE_FILE)).unwrap();
        assert_eq!(PathBuf::from(src), std::path::absolute(&p).unwrap());
    }

    #[test]
    fn list_backups_empty_when_none() {
        let e = env();
        assert!(e.backups.list(&e.data.join("f.txt")).unwrap().is_empty());
    }

    #[test]
    fn read_rejects_bad_ids() {
        let e = env();
        let p = e.data.join("f.txt");
        e.backups.create(&p, b"x", T0).unwrap();
        for id in ["", "123", "..\\..\\x", "../0000000000000", "00000000000000a", "0001790000000000"] {
            let err = e.backups.read(&p, id).unwrap_err();
            assert_eq!(err.kind(), io::ErrorKind::InvalidInput, "id {id:?}");
        }
        // Well-formed but nonexistent.
        assert_eq!(
            e.backups.read(&p, "000000000000001").unwrap_err().kind(),
            io::ErrorKind::NotFound
        );
    }

    // ---- retention ----

    #[test]
    fn prune_deletes_backups_seven_days_or_older() {
        let e = env();
        let p = e.data.join("f.txt");
        e.backups.create(&p, b"old", T0).unwrap();
        e.backups.create(&p, b"edge", T0 + 1).unwrap();
        e.backups.create(&p, b"new", T0 + 2 * DAY).unwrap();
        // Exactly 7 days after T0: T0 goes, T0+1 is 1ms short of 7 days.
        let deleted = e.backups.prune(T0 + 7 * DAY).unwrap();
        assert_eq!(deleted, 1);
        let ms: Vec<_> = e.backups.list(&p).unwrap().iter().map(|b| b.created_ms).collect();
        assert_eq!(ms, [T0 + 2 * DAY, T0 + 1]);
    }

    #[test]
    fn prune_removes_empty_backup_folders() {
        let e = env();
        let p = e.data.join("f.txt");
        e.backups.create(&p, b"x", T0).unwrap();
        e.backups.prune(T0 + 8 * DAY).unwrap();
        assert!(!e.backups.dir_for(&p).unwrap().exists());
        assert!(e.backups.list(&p).unwrap().is_empty());
    }

    #[test]
    fn prune_ignores_unrelated_files() {
        let e = env();
        let p = e.data.join("f.txt");
        e.backups.create(&p, b"x", T0 + 7 * DAY).unwrap();
        let dir = e.backups.dir_for(&p).unwrap();
        fs::write(dir.join("notes.bak"), b"").unwrap();
        fs::write(dir.join("000000000000001.txt"), b"").unwrap();
        fs::write(e.backups.root.join("stray-file"), b"").unwrap();
        assert_eq!(e.backups.prune(T0 + 7 * DAY).unwrap(), 0);
        assert!(dir.join("notes.bak").exists());
        assert!(dir.join("000000000000001.txt").exists());
    }

    #[test]
    fn prune_with_no_backup_root_is_ok() {
        let e = env();
        assert_eq!(e.backups.prune(T0).unwrap(), 0);
    }

    #[test]
    fn save_prunes_old_backups() {
        let e = env();
        let p = e.data.join("f.txt");
        let other = e.data.join("other.txt");
        e.backups.create(&other, b"old", T0).unwrap();
        fs::write(&p, b"a").unwrap();
        save_bytes(&e.backups, &p, b"b", T0 + 7 * DAY).unwrap();
        assert!(e.backups.list(&other).unwrap().is_empty());
        assert_eq!(e.backups.list(&p).unwrap().len(), 1);
    }

    // ---- restore ----

    #[test]
    fn restore_writes_backup_and_backs_up_current() {
        let e = env();
        let p = e.data.join("f.txt");
        fs::write(&p, b"v1\r\n").unwrap();
        save_bytes(&e.backups, &p, b"v2\n", T0).unwrap();
        let v1_id = e.backups.list(&p).unwrap()[0].id.clone();

        restore_backup(&e.backups, &p, &v1_id, T0 + 10).unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"v1\r\n");

        // The restore itself is undoable: v2 was backed up.
        let list = e.backups.list(&p).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].created_ms, T0 + 10);
        assert_eq!(e.backups.read(&p, &list[0].id).unwrap(), b"v2\n");
        restore_backup(&e.backups, &p, &list[0].id, T0 + 20).unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"v2\n");
    }

    #[test]
    fn restore_is_byte_exact_for_non_utf8_backup() {
        let e = env();
        let p = e.data.join("f.txt");
        let bytes = b"\xEF\xBB\xBFa\xFF\r\n";
        let b = e.backups.create(&p, bytes, T0).unwrap();
        restore_backup(&e.backups, &p, &b.id, T0 + 1).unwrap();
        assert_eq!(fs::read(&p).unwrap(), bytes);
    }

    #[test]
    fn restore_unknown_backup_leaves_file_untouched() {
        let e = env();
        let p = e.data.join("f.txt");
        fs::write(&p, b"keep").unwrap();
        assert!(restore_backup(&e.backups, &p, "000000000000001", T0).is_err());
        assert_eq!(fs::read(&p).unwrap(), b"keep");
        assert!(e.backups.list(&p).unwrap().is_empty());
    }

    // ---- create_file ----

    #[test]
    fn create_writes_exact_bytes() {
        let e = env();
        let p = e.data.join("new.csv");
        create_file(&p, b"h1,h2\r\n").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"h1,h2\r\n");
        assert!(e.backups.list(&p).unwrap().is_empty());
    }

    #[test]
    fn create_never_overwrites() {
        let e = env();
        let p = e.data.join("f.csv");
        fs::write(&p, "keep").unwrap();
        let err = create_file(&p, b"new").unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(&p).unwrap(), b"keep");
    }

    #[test]
    fn create_never_overwrites_different_case() {
        let e = env();
        fs::write(e.data.join("F.csv"), "keep").unwrap();
        let result = create_file(&e.data.join("f.csv"), b"new");
        if cfg!(windows) {
            assert_eq!(result.unwrap_err().kind(), io::ErrorKind::AlreadyExists);
        }
        assert_eq!(fs::read(e.data.join("F.csv")).unwrap(), b"keep");
    }

    #[test]
    fn create_errors_when_folder_missing() {
        let e = env();
        assert!(create_file(&e.data.join("nope").join("f.csv"), b"x").is_err());
    }

    // ---- rename_file ----

    #[test]
    fn rename_moves_bytes_and_backs_up_under_old_path() {
        let e = env();
        let (a, b) = (e.data.join("a.csv"), e.data.join("b.csv"));
        fs::write(&a, b"x,y\r\n1,2").unwrap();
        rename_file(&e.backups, &a, &b, T0).unwrap();
        assert!(!a.exists());
        assert_eq!(fs::read(&b).unwrap(), b"x,y\r\n1,2");
        let backups = e.backups.list(&a).unwrap();
        assert_eq!(backups.len(), 1);
        assert_eq!(e.backups.read(&a, &backups[0].id).unwrap(), b"x,y\r\n1,2");
    }

    #[test]
    fn rename_refuses_to_replace_another_file() {
        let e = env();
        let (a, b) = (e.data.join("a.csv"), e.data.join("b.csv"));
        fs::write(&a, "a").unwrap();
        fs::write(&b, "b").unwrap();
        let err = rename_file(&e.backups, &a, &b, T0).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(&a).unwrap(), b"a");
        assert_eq!(fs::read(&b).unwrap(), b"b");
        assert!(e.backups.list(&a).unwrap().is_empty());
    }

    #[test]
    fn rename_allows_case_only_change() {
        let e = env();
        let (a, b) = (e.data.join("group.csv"), e.data.join("Group.csv"));
        fs::write(&a, "a").unwrap();
        rename_file(&e.backups, &a, &b, T0).unwrap();
        let names: Vec<_> = list_files(&e.data, "csv").unwrap().into_iter().map(|f| f.name).collect();
        assert_eq!(names, ["Group.csv"]);
        assert_eq!(fs::read(&b).unwrap(), b"a");
    }

    #[test]
    fn rename_errors_when_source_missing() {
        let e = env();
        let err = rename_file(&e.backups, &e.data.join("nope.csv"), &e.data.join("b.csv"), T0).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
        assert!(!e.data.join("b.csv").exists());
    }

    // ---- delete_file ----

    #[test]
    fn delete_backs_up_then_removes() {
        let e = env();
        let p = e.data.join("g.csv");
        fs::write(&p, b"h\r\nrow\r\n").unwrap();
        delete_file(&e.backups, &p, T0).unwrap();
        assert!(!p.exists());
        let backups = e.backups.list(&p).unwrap();
        assert_eq!(backups.len(), 1);
        assert_eq!(e.backups.read(&p, &backups[0].id).unwrap(), b"h\r\nrow\r\n");
    }

    #[test]
    fn deleted_file_can_be_restored() {
        let e = env();
        let p = e.data.join("g.csv");
        fs::write(&p, b"data").unwrap();
        delete_file(&e.backups, &p, T0).unwrap();
        let id = e.backups.list(&p).unwrap()[0].id.clone();
        restore_backup(&e.backups, &p, &id, T0 + 1).unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"data");
    }

    #[test]
    fn delete_errors_when_missing_and_makes_no_backup() {
        let e = env();
        let p = e.data.join("nope.csv");
        assert_eq!(delete_file(&e.backups, &p, T0).unwrap_err().kind(), io::ErrorKind::NotFound);
        assert!(e.backups.list(&p).unwrap().is_empty());
    }

    // ---- JSON shape (must match src/lib/fs.ts) ----

    #[test]
    fn serializes_to_frontend_shape() {
        let t = TextFile { text: "a".into(), line_ending: LineEnding::Crlf, has_bom: false };
        assert_eq!(
            serde_json::to_value(&t).unwrap(),
            serde_json::json!({"text": "a", "lineEnding": "crlf", "hasBom": false})
        );
        let f = FileEntry { name: "n".into(), path: "p".into(), size: 1, modified_ms: 2 };
        assert_eq!(
            serde_json::to_value(&f).unwrap(),
            serde_json::json!({"name": "n", "path": "p", "size": 1, "modifiedMs": 2})
        );
        let b = BackupEntry { id: "i".into(), created_ms: 3, size: 4 };
        assert_eq!(
            serde_json::to_value(&b).unwrap(),
            serde_json::json!({"id": "i", "createdMs": 3, "size": 4})
        );
        for (le, s) in [
            (LineEnding::None, "none"),
            (LineEnding::Lf, "lf"),
            (LineEnding::Crlf, "crlf"),
            (LineEnding::Mixed, "mixed"),
        ] {
            assert_eq!(serde_json::to_value(le).unwrap(), serde_json::json!(s));
        }
    }
}
