import type {
  ConnectedRoot,
  IndexProgress,
  Location,
  SearchOptions,
  SearchResult,
  QuickAccess,
  FileClipboard,
} from "./types";
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";

export const isDesktop = isTauri();
export const supportsOCR = !isDesktop;

export interface DesktopStatus {
  keepRunning: boolean;
  shortcutError?: string;
  tray: boolean;
  visible: boolean;
  shortcut: string;
  autoStart: boolean;
  autoStartEnabled: boolean;
  autoStartError?: string;
  startInTray: boolean;
  defaultSearchMode: import("./types").SearchMode;
}

// 트레이 상태와 백그라운드 실행 설정을 네이티브 창 제어에 연결한다.
export async function desktopControl(
  action = "status",
  value?: boolean,
  shortcut?: string,
  mode?: string,
): Promise<DesktopStatus> {
  return invoke<DesktopStatus>("desktop_control", {
    action,
    value,
    shortcut,
    mode,
  });
}

// 빠른 검색창은 메인 화면과 독립적으로 표시하고 숨긴다.
export async function quickControl(
  action: string,
  location?: Location,
): Promise<void> {
  await invoke("quick_control", { action, location });
}

// 최신 요청을 우선하는 네이티브 검색을 실행한다.
export async function quickSearch(
  options: SearchOptions,
): Promise<SearchResult> {
  return invoke<SearchResult>("quick_search", { options });
}

// 경로 문자열 대신 운영체제의 실제 파일 항목을 복사한다.
export async function copyFiles(
  locations: Location[],
  cut = false,
): Promise<void> {
  await invoke("copy_files", { locations, cut });
}

// Finder·탐색기와 앱이 공유하는 파일 클립보드를 현재 폴더에 붙여넣는다.
export async function pasteFiles(
  destination: Location,
  clipboard?: FileClipboard,
): Promise<{ cut: boolean }> {
  return invoke("paste_files", { destination, clipboard });
}

// 모든 창이 공유하는 즐겨찾기와 최근 기록을 변경한다.
export async function quickAccess(
  action = "snapshot",
  payload: object = {},
): Promise<QuickAccess> {
  return invoke<QuickAccess>("ed_request", {
    kind: "quickAccess",
    payload: { ...payload, action },
  });
}

// 운영체제 클립보드에 텍스트를 복사한다.
export async function writeClipboard(text: string): Promise<void> {
  if (isDesktop) {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
  } else await navigator.clipboard.writeText(text);
}

// 사용자가 지정한 위치에 파일 사본을 저장한다.
export async function saveFileCopy(
  rootId: string,
  path: string,
  name: string,
): Promise<void> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const destination = await save({
    defaultPath: name,
    title: "파일 사본 저장",
  });
  if (destination)
    await invoke("ed_request", {
      kind: "saveCopy",
      payload: { location: { rootId, path }, destination },
    });
}

export interface ServerStatus {
  instanceId: string;
  roots: ConnectedRoot[];
  version: number;
  scanning: boolean;
  progress?: IndexProgress;
}

// Tauri 엔진 또는 기존 웹 서버의 검색과 진행 상태를 화면에 연결한다.
export class IndexClient {
  onProgress?: (progress: IndexProgress) => void;
  onUpdate?: (status: ServerStatus) => void;
  onError?: (error: Error) => void;
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private session: Promise<void>;

  // 실행 환경에 맞는 연결을 준비하고 상태 확인을 시작한다.
  constructor(pollStatus = true) {
    this.session = this.connect();
    if (pollStatus)
      void this.session.then(() => this.poll()).catch(() => undefined);
  }

  // 파일 스트리밍에 사용할 동일 오리진 세션 쿠키를 받는다.
  private async connect(): Promise<void> {
    if (isDesktop) return;
    const response = await fetch("/api/session", {
      headers: { "X-ED-Client": "1" },
    });
    if (!response.ok) throw new Error("로컬 서버에 연결하지 못했습니다.");
  }

  // 상태 요청이 겹치지 않도록 응답을 받은 뒤 다음 확인을 예약한다.
  private async poll(): Promise<void> {
    if (this.disposed) return;
    try {
      const status = await this.request<ServerStatus>("status");
      if (this.disposed) return;
      if (status.progress) this.onProgress?.(status.progress);
      this.onUpdate?.(status);
    } catch (error) {
      if (!this.disposed)
        this.onError?.(
          error instanceof Error ? error : new Error(String(error)),
        );
    } finally {
      if (!this.disposed) this.timer = setTimeout(() => void this.poll(), 1000);
    }
  }

  // API 오류를 사용자에게 표시할 수 있는 메시지로 전달한다.
  async request<T>(type: string, payload: unknown = {}): Promise<T> {
    await this.session;
    if (this.disposed) throw new Error("파일 엔진 연결이 종료되었습니다.");
    if (isDesktop) {
      const result = await invoke<T>("ed_request", {
        kind: type,
        payload,
      }).catch((error: unknown) => {
        throw new Error(String(error));
      });
      return result;
    }
    const options: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-ED-Client": "1" },
      body: JSON.stringify(payload),
    };
    let response = await fetch(`/api/${type}`, options);
    if (response.status === 401) {
      await this.connect();
      response = await fetch(`/api/${type}`, options);
    }
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "로컬 서버 요청에 실패했습니다.");
    return result as T;
  }

  // 화면 해제 시 상태 확인 예약을 정리한다.
  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
  }
}

// 연결 폴더의 파일을 미리보기 또는 다운로드 주소로 변환한다.
export function fileUrl(
  rootId: string,
  path: string,
  download = false,
): string {
  if (isDesktop) return convertFileSrc(`${rootId}/${path}`, "edfile");
  return `/api/file?${new URLSearchParams({ rootId, path, ...(download ? { download: "1" } : {}) })}`;
}
