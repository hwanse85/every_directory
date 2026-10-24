import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Copy,
  Files,
  GitCompareArrows,
  HardDrive,
  LoaderCircle,
  Search,
  X,
} from "lucide-react";
import type { IndexClient } from "../client";
import type { Location } from "../types";
import { Modal } from "./Modal";
import { formatSize } from "./FileIcon";

export type AnalysisKind = "stats" | "duplicates" | "compare";
interface AnalysisFile {
  location: Location;
  name: string;
  relative: string;
  bytes: number;
  modified: number;
}
interface AnalysisResult {
  files?: number;
  directories?: number;
  bytes?: number;
  elapsed: number;
  partial: boolean;
  skipped: number;
  largest?: AnalysisFile[];
  extensions?: { extension: string; count: number; bytes: number }[];
  groups?: {
    sha256: string;
    bytes: number;
    files: AnalysisFile[];
    totalFiles: number;
  }[];
  totalGroups?: number;
  recoverableBytes?: number;
  same?: number;
  different?: number;
  leftOnly?: number;
  rightOnly?: number;
  unverified?: number;
  displayLimited?: boolean;
  rows?: {
    status: "different" | "leftOnly" | "rightOnly" | "unverified";
    left?: AnalysisFile;
    right?: AnalysisFile;
  }[];
}
const titles = {
  stats: "폴더 용량 분석",
  duplicates: "중복 파일 찾기",
  compare: "두 폴더 비교",
};
const statusNames = {
  different: "내용 다름",
  leftOnly: "현재 폴더만",
  rightOnly: "다른 폴더만",
  unverified: "확인 필요",
};

// 폴더의 실제 내용 분석과 취소·결과 위치 이동을 한 화면에 제공한다.
export function WorkbenchTools({
  kind,
  client,
  location,
  other,
  label,
  otherLabel,
  onClose,
  onReveal,
}: {
  kind: AnalysisKind;
  client: IndexClient;
  location: Location;
  other?: Location;
  label: string;
  otherLabel?: string;
  onClose: () => void;
  onReveal: (location: Location) => void;
}) {
  const [result, setResult] = useState<AnalysisResult>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [progress, setProgress] = useState("");
  const [filter, setFilter] = useState("");
  useEffect(() => {
    let alive = true;
    client
      .request<AnalysisResult>("analysis", { action: kind, location, other })
      .then((value) => {
        if (alive) setResult(value);
      })
      .catch((cause) => {
        if (alive) setError(String(cause));
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    const timer = setInterval(() => {
      void client
        .request<{
          progress?: { stage: string; files?: number; readBytes?: number };
        }>("analysisStatus")
        .then((value) => {
          if (alive)
            setProgress(
              `${value.progress?.files?.toLocaleString() ?? "0"}개 확인${value.progress?.readBytes ? ` · ${formatSize(value.progress.readBytes)} 내용 검사` : ""}`,
            );
        })
        .catch(() => undefined);
    }, 700);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [
    client,
    kind,
    location.rootId,
    location.path,
    other?.rootId,
    other?.path,
  ]);

  // 실행 중에는 취소를 요청하고 결과 화면에서는 대화상자를 닫는다.
  async function close() {
    if (busy) {
      try {
        await client.request("cancelAnalysis");
        setProgress("취소하는 중…");
      } catch (cause) {
        setError(String(cause));
      }
    } else onClose();
  }
  // 선택한 분석 결과를 탐색창에서 표시한다.
  function reveal(file: AnalysisFile) {
    onReveal(file.location);
    onClose();
  }
  const Icon =
    kind === "stats"
      ? HardDrive
      : kind === "duplicates"
        ? Copy
        : GitCompareArrows;
  return (
    <Modal
      title={titles[kind]}
      subtitle={kind === "compare" ? `${label} ↔ ${otherLabel}` : label}
      onClose={() => void close()}
      wide
    >
      <div className="analysis-content">
        <div className="analysis-intro">
          <span>
            <Icon size={24} />
          </span>
          <div>
            <strong>
              {kind === "duplicates"
                ? "이름이 달라도 같은 파일을 찾습니다"
                : kind === "compare"
                  ? "파일 경로와 실제 내용을 비교합니다"
                  : "디스크 공간이 어디에 쓰이는지 확인하세요"}
            </strong>
            <p>
              {kind === "stats"
                ? "파일 종류별 사용량과 가장 큰 파일을 보여줍니다."
                : "SHA-256으로 내용을 확인합니다. 분석은 파일을 변경하지 않습니다."}
            </p>
          </div>
        </div>
        {busy ? (
          <div className="analysis-loading" role="status">
            <LoaderCircle className="spin" size={28} />
            <strong>파일을 분석하고 있습니다</strong>
            <span>{progress}</span>
            <button className="button secondary" onClick={() => void close()}>
              <X size={14} />
              분석 취소
            </button>
          </div>
        ) : error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : (
          result && (
            <>
              <div className="analysis-metrics">
                {(kind === "stats"
                  ? [
                      ["전체 크기", formatSize(result.bytes)],
                      ["파일", `${result.files?.toLocaleString()}개`],
                      [
                        "하위 폴더",
                        `${result.directories?.toLocaleString()}개`,
                      ],
                    ]
                  : kind === "duplicates"
                    ? [
                        ["동일 파일 그룹", `${result.totalGroups}개`],
                        ["중복 용량", formatSize(result.recoverableBytes)],
                        ["확인한 파일", `${result.files?.toLocaleString()}개`],
                      ]
                    : [
                        ["내용 동일", `${result.same}개`],
                        ["내용 다름", `${result.different}개`],
                        [
                          "한쪽에만 있음",
                          `${(result.leftOnly ?? 0) + (result.rightOnly ?? 0)}개`,
                        ],
                      ]
                ).map(([name, value]) => (
                  <div key={name}>
                    <small>{name}</small>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              {(result.partial || result.displayLimited) && (
                <p className="analysis-notice" role="status">
                  일부 결과입니다. 최대 10만 파일·내용 검사 4GiB·120초 범위이며
                  중복 100그룹·1,000파일, 비교 차이 1,000행까지 표시합니다. 읽기
                  제외 {result.skipped}개 · 내용 미확인 {result.unverified ?? 0}
                  개. 미확인 파일은 동일한 것으로 처리하지 않습니다.
                </p>
              )}
              {kind === "stats" && (
                <>
                  <h3>종류별 사용량</h3>
                  <div className="extension-bars">
                    {result.extensions?.slice(0, 8).map((item) => (
                      <div key={item.extension}>
                        <span>{item.extension}</span>
                        <div>
                          <i
                            style={{
                              width: `${Math.max(1, (item.bytes / Math.max(1, result.bytes ?? 1)) * 100)}%`,
                            }}
                          />
                        </div>
                        <span>{formatSize(item.bytes)}</span>
                        <small>{item.count}개</small>
                      </div>
                    ))}
                  </div>
                  <h3>가장 큰 파일</h3>
                  <div className="analysis-files">
                    {result.largest?.map((file) => (
                      <button key={file.relative} onClick={() => reveal(file)}>
                        <Files size={15} />
                        <span title={file.relative}>{file.relative}</span>
                        <small>{formatSize(file.bytes)}</small>
                        <ArrowUpRight size={14} />
                      </button>
                    ))}
                  </div>
                </>
              )}
              {kind === "duplicates" && (
                <>
                  {!result.groups?.length && (
                    <div className="analysis-empty">
                      {result.partial
                        ? "검사한 범위에서 동일한 파일을 찾지 못했습니다."
                        : "중복 파일이 없습니다."}
                    </div>
                  )}
                  {result.groups?.map((group, i) => (
                    <section className="duplicate-group" key={group.sha256}>
                      <header>
                        <strong>
                          그룹 {i + 1}{" "}
                          <span>
                            {group.totalFiles ?? group.files.length}개 파일
                          </span>
                        </strong>
                        <span>{formatSize(group.bytes)} / 파일</span>
                      </header>
                      <div className="analysis-files">
                        {group.files.map((file) => (
                          <button
                            key={file.relative}
                            onClick={() => reveal(file)}
                          >
                            <Files size={15} />
                            <span title={file.relative}>{file.relative}</span>
                            <ArrowUpRight size={14} />
                          </button>
                        ))}
                      </div>
                      <small className="hash-value">
                        SHA-256 {group.sha256}
                      </small>
                    </section>
                  ))}
                </>
              )}
              {kind === "compare" && (
                <>
                  <label className="analysis-filter">
                    <Search size={15} />
                    <input
                      aria-label="폴더 비교 결과 필터"
                      value={filter}
                      onChange={(event) => setFilter(event.target.value)}
                      placeholder="경로로 차이 필터링…"
                    />
                  </label>
                  <div className="analysis-files compare-files">
                    {result.rows
                      ?.filter((row) =>
                        (row.left?.relative ?? row.right?.relative ?? "")
                          .toLowerCase()
                          .includes(filter.toLowerCase()),
                      )
                      .map((row, i) => (
                        <button
                          key={i}
                          onClick={() => reveal((row.left ?? row.right)!)}
                        >
                          <span className={`diff-status ${row.status}`}>
                            {statusNames[row.status]}
                          </span>
                          <span>
                            {row.left?.relative ?? row.right?.relative}
                          </span>
                          <ArrowUpRight size={14} />
                        </button>
                      ))}
                  </div>
                  {!result.rows?.length && (
                    <div className="analysis-empty">
                      {result.partial
                        ? "확인한 파일에서 차이가 없습니다."
                        : "두 폴더의 파일 내용이 모두 같습니다."}
                    </div>
                  )}
                </>
              )}
              <p className="analysis-footnote">
                분석 완료 · {(result.elapsed / 1000).toFixed(2)}초 · 파일을
                누르면 해당 위치로 이동합니다.
              </p>
            </>
          )
        )}
      </div>
    </Modal>
  );
}
