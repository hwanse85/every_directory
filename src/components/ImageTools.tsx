import { writeClipboard } from "../client";
import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { fileUrl, type IndexClient } from "../client";
import type {
  FileEntry,
  ImageResizeOptions,
  Location,
  OcrResult,
} from "../types";
import { Modal } from "./Modal";

// 이미지 사본 크기 변경과 로컬 한글·영문 텍스트 추출을 제공한다.
export function ImageTools({
  action,
  entries,
  location,
  client,
  onClose,
  onChanged,
  onMessage,
}: {
  action: "resizeImages" | "ocr";
  entries: FileEntry[];
  location: Location;
  client: IndexClient;
  onClose: () => void;
  onChanged: () => void;
  onMessage: (message: string, error?: boolean) => void;
}) {
  const [sources] = useState(entries);
  const [options, setOptions] = useState<ImageResizeOptions>({
    width: 1600,
    height: 900,
    fit: "inside",
    format: "png",
    enlarge: false,
  });
  const [folder, setFolder] = useState("크기변경");
  const [language, setLanguage] = useState("kor+eng");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<OcrResult>();
  const [copied, setCopied] = useState(false);
  const resize = action === "resizeImages";
  const valid =
    sources.length > 0 &&
    sources.every(
      (entry) =>
        entry.kind === "file" &&
        ["png", "jpg", "jpeg", "webp"].includes(entry.extension.toLowerCase()),
    ) &&
    (resize ? sources.length <= 50 : sources.length === 1);

  // 원본을 보존하고 서버에서 선택한 이미지 작업을 실행한다.
  async function perform(): Promise<void> {
    setError("");
    setBusy(true);
    setCopied(false);
    try {
      const response = await client.request<OcrResult>("operation", {
        action,
        entries: sources.map(({ rootId, path }) => ({ rootId, path })),
        destination: location,
        name: folder,
        image: options,
        language,
      });
      if (resize) {
        onChanged();
        onMessage(
          `${sources.length}개 이미지 사본을 ${folder} 폴더에 저장했습니다.`,
        );
        onClose();
      } else setResult(response);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "이미지 작업에 실패했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  // 인식된 내용을 OS 텍스트 클립보드로 복사한다.
  async function copyText(): Promise<void> {
    try {
      await writeClipboard(result?.text ?? "");
      setCopied(true);
    } catch {
      setError("텍스트를 선택해 직접 복사해 주세요.");
    }
  }

  // 인식 결과를 UTF-8 텍스트 파일로 다운로드한다.
  function downloadText(): void {
    const url = URL.createObjectURL(
      new Blob([result?.text ?? ""], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = sources[0].name.replace(/\.[^.]+$/, "") + ".ocr.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <Modal
      title={resize ? "이미지 크기 변경" : "이미지 텍스트 추출 · OCR"}
      subtitle={`${sources.length}개 선택 · 원본 파일 유지`}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <div className="modal-content image-tools">
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {!valid && (
          <p className="error-text" role="alert">
            {resize
              ? "PNG·JPEG·WebP 이미지 1~50개를 선택해 주세요."
              : "PNG·JPEG·WebP 이미지 하나를 선택해 주세요."}
          </p>
        )}
        <div className="image-sources">
          {sources.slice(0, 8).map((entry) => (
            <div key={entry.id}>
              {valid && (
                <img src={fileUrl(entry.rootId, entry.path)} alt={entry.name} />
              )}
              <span>{entry.name}</span>
            </div>
          ))}
          {sources.length > 8 && <span>외 {sources.length - 8}개</span>}
        </div>
        {resize ? (
          <>
            <div className="image-presets" aria-label="이미지 크기 프리셋">
              {[
                { title: "작게", width: 640, height: 480 },
                { title: "보통", width: 1280, height: 720 },
                { title: "크게", width: 1920, height: 1080 },
              ].map((preset) => (
                <button
                  className="button secondary small"
                  key={preset.title}
                  disabled={busy}
                  onClick={() =>
                    setOptions({
                      ...options,
                      width: preset.width,
                      height: preset.height,
                    })
                  }
                >
                  {preset.title} {preset.width}×{preset.height}
                </button>
              ))}
            </div>
            <div className="image-options">
              <label>
                가로 (px)
                <input
                  aria-label="이미지 가로"
                  type="number"
                  min="1"
                  max="8192"
                  value={options.width}
                  disabled={busy}
                  onChange={(event) =>
                    setOptions({
                      ...options,
                      width: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                세로 (px)
                <input
                  aria-label="이미지 세로"
                  type="number"
                  min="1"
                  max="8192"
                  value={options.height}
                  disabled={busy}
                  onChange={(event) =>
                    setOptions({
                      ...options,
                      height: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                맞춤 방식
                <select
                  aria-label="이미지 맞춤 방식"
                  value={options.fit}
                  disabled={busy}
                  onChange={(event) =>
                    setOptions({
                      ...options,
                      fit: event.target.value as ImageResizeOptions["fit"],
                    })
                  }
                >
                  <option value="inside">비율 유지 · 지정 크기 안에</option>
                  <option value="cover">비율 유지 · 잘라서 채우기</option>
                  <option value="fill">지정 크기로 늘이기</option>
                </select>
              </label>
              <label>
                저장 형식
                <select
                  aria-label="이미지 저장 형식"
                  value={options.format}
                  disabled={busy}
                  onChange={(event) =>
                    setOptions({
                      ...options,
                      format: event.target
                        .value as ImageResizeOptions["format"],
                    })
                  }
                >
                  <option value="png">PNG</option>
                  <option value="jpeg">JPEG</option>
                  <option value="webp">WebP</option>
                </select>
              </label>
              <label className="full">
                새 결과 폴더
                <input
                  aria-label="이미지 결과 폴더"
                  value={folder}
                  disabled={busy}
                  onChange={(event) => setFolder(event.target.value)}
                />
              </label>
            </div>
            <label className="image-check">
              <input
                type="checkbox"
                checked={options.enlarge}
                disabled={busy}
                onChange={(event) =>
                  setOptions({ ...options, enlarge: event.target.checked })
                }
              />
              작은 이미지 확대 허용
            </label>
            <p className="modal-footnote">
              변환한 사본을 현재 탐색 위치의 새 폴더에 저장합니다. 같은 폴더가
              있으면 중단합니다. 정지 이미지 50개, 파일당 50MB·4천만 픽셀까지
              지원합니다.
            </p>
          </>
        ) : (
          <>
            <label className="ocr-language">
              인식 언어
              <select
                aria-label="OCR 언어"
                value={language}
                disabled={busy}
                onChange={(event) => setLanguage(event.target.value)}
              >
                <option value="kor+eng">한국어 + English</option>
                <option value="kor">한국어</option>
                <option value="eng">English</option>
              </select>
            </label>
            <p className="modal-footnote">
              설치된 언어 모델로 이 기기에서 처리합니다. 이미지가 외부 서버로
              전송되지 않습니다. 결과를 검토하고 수정한 뒤 복사하거나
              저장하세요.
            </p>
            {result && (
              <>
                <label className="ocr-result">
                  추출한 텍스트 · 인식 신뢰도 {Math.round(result.confidence)}%
                  <textarea
                    aria-label="추출한 텍스트"
                    value={result.text}
                    onChange={(event) => {
                      setResult({ ...result, text: event.target.value });
                      setCopied(false);
                    }}
                  />
                </label>
                <div className="image-presets">
                  <button
                    className="button secondary"
                    onClick={() => void copyText()}
                  >
                    {copied ? "복사 완료" : "텍스트 복사"}
                  </button>
                  <button className="button secondary" onClick={downloadText}>
                    TXT 다운로드
                  </button>
                </div>
              </>
            )}
          </>
        )}
        {busy && (
          <p className="operation-progress" role="status">
            <LoaderCircle className="spin" size={16} />
            {resize
              ? "이미지 사본을 만드는 중입니다."
              : "언어 모델 준비 및 텍스트 인식 중입니다."}
          </p>
        )}
        <button
          className="button primary full-width"
          disabled={busy || !valid}
          onClick={() => void perform()}
        >
          {busy
            ? "처리 중"
            : resize
              ? "사본으로 크기 변경"
              : result
                ? "다시 텍스트 추출"
                : "텍스트 추출 시작"}
        </button>
      </div>
    </Modal>
  );
}
