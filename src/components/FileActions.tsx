import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Archive,
  ClipboardPaste,
  Copy,
  Scissors,
  FolderPlus,
  Pencil,
  Trash2,
  Ellipsis,
  LoaderCircle,
} from "lucide-react";
import {
  copyFiles,
  pasteFiles,
  isDesktop,
  isMac,
  quickAccess,
  type IndexClient,
} from "../client";
import type {
  FileClipboard,
  FileEntry,
  FileOperation,
  FileProperties,
  Location,
  RenameRule,
  TrashItem,
  ToolRequest,
} from "../types";
import { renamePreview } from "../rename";
import { formatSize } from "./FileIcon";
import { Modal } from "./Modal";
import { ImageTools } from "./ImageTools";

const initialRule: RenameRule = {
  find: "",
  replace: "",
  regex: false,
  caseSensitive: false,
  preserveExtension: true,
  prefix: "",
  suffix: "",
  number: false,
  start: 1,
  padding: 3,
};
type ActionDialog =
  | "mkdir"
  | "mkfile"
  | "rename"
  | "batchRename"
  | "trash"
  | "zip"
  | "unzip"
  | "properties"
  | "trashList";

// 탐색창의 파일 작업과 일괄 이름 변경 미리보기를 제공한다.
export function FileActions({
  client,
  entries,
  location,
  disabled,
  active,
  clipboard,
  onClipboard,
  onChanged,
  onMessage,
  onPreview,
  onSelectAll,
  toolRequest,
  onMore,
  scope = "explorer",
  selectionOnly = false,
  extra,
  onCreated,
}: {
  client: IndexClient;
  entries: FileEntry[];
  location: Location;
  disabled: boolean;
  active: boolean;
  clipboard?: FileClipboard;
  onClipboard: (value?: FileClipboard) => void;
  onChanged: () => void;
  onMessage: (message: string, error?: boolean) => void;
  onPreview: (entry: FileEntry) => void;
  onSelectAll: () => void;
  toolRequest?: ToolRequest;
  onMore: (x: number, y: number) => void;
  scope?: "explorer" | "search";
  selectionOnly?: boolean;
  extra?: ReactNode;
  onCreated?: (name: string) => void;
}) {
  const [imageTool, setImageTool] = useState<"resizeImages" | "ocr">();
  const handledTool = useRef<number | undefined>(undefined);
  const pendingTool = useRef<{ id: number; location: string } | undefined>(
    undefined,
  );
  const [dialog, setDialog] = useState<ActionDialog>();
  const [name, setName] = useState("");
  const [rule, setRule] = useState<RenameRule>(initialRule);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [properties, setProperties] = useState<FileProperties>();
  const [trash, setTrash] = useState<TrashItem[]>([]);
  const toolbar = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const [dense, setDense] = useState(false);
  const selected = entries.map(({ rootId, path }) => ({ rootId, path }));
  let preview: string[] = [];
  let previewError = "";
  if (dialog === "batchRename") {
    try {
      preview = renamePreview(entries, rule);
    } catch (cause) {
      previewError = cause instanceof Error ? cause.message : String(cause);
    }
  }

  // 선택 항목을 탐색창 사이에서 공유하는 파일 클립보드에 담는다.
  async function copy(cut: boolean): Promise<void> {
    if (!entries.length || disabled || busy) return;
    setBusy(true);
    try {
      if (isDesktop) await copyFiles(selected, cut);
      onClipboard({ entries: selected, cut });
      onMessage(
        `${entries.length}개 항목 ${cut ? "잘라내기" : "복사"} · 대상 폴더에서 붙여넣으세요.`,
      );
    } catch (cause) {
      onMessage(String(cause), true);
    } finally {
      setBusy(false);
    }
  }

  // 파일 작업 완료 후 목록과 선택 상태를 갱신한다.
  async function perform(
    request: FileOperation,
    message: string,
    close = true,
  ): Promise<boolean> {
    if (busy || disabled) return false;
    setBusy(true);
    setError("");
    try {
      await client.request("operation", request);
      if (
        isDesktop &&
        request.action === "open" &&
        request.entries?.length === 1
      ) {
        void quickAccess("opened", { location: request.entries[0] }).catch(
          (cause) =>
            onMessage(
              `열기는 완료했지만 기록 저장에 실패했습니다: ${String(cause)}`,
              true,
            ),
        );
      }
      if (!["open", "reveal"].includes(request.action)) onChanged();
      if (close) setDialog(undefined);
      onMessage(message);
      return true;
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "파일 작업에 실패했습니다.";
      setError(message);
      onMessage(message, true);
      return false;
    } finally {
      setBusy(false);
    }
  }

  // 공유 클립보드의 항목을 현재 탐색 폴더에 복사하거나 이동한다.
  async function paste(): Promise<void> {
    const destination=selectionOnly?(entries.length===1&&entries[0].kind==="directory"?{rootId:entries[0].rootId,path:entries[0].path}:undefined):location;
    if(!destination){onMessage("붙여넣을 폴더 하나를 선택해 주세요.",true);return;}
    if (isDesktop) {
      if (busy || disabled) return;
      setBusy(true);
      setError("");
      try {
        const result = await pasteFiles(destination, clipboard);
        if (result.cut) onClipboard(undefined);
        onChanged();
        onMessage("붙여넣기를 완료했습니다.");
      } catch (cause) {
        setError(String(cause));
        onMessage(String(cause), true);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!clipboard) return;
    const complete = await perform(
      {
        action: clipboard.cut ? "move" : "copy",
        entries: clipboard.entries,
        destination,
      },
      "붙여넣기를 완료했습니다.",
    );
    if (complete && clipboard.cut) onClipboard(undefined);
  }

  // 읽기 전용 속성 또는 앱 휴지통 목록을 불러온다.
  async function loadDetails(
    next: "properties" | "trashList",
    hash = false,
  ): Promise<void> {
    setBusy(true);
    setError("");
    try {
      if (next === "trashList")
        setTrash(await client.request<TrashItem[]>("trash"));
      else
        setProperties(
          await client.request<FileProperties>("operation", {
            action: hash ? "hash" : "properties",
            entries: selected,
          }),
        );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "정보를 읽을 수 없습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  // 작업별 입력값을 준비하고 대화상자를 연다.
  function show(next: ActionDialog): void {
    if (disabled || busy) return;
    setError("");
    setProperties(undefined);
    setDialog(next);
    setName(
      next === "mkfile"
        ? "새 파일.txt"
        : next === "mkdir"
          ? "새 폴더"
          : next === "zip"
            ? (entries.length === 1
                ? entries[0].name.replace(/\.[^.]+$/, "")
                : "압축파일") + ".zip"
            : next === "unzip"
              ? entries[0]?.name.replace(/\.zip$/i, "") || "압축해제"
              : entries[0]?.name || "",
    );
    if (next === "properties" || next === "trashList") void loadDetails(next);
  }

  useEffect(() => {
    if (!toolRequest || handledTool.current === toolRequest.id) return;
    const key = JSON.stringify(location);
    if (pendingTool.current?.id !== toolRequest.id)
      pendingTool.current = { id: toolRequest.id, location: key };
    if (pendingTool.current.location !== key) {
      handledTool.current = toolRequest.id;
      return;
    }
    // 인덱스 갱신 중 들어온 메뉴 요청을 소비하지 않고 같은 위치의 목록이 준비되면 실행한다.
    if (disabled || busy) return;
    handledTool.current = toolRequest.id;
    const action = toolRequest.action;
    if (
      ![
        "copy",
        "cut",
        "paste",
        "resizeImages",
        "ocr",
        "preview",
        "open",
        "reveal",
        "duplicate",
        "hash",
        "mkdir",
        "mkfile",
        "rename",
        "batchRename",
        "trash",
        "zip",
        "unzip",
        "properties",
        "trashList",
      ].includes(action)
    )
      return;
    if (
      !["trashList", "mkdir", "mkfile", "paste"].includes(action) &&
      !entries.length
    ) {
      onMessage("활성 탐색창에서 파일을 먼저 선택해 주세요.", true);
      return;
    }
    if (action === "copy" || action === "cut") copy(action === "cut");
    else if (action === "paste") void paste();
    else if (action === "resizeImages" || action === "ocr")
      setImageTool(action);
    else if (action === "preview") {
      if (entries.length === 1 && entries[0].kind === "file")
        onPreview(entries[0]);
      else onMessage("미리볼 파일 하나를 선택해 주세요.", true);
    } else if (action === "open" || action === "reveal") {
      if (entries.length === 1)
        void perform(
          { action, entries: selected },
          "기본 앱 또는 탐색기를 열었습니다.",
        );
      else onMessage("파일 하나를 선택해 주세요.", true);
    } else if (action === "duplicate")
      void perform(
        { action, entries: selected },
        "같은 폴더에 사본을 만들었습니다.",
      );
    else if (action === "hash") {
      setDialog("properties");
      setProperties(undefined);
      void loadDetails("properties", true);
    } else if (
      [
        "mkdir",
        "mkfile",
        "rename",
        "batchRename",
        "trash",
        "zip",
        "unzip",
        "properties",
        "trashList",
      ].includes(action)
    )
      show(action as ActionDialog);
  }, [toolRequest, disabled, busy, entries, location.rootId, location.path]);

  useEffect(() => {
    // 좁으면 Windows 11 명령 막대처럼 보조 명령은 아이콘만, 더 좁으면 모든 이름을 숨긴다.
    const observer = new ResizeObserver(([entry]) => {
      setCompact(entry.contentRect.width < 560);
      setDense(entry.contentRect.width < 820);
    });
    if (toolbar.current) observer.observe(toolbar.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // 활성 탐색창에서만 파일 작업 단축키를 처리한다.
    function shortcuts(event: KeyboardEvent): void {
      const target = event.target instanceof Element ? event.target : undefined;
      if (
        event.defaultPrevented ||
        event.isComposing || event.keyCode === 229 ||
        (scope==="search"?!target?.closest(".search-panel"):!!target?.closest(".search-panel")) ||
        !!target?.closest('[role="menu"]') ||
        !active ||
        disabled ||
        busy ||
        document.querySelector("dialog[open]") ||
        target?.closest(
          'input:not([type="checkbox"]),textarea,select,[contenteditable=true]',
        )
      )
        return;
      if (event.key === " " && target?.matches('input[type="checkbox"]'))
        return;
      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (event.altKey && event.key === "Enter" && entries.length) {
        event.preventDefault();
        show("properties");
      } else if (!selectionOnly && modifier && event.shiftKey && key === "n") {
        event.preventDefault();
        show("mkdir");
      } else if (modifier && !event.shiftKey && key === "d" && entries.length) {
        event.preventDefault();
        void perform(
          { action: "duplicate", entries: selected },
          "사본을 만들었습니다.",
        );
      } else if (modifier && !event.shiftKey && key === "i" && entries.length) {
        event.preventDefault();
        show("properties");
      } else if(event.key==="Insert"&&event.ctrlKey&&!event.shiftKey&&!event.altKey){
        event.preventDefault();void copy(false);
      } else if(event.key==="Insert"&&event.shiftKey&&!modifier&&!event.altKey){
        event.preventDefault();void paste();
      } else if (
        modifier &&
        !event.shiftKey &&
        ["c", "x", "v", "a"].includes(key)
      ) {
        event.preventDefault();
        if (key === "c") copy(false);
        if (key === "x") copy(true);
        if (key === "v") void paste();
        if (key === "a") onSelectAll();
      } else if (event.key === "F2" && entries.length === 1) {
        event.preventDefault();
        show("rename");
      } else if (
        (event.key === "Delete" || (event.key === "Backspace" && modifier)) &&
        entries.length
      ) {
        event.preventDefault();
        show("trash");
      } else if (
        event.key === " " &&
        entries.length === 1 &&
        entries[0].kind === "file"
      ) {
        event.preventDefault();
        onPreview(entries[0]);
      }
    }
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [active, disabled, busy, entries, clipboard, location,scope,selectionOnly]);

  // 현재 입력을 실제 서버 파일 작업으로 적용한다.
  async function submit(): Promise<void> {
    if (!dialog || dialog === "properties" || dialog === "trashList") return;
    const creates = ["mkdir", "mkfile", "zip", "unzip"].includes(dialog);
    const done = await perform(
      { action: dialog, entries: selected, destination: location, name, rule },
      dialog === "trash"
        ? "앱 휴지통으로 이동했습니다. 휴지통에서 복원할 수 있습니다."
        : "파일 작업을 완료했습니다.",
    );
    // 탐색기처럼 새로 만든 폴더·파일·압축 결과를 목록에서 선택하도록 이름을 알린다.
    if (done && creates) onCreated?.(name.trim());
  }

  const blocked = disabled || busy;
  const titles: Record<ActionDialog, string> = {
    mkdir: "새 폴더",
    mkfile: "새 텍스트 파일",
    rename: "이름 변경",
    batchRename: "일괄 이름 변경",
    trash: "휴지통으로 이동",
    zip: "ZIP 압축",
    unzip: "ZIP 압축 풀기",
    properties: "파일 속성",
    trashList: "앱 휴지통",
  };
  return (
    <>
      <div
        ref={toolbar}
        className={`file-action-bar ${compact ? "compact" : ""} ${dense ? "dense" : ""}`}
        aria-label="파일 작업"
        hidden={selectionOnly&&!entries.length}
      >
        {!selectionOnly && <button
          disabled={blocked}
          onClick={() => show("mkdir")}
          title="새 폴더"
        >
          <FolderPlus size={14} />
          <span>새 폴더</span>
        </button>}
        <button
          disabled={blocked || !entries.length}
          onClick={() => copy(false)}
          title="복사 · Ctrl/⌘ C"
        >
          <Copy size={14} />
          <span>복사</span>
        </button>
        <button
          disabled={blocked || !entries.length}
          onClick={() => copy(true)}
          title="잘라내기 · Ctrl/⌘ X"
        >
          <Scissors size={14} />
          <span>잘라내기</span>
        </button>
        <button
          disabled={blocked || (!isDesktop && !clipboard) || (selectionOnly&&(entries.length!==1||entries[0]?.kind!=="directory"))}
          onClick={() => void paste()}
          title={selectionOnly?"선택한 폴더에 붙여넣기 · Ctrl/⌘ V":"붙여넣기 · Ctrl/⌘ V"}
        >
          <ClipboardPaste size={14} />
          <span>붙여넣기</span>
        </button>
        <button
          disabled={blocked || entries.length !== 1}
          onClick={() => show("rename")}
          title={`${isMac ? "이름 변경" : "이름 바꾸기"} · F2`}
        >
          <Pencil size={14} />
          <span>{isMac ? "이름 변경" : "이름 바꾸기"}</span>
        </button>
        <button
          disabled={blocked || !entries.length}
          onClick={() => show("trash")}
          title="휴지통으로 이동 · Delete"
        >
          <Trash2 size={14} />
          <span>삭제</span>
        </button>
        <button
          disabled={blocked || !entries.length}
          onClick={() => show("zip")}
          title="ZIP 압축"
        >
          <Archive size={14} />
          <span>압축</span>
        </button>
        {extra}
        <button
          aria-label="추가 파일 도구"
          title="모든 파일 작업"
          disabled={blocked}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            onMore(rect.right - 320, rect.bottom + 6);
          }}
        >
          <Ellipsis size={17} />
          <span>도구</span>
        </button>
        {busy && <LoaderCircle size={14} className="spin" />}
      </div>
      {imageTool && (
        <ImageTools
          action={imageTool}
          entries={entries}
          location={location}
          client={client}
          onClose={() => setImageTool(undefined)}
          onChanged={onChanged}
          onMessage={onMessage}
        />
      )}
      {dialog && (
        <Modal
          title={titles[dialog]}
          subtitle={
            dialog === "trashList"
              ? "이 앱에서 삭제한 항목을 원래 위치로 복원합니다."
              : `${entries.length}개 선택 · ${location.path || "연결 폴더"}`
          }
          onClose={() => {
            if (!busy) setDialog(undefined);
          }}
          wide={dialog === "batchRename"}
        >
          <div className="modal-content operation-dialog">
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            {dialog === "batchRename" ? (
              <>
                <div className="rename-inputs">
                  <label>
                    찾기
                    <input
                      aria-label="일괄 이름 찾기"
                      value={rule.find}
                      onChange={(event) =>
                        setRule({ ...rule, find: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    바꾸기
                    <input
                      aria-label="일괄 이름 바꾸기"
                      value={rule.replace}
                      onChange={(event) =>
                        setRule({ ...rule, replace: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    접두사
                    <input
                      aria-label="이름 접두사"
                      value={rule.prefix}
                      onChange={(event) =>
                        setRule({ ...rule, prefix: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    접미사
                    <input
                      aria-label="이름 접미사"
                      value={rule.suffix}
                      onChange={(event) =>
                        setRule({ ...rule, suffix: event.target.value })
                      }
                    />
                  </label>
                </div>
                <div className="rename-options">
                  <label>
                    <input
                      type="checkbox"
                      checked={rule.regex}
                      onChange={(event) =>
                        setRule({ ...rule, regex: event.target.checked })
                      }
                    />
                    RE2 정규식 · $1 캡처
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={rule.caseSensitive}
                      onChange={(event) =>
                        setRule({
                          ...rule,
                          caseSensitive: event.target.checked,
                        })
                      }
                    />
                    대소문자
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={rule.preserveExtension}
                      onChange={(event) =>
                        setRule({
                          ...rule,
                          preserveExtension: event.target.checked,
                        })
                      }
                    />
                    확장자 유지
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={rule.number}
                      onChange={(event) =>
                        setRule({ ...rule, number: event.target.checked })
                      }
                    />
                    번호 추가
                  </label>
                  {rule.number && (
                    <>
                      <label>
                        시작
                        <input
                          aria-label="시작 번호"
                          type="number"
                          min="0"
                          max="1000000"
                          value={rule.start}
                          onChange={(event) =>
                            setRule({
                              ...rule,
                              start: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label>
                        자릿수
                        <input
                          aria-label="번호 자릿수"
                          type="number"
                          min="1"
                          max="8"
                          value={rule.padding}
                          onChange={(event) =>
                            setRule({
                              ...rule,
                              padding: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                    </>
                  )}
                </div>
                {previewError && (
                  <p role="alert" className="error-text">
                    {previewError}
                  </p>
                )}
                <div className="rename-preview">
                  <table>
                    <thead>
                      <tr>
                        <th>현재 이름</th>
                        <th>변경할 이름</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((entry, index) => (
                        <tr key={entry.id}>
                          <td>{entry.name}</td>
                          <td>{preview[index] || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : dialog === "trash" ? (
              <>
                <p>
                  선택한 {entries.length}개 항목을 앱 휴지통으로 이동합니다.
                </p>
                <ul className="operation-files">
                  {entries.slice(0, 12).map((entry) => (
                    <li key={entry.id}>{entry.name}</li>
                  ))}
                </ul>
                <p className="modal-footnote">
                  각 연결 폴더의 .every-directory-trash에 보관됩니다. 추가
                  도구의 앱 휴지통에서 복원할 수 있습니다.
                </p>
              </>
            ) : dialog === "trashList" ? (
              <div className="trash-list">
                {!busy && !trash.length && <p>휴지통이 비어 있습니다.</p>}
                {trash.map((item) => (
                  <div key={item.id}>
                    <span>
                      <strong>{item.name}</strong>
                      <small>
                        {item.path} ·{" "}
                        {new Date(item.deletedAt).toLocaleString("ko-KR")}
                      </small>
                    </span>
                    <button
                      className="button secondary small"
                      disabled={blocked}
                      onClick={async () => {
                        if (
                          await perform(
                            { action: "restore", trashId: item.id },
                            "원래 위치로 복원했습니다.",
                            false,
                          )
                        )
                          await loadDetails("trashList");
                      }}
                    >
                      복원
                    </button>
                  </div>
                ))}
              </div>
            ) : dialog === "properties" ? (
              properties && (
                <div className="properties-list">
                  {properties.cached && (
                    <p className="modal-footnote">
                      폴더 크기와 항목 수는 저장된 인덱스 기준입니다.{" "}
                      {properties.indexedAt
                        ? `최근 갱신: ${new Date(properties.indexedAt).toLocaleString("ko-KR")}`
                        : ""}
                    </p>
                  )}
                  <p>
                    <strong>경로</strong>
                    <span>{properties.path}</span>
                  </p>
                  <p>
                    <strong>내용</strong>
                    <span>
                      파일 {properties.files}개 · 폴더 {properties.directories}
                      개
                    </span>
                  </p>
                  <p>
                    <strong>크기</strong>
                    <span>
                      {formatSize(properties.bytes)} (
                      {properties.bytes.toLocaleString()} 바이트)
                    </span>
                  </p>
                  <p>
                    <strong>수정일</strong>
                    <span>
                      {new Date(properties.modified).toLocaleString("ko-KR")}
                    </span>
                  </p>
                  {entries[0]?.kind === "file" && (
                    <>
                      <button
                        className="button secondary small"
                        disabled={busy}
                        onClick={() => void loadDetails("properties", true)}
                      >
                        SHA-256 계산
                      </button>
                      {properties.sha256 && <pre>{properties.sha256}</pre>}
                    </>
                  )}
                </div>
              )
            ) : (
              <form
                id="file-operation-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <label className="operation-name">
                  {dialog === "unzip" ? "새 압축 해제 폴더" : "이름"}
                  <input
                    autoFocus
                    aria-label="작업 이름"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <p className="modal-footnote">
                  같은 이름이 있으면 작업을 중단합니다.
                  {dialog === "unzip"
                    ? ` ZIP 해제: 최대 10,000개·${isDesktop ? "500MB" : "2GB"}.`
                    : ""}
                </p>
              </form>
            )}
            {busy && (
              <p className="operation-progress" role="status">
                <LoaderCircle className="spin" size={16} />
                작업 중입니다. 완료 후 목록을 갱신합니다.
              </p>
            )}
            {!["properties", "trashList"].includes(dialog) && (
              <button
                className={`button ${dialog === "trash" ? "danger" : "primary"} full-width`}
                disabled={
                  blocked ||
                  !!previewError ||
                  (dialog === "batchRename" && !preview.length)
                }
                onClick={() => void submit()}
              >
                {busy
                  ? "처리 중"
                  : dialog === "batchRename"
                    ? "미리보기대로 적용"
                    : titles[dialog]}
              </button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
