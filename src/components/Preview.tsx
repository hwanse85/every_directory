import { lazy, Suspense, useEffect, useState } from "react";
import { Download, FileText, LoaderCircle } from "lucide-react";
import { Modal } from "./Modal";
import { formatSize } from "./FileIcon";
import { fileUrl, isDesktop, saveFileCopy } from "../client";
import type { ConnectedRoot, FileEntry } from "../types";

const PdfPreview = lazy(() => import("./PdfPreview"));

// 연결 폴더의 파일을 스트리밍하거나 텍스트 앞부분만 미리 본다.
export function Preview({
  entry,
  root,
  onClose,
}: {
  entry: FileEntry;
  root: ConnectedRoot;
  onClose: () => void;
}) {
  const [text, setText] = useState<string>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const url = fileUrl(entry.rootId, entry.path);
  const isImage = ["png", "jpg", "jpeg", "webp", "gif", "svg", "avif"].includes(
    entry.extension,
  );
  const isText = [
    "md",
    "txt",
    "csv",
    "json",
    "js",
    "ts",
    "tsx",
    "jsx",
    "py",
    "css",
    "html",
    "yml",
    "yaml",
    "sh",
    "go",
    "rs",
  ].includes(entry.extension);
  useEffect(() => {
    if (root.demo || !isText) return;
    const controller = new AbortController();
    setLoading(true);
    fetch(url, {
      headers: { Range: "bytes=0-262143" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "파일을 읽지 못했습니다.");
        }
        const value = await response.text();
        if (!controller.signal.aborted) setText(value);
      })
      .catch((cause: Error) => {
        if (!controller.signal.aborted) setError(cause.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [url, isText, root.demo]);

  return (
    <Modal
      title={entry.name}
      subtitle={`${root.name}/${entry.parent}`}
      onClose={onClose}
      wide
    >
      <div className="preview-meta">
        <span>{entry.extension.toUpperCase()} 파일</span>
        <span>{formatSize(entry.size)}</span>
        {!root.demo && isDesktop ? (
          <button
            className="button secondary small"
            onClick={() => void saveFileCopy(entry.rootId, entry.path, entry.name)
              .catch((cause: unknown) => setError(String(cause)))}
          >
            <Download size={14} />사본 저장
          </button>
        ) : !root.demo && (
          <a
            className="button secondary small"
            href={fileUrl(entry.rootId, entry.path, true)}
            download
          >
            <Download size={14} />
            다운로드
          </a>
        )}
      </div>
      <div
        className={`preview-body ${entry.extension === "pdf" ? "pdf-body" : ""}`}
      >
        {loading ? (
          <div className="preview-empty">
            <LoaderCircle className="spin" />
            파일을 읽고 있습니다
          </div>
        ) : error ? (
          <div className="preview-empty error-text">{error}</div>
        ) : root.demo ? (
          <div className="preview-empty">
            <FileText size={44} />
            <h3>샘플 파일입니다</h3>
            <p>내 폴더를 연결하면 실제 파일을 미리 볼 수 있습니다.</p>
          </div>
        ) : text !== undefined ? (
          <>
            <pre>{text}</pre>
            {(entry.size ?? 0) > 262144 && (
              <p className="preview-note">
                처음 256KB만 표시합니다. 전체 내용은 다운로드해 확인하세요.
              </p>
            )}
          </>
        ) : isImage ? (
          <img
            src={url}
            alt={entry.name}
            onError={() =>
              setError("이미지를 읽지 못했습니다. 파일 상태를 확인해 주세요.")
            }
          />
        ) : entry.extension === "pdf" ? (
          <Suspense fallback={<p role="status">PDF 미리보기를 준비합니다…</p>}>
            <PdfPreview key={url} url={url} />
          </Suspense>
        ) : ["mp3", "wav", "ogg", "m4a", "flac"].includes(entry.extension) ? (
          <audio src={url} controls />
        ) : ["mp4", "webm", "mov"].includes(entry.extension) ? (
          <video src={url} controls />
        ) : (
          <div className="preview-empty">
            <FileText size={44} />
            <h3>파일을 다운로드해 열어주세요</h3>
            <p>이 파일 형식은 브라우저 미리보기를 지원하지 않습니다.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
