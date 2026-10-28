import { useState } from "react";
import {
  Archive,
  Braces,
  File,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  Presentation,
} from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { categoryOf } from "../search";
import { fileUrl, isDesktop, isMac } from "../client";
import type { FileEntry } from "../types";

// 파일마다 아이콘이 다른 형식이다. 나머지는 확장자별 공용 아이콘을 한 번만 받아 공유한다.
const ownIconExtensions = isMac
  ? new Set(["icns"])
  : new Set(["exe", "lnk", "ico", "url", "scr", "cpl", "msc", "appref-ms", "cur", "ani"]);
const macBundle = /\.(app|bundle|framework|prefpane|plugin|kext|appex|xpc|qlgenerator|saver)$/i;
const thumbnailExtensions = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);
const loaded = new Set<string>();
// 색인 전 새 파일처럼 잠시 실패한 주소는 몇 초 뒤 다시 요청한다.
const failed = new Map<string, number>();
const retryAfter = 5000;

// 운영체제 아이콘 주소를 만든다. 화면 배율을 고려해 선명한 크기를 요청한다.
export function nativeIconUrl(entry: FileEntry, pixels: number): string | undefined {
  if (!isDesktop) return undefined;
  const size = Math.ceil(pixels * (window.devicePixelRatio || 1));
  const own = entry.kind === "directory" ? isMac && macBundle.test(entry.name) : ownIconExtensions.has(entry.extension);
  const target = own
    ? `file/${entry.rootId}/${entry.path}`
    : entry.kind === "directory"
      ? "folder/"
      : `ext/${entry.extension}`;
  // 파일마다 다른 아이콘은 수정 시각을 붙여 실행 파일을 바꾸면 새 아이콘을 받는다.
  return convertFileSrc(`${size}/${target}`, "edicon") + (own ? `?v=${entry.modified ?? 0}` : "");
}

// 탐색기처럼 큰 아이콘 보기에서는 이미지 파일을 미리보기 그림으로 보여 준다.
function thumbnailUrl(entry: FileEntry, pixels: number): string | undefined {
  if (pixels < 40 || entry.kind !== "file" || !thumbnailExtensions.has(entry.extension)) return undefined;
  if ((entry.size ?? 0) > 20 * 1024 * 1024) return undefined;
  return `${fileUrl(entry.rootId, entry.path)}${isDesktop ? `?v=${entry.modified ?? 0}` : ""}`;
}

// 운영체제의 실제 파일 아이콘을 표시하고, 불러오기 전·실패·웹 환경에서는 형식별 아이콘을 쓴다.
export function FileIcon({
  entry,
  large = false,
  pixels,
}: {
  entry: FileEntry;
  large?: boolean;
  pixels?: number;
}) {
  const display = pixels ?? (large ? 40 : 18);
  const thumbnail = thumbnailUrl(entry, display);
  const native = thumbnail ?? nativeIconUrl(entry, display);
  const [, setVersion] = useState(0);
  const category = categoryOf(entry);
  const failedAt = native ? failed.get(native) : undefined;
  const usable = native && (failedAt === undefined || Date.now() - failedAt > retryAfter);
  const ready = usable && loaded.has(native);
  const Icon =
    entry.kind === "directory"
      ? Folder
      : ["xls", "xlsx", "csv"].includes(entry.extension)
        ? FileSpreadsheet
        : ["ppt", "pptx"].includes(entry.extension)
          ? Presentation
          : category === "image"
            ? FileImage
            : category === "code"
              ? Braces
              : category === "document"
                ? FileText
                : category === "audio"
                  ? ["mp4", "mov", "webm", "mkv", "avi"].includes(entry.extension) ? FileVideo : FileAudio
                  : category === "archive"
                    ? Archive
                    : File;
  return (
    <span
      className={`file-icon ${entry.kind === "directory" ? "folder" : entry.extension === "pdf" ? "pdf" : category} ${large ? "large" : ""} ${ready ? "native" : ""} ${thumbnail ? "thumbnail" : ""}`}
      style={pixels ? { width: pixels, height: pixels } : undefined}
    >
      {!ready && <Icon size={Math.round(display * (large ? 0.8 : 0.95))} strokeWidth={1.6} />}
      {usable && (
        <img
          src={native}
          alt=""
          draggable={false}
          decoding="async"
          loading={thumbnail ? "lazy" : undefined}
          hidden={!ready}
          onLoad={() => {
            if (!loaded.has(native)) {
              loaded.add(native);
              setVersion((value) => value + 1);
            }
          }}
          onError={() => {
            failed.set(native, Date.now());
            setVersion((value) => value + 1);
            setTimeout(() => setVersion((value) => value + 1), retryAfter + 100);
          }}
        />
      )}
    </span>
  );
}

// 읽기 쉬운 파일 크기를 반환하고 미수집 값은 구분해서 표시한다.
export function formatSize(bytes?: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
