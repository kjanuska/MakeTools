import { displayName } from "../lib/table/fileNames";
import { useCallback, useEffect, useState } from "react";
import { formatSize, utf8Length } from "../lib/format";
import { readText, type FileEntry, type TextFile } from "../lib/fs";
import { BackupsPanel } from "./BackupsPanel";

interface Props {
  file: FileEntry;
  /** Called after the file on disk changed (e.g. a restore). */
  onChanged: () => void;
}

// Contents are never displayed here: the files hold credentials.
export function FilePanel({ file, onChanged }: Props) {
  const [info, setInfo] = useState<TextFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    readText(file.path)
      .then(setInfo)
      .catch((e) => {
        setInfo(null);
        setError(String(e));
      });
  }, [file.path]);

  useEffect(load, [load]);

  return (
    <div className="file-panel">
      <h2>{displayName(file.name)}</h2>
      <p className="muted path">{file.path}</p>
      {error && <p className="error">Couldn't read file: {error}</p>}
      {info && (
        <dl className="file-info">
          <dt>Size</dt>
          <dd>{formatSize(utf8Length(info.text))}</dd>
          <dt>BOM</dt>
          <dd>{info.hasBom ? "Yes" : "No"}</dd>
        </dl>
      )}
      <BackupsPanel
        file={file}
        onRestored={() => {
          load();
          onChanged();
        }}
      />
    </div>
  );
}
