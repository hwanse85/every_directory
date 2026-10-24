import { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { isDesktop } from "../client";

GlobalWorkerOptions.workerSrc = workerUrl;

// 브라우저 PDF 플러그인에 의존하지 않고 선택한 페이지만 캔버스에 그린다.
export default function PdfPreview({ url }: { url: string }) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(1);
  const [width, setWidth] = useState(700);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [text, setText] = useState("");

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    const task = getDocument({
      url,
      withCredentials: !isDesktop,
      enableXfa: false,
    });
    void task.promise
      .then((pdf) => {
        if (alive) setDocument(pdf);
      })
      .catch((cause: Error) => {
        if (alive) {
          setError(
            cause.name === "PasswordException"
              ? "암호가 필요한 PDF입니다. 다운로드 후 열어 주세요."
              : `PDF를 읽지 못했습니다: ${cause.message}`,
          );
          setLoading(false);
        }
      });
    return () => {
      alive = false;
      void task.destroy();
    };
  }, [url]);

  useEffect(() => {
    if (!document || !canvas.current) return;
    let alive = true;
    let render: RenderTask | undefined;
    setLoading(true);
    setError("");
    // 현재 페이지를 화면 너비에 맞추고 접근 가능한 텍스트도 준비한다.
    async function draw(): Promise<void> {
      const pdfPage = await document!.getPage(page);
      if (!alive || !canvas.current) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({
        scale: (Math.max(180, width - 48) / base.width) * zoom,
      });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const target = canvas.current;
      target.width = Math.floor(viewport.width * ratio);
      target.height = Math.floor(viewport.height * ratio);
      target.style.width = `${viewport.width}px`;
      target.style.height = `${viewport.height}px`;
      render = pdfPage.render({
        canvas: target,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      await render.promise;
      const content = await pdfPage.getTextContent();
      if (alive)
        setText(
          content.items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" ")
            .slice(0, 20000),
        );
    }
    void draw()
      .catch((cause: Error) => {
        if (alive && cause.name !== "RenderingCancelledException")
          setError(`PDF 표시 오류: ${cause.message}`);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      render?.cancel();
    };
  }, [document, page, width, zoom]);

  return (
    <div className="pdf-preview" ref={container}>
      <div className="pdf-toolbar">
        <button
          disabled={!document || page <= 1 || loading}
          onClick={() => setPage(page - 1)}
        >
          이전 페이지
        </button>
        <span aria-live="polite">
          {page} / {document?.numPages ?? "…"} 페이지
        </span>
        <button
          disabled={!document || page >= document.numPages || loading}
          onClick={() => setPage(page + 1)}
        >
          다음 페이지
        </button>
        <select
          aria-label="PDF 확대"
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
        >
          <option value={0.75}>75%</option>
          <option value={1}>너비 맞춤</option>
          <option value={1.25}>125%</option>
          <option value={1.5}>150%</option>
        </select>
      </div>
      {error ? (
        <p role="alert" className="error-text">
          {error}
        </p>
      ) : (
        <>
          {loading && <p role="status">PDF를 그리는 중입니다…</p>}
          <div className="pdf-pages" aria-busy={loading}>
            <canvas ref={canvas} role="img" aria-label={`PDF ${page}페이지`} />
          </div>
          <p className="pdf-page-text">{text}</p>
        </>
      )}
    </div>
  );
}
