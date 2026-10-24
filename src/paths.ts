import type { ConnectedRoot, Location } from "./types";

// 긴 경로 접두사는 파일 엔진에서 유지하고, 화면에서는 일반 Windows 경로를 쓴다.
export function displayPath(value: string): string {
  const path = value
    .replace(/^\\\\\?\\UNC\\/i, "\\\\")
    .replace(/^\\\\\?\\(?=[a-z]:[\\/])/i, "");
  return isWindowsPath(path) ? path.replaceAll("/", "\\") : path;
}

export function isWindowsPath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path) || /^(\\\\|\/\/)[^\\/]/.test(path);
}

// 드라이브 루트·UNC·POSIX 루트를 보존하며 인덱스의 상대 경로를 붙인다.
export function joinDisplayPath(base: string, relative = ""): string {
  const path = displayPath(base);
  if (!relative) return path;
  const separator = isWindowsPath(path) ? "\\" : "/";
  const child = relative.replace(/^[\\/]+/, "").replaceAll("/", separator);
  return path ? `${path.replace(/[\\/]+$/, "")}${separator}${child}` : child;
}

export function locationPath(
  root: ConnectedRoot | undefined,
  relative = "",
): string {
  return joinDisplayPath(root?.absolutePath ?? root?.name ?? "", relative);
}

export function locationLabel(
  root: ConnectedRoot | undefined,
  relative = "",
): string {
  return joinDisplayPath(root?.name ?? "", relative);
}

// UNC 공유 경로는 file://server/share, 로컬 드라이브는 file:///C:/ 형식이다.
export function fileUri(value: string): string {
  const path = displayPath(value);
  const normalized = isWindowsPath(path) ? path.replaceAll("\\", "/") : path;
  const encoded = normalized
    .split("/")
    .map((part) =>
      encodeURIComponent(part).replace(
        /[!'()*]/g,
        (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
  if (normalized.startsWith("//")) return `file:${encoded}`;
  if (/^[a-z]:\//i.test(normalized))
    return `file:///${encoded.replace(/^([a-z])%3A/i, "$1:")}`;
  return `file://${encoded}`;
}

function cleanRelative(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length)
        throw new Error("연결 폴더 밖으로 이동할 수 없습니다.");
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

// 절대 경로는 가장 가까운 연결 폴더로, 상대 경로는 현재 연결 폴더 기준으로 연다.
export function addressLocation(
  address: string,
  roots: ConnectedRoot[],
  currentRootId: string,
): Location {
  let value = address.trim().replace(/^"(.*)"$/, "$1");
  if (!value) throw new Error("폴더 경로를 입력해 주세요.");
  value = displayPath(value).replaceAll("\\", "/");
  if (/^[a-z]:($|[^/])/i.test(value))
    throw new Error("드라이브의 절대 경로를 입력해 주세요. 예: C:\\문서");
  const windows = isWindowsPath(value);
  const absolute = windows || value.startsWith("/");
  if (absolute) {
    // .. 를 먼저 정규화해 다른 연결 폴더 또는 연결 범위 밖으로 잘못 해석하지 않는다.
    const prefix = value.startsWith("//")
      ? "//"
      : value.startsWith("/")
        ? "/"
        : "";
    const normalized = prefix + cleanRelative(value.slice(prefix.length));
    const comparable = (path: string) => (windows ? path.toLowerCase() : path);
    const candidates = roots
      .filter((root) => root.absolutePath)
      .map((root) => ({
        root,
        base: displayPath(root.absolutePath!)
          .replaceAll("\\", "/")
          .replace(/\/+$/, ""),
      }))
      .sort((a, b) => b.base.length - a.base.length);
    for (const { root, base } of candidates) {
      if (
        comparable(normalized) === comparable(base) ||
        comparable(normalized).startsWith(comparable(base) + "/")
      ) {
        return {
          rootId: root.id,
          path: normalized.slice(base.length).replace(/^\/+/, ""),
        };
      }
    }
    throw new Error(
      "연결된 폴더 안의 경로를 입력해 주세요. 다른 위치는 먼저 폴더를 연결해 주세요.",
    );
  }
  const root = roots.find((item) => item.id === currentRootId);
  if (!root) throw new Error("먼저 폴더를 연결해 주세요.");
  const base = root.name;
  const compare = (path: string) =>
    isWindowsPath(root.absolutePath ?? "") ? path.toLowerCase() : path;
  const relative =
    compare(value) === compare(base)
      ? ""
      : compare(value).startsWith(compare(base) + "/")
        ? value.slice(base.length + 1)
        : value;
  return { rootId: root.id, path: cleanRelative(relative) };
}
