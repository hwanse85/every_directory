import type { ConnectedRoot, FileEntry } from "./types";
import { locationLabel, locationPath } from "./paths";

export const searchColumnOptions = [
  { id: "name", label: "이름", width: 170, hint: "파일 또는 폴더 이름" },
  {
    id: "location",
    label: "위치",
    width: 150,
    hint: "연결 폴더에서의 상위 경로",
  },
  { id: "type", label: "유형", width: 100, hint: "폴더 또는 파일 형식" },
  { id: "extension", label: "확장자", width: 80, hint: "PDF, JPG, TXT 등" },
  { id: "size", label: "크기", width: 85, hint: "파일 용량" },
  {
    id: "modified",
    label: "수정일",
    width: 145,
    hint: "마지막으로 수정한 날짜와 시간",
  },
  {
    id: "root",
    label: "연결 폴더",
    width: 130,
    hint: "검색 인덱스에 연결한 폴더",
  },
  {
    id: "fullPath",
    label: "전체 경로",
    width: 300,
    hint: "파일 이름을 포함한 전체 경로",
  },
] as const;

export type SearchColumn = (typeof searchColumnOptions)[number]["id"];
export const defaultSearchColumns: SearchColumn[] = [
  "name",
  "location",
  "size",
  "modified",
];

// 저장된 열 설정을 검사하고 이름 열과 일관된 표시 순서를 보장한다.
export function normalizeSearchColumns(value: unknown): SearchColumn[] {
  if (!Array.isArray(value)) return [...defaultSearchColumns];
  return searchColumnOptions
    .filter((column) => column.id === "name" || value.includes(column.id))
    .map((column) => column.id);
}

// 인덱스에 수집된 속성으로 표시와 정렬에 사용할 값을 만든다.
export function searchColumnValue(
  entry: FileEntry,
  root: ConnectedRoot | undefined,
  column: SearchColumn,
): string | number {
  switch (column) {
    case "name":
      return entry.name;
    case "location":
      return locationLabel(root, entry.parent);
    case "type":
      return entry.kind === "directory"
        ? "폴더"
        : entry.extension
          ? `${entry.extension.toUpperCase()} 파일`
          : "파일";
    case "extension":
      return entry.kind === "directory" ? "" : entry.extension.toUpperCase();
    case "size":
      return entry.kind === "directory" ? -1 : (entry.size ?? -1);
    case "modified":
      return entry.modified ?? -1;
    case "root":
      return locationLabel(root);
    case "fullPath": {
      return locationPath(root, entry.path);
    }
  }
}
