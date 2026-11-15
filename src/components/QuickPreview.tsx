import { lazy, Suspense, useEffect, useState } from "react";
import { FileText, LoaderCircle } from "lucide-react";
import { fileUrl } from "../client";
import { formatSize } from "./FileIcon";
import type { FileEntry } from "../types";

const PdfPreview = lazy(() => import("./PdfPreview"));
const imageTypes = ["png", "jpg", "jpeg", "webp", "gif", "svg", "avif", "bmp"];
const textTypes = ["md", "txt", "csv", "tsv", "json", "log", "xml", "html", "css", "js", "jsx", "ts", "tsx", "py", "rs", "go", "java", "sh", "yml", "yaml", "ini", "toml", "sql"];

// 빠른 검색에서 고른 파일의 앞부분(이미지·PDF 첫 쪽·텍스트 앞 16KB)을 바로 보여 준다.
export function QuickPreview({ entry }: { entry: FileEntry }) {
  const [text, setText] = useState<string>();
  const [error, setError] = useState("");
  const url = fileUrl(entry.rootId, entry.path);
  const ext = entry.extension.toLowerCase();
  const isText = textTypes.includes(ext);
  useEffect(() => {
    setText(undefined);
    setError("");
    if (!isText) return;
    const controller = new AbortController();
    fetch(url, { headers: { Range: "bytes=0-16383" }, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("파일을 읽지 못했습니다.");
        setText(await response.text());
      })
      .catch((cause: Error) => {
        if (!controller.signal.aborted) setError(cause.message);
      });
    return () => controller.abort();
  }, [url, isText]);
  return (
    <div className="quick-preview" aria-label={`${entry.name} 미리보기`}>
      <div className="quick-preview-meta">
        <strong title={entry.name}>{entry.name}</strong>
        <span>{entry.kind === "directory" ? "폴더" : `${ext.toUpperCase()} · ${formatSize(entry.size)}`}</span>
      </div>
      <div className="quick-preview-body">
        {error ? (
          <p className="quick-preview-empty">{error}</p>
        ) : isText ? (
          text === undefined ? <LoaderCircle className="spin" /> : <pre>{text}</pre>
        ) : imageTypes.includes(ext) ? (
          <img src={url} alt={entry.name} onError={() => setError("이미지를 읽지 못했습니다.")} />
        ) : ext === "pdf" ? (
          <Suspense fallback={<LoaderCircle className="spin" />}>
            <PdfPreview key={url} url={url} />
          </Suspense>
        ) : (
          <p className="quick-preview-empty">
            <FileText size={32} />
            미리 볼 수 없는 형식입니다. Enter로 기본 앱에서 여세요.
          </p>
        )}
      </div>
    </div>
  );
}
