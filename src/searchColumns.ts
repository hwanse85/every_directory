import type { ConnectedRoot, FileEntry, TableSort } from "./types";
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
  {id:"created",label:"만든 날짜",width:150,hint:"파일 시스템에 기록된 생성 시각"},
  {id:"accessed",label:"액세스한 날짜",width:150,hint:"운영체제 정책에 따라 갱신되는 최근 접근 시각"},
  {id:"attributes",label:"특성",width:100,hint:"읽기 전용·숨김 등 기본 파일 특성"},
  {
    id: "fullPath",
    label: "전체 경로",
    width: 300,
    hint: "파일 이름을 포함한 전체 경로",
  },
] as const;

export type SearchColumn = (typeof searchColumnOptions)[number]["id"];
export function normalizeTableSort(value:unknown):TableSort|undefined {
  if(!value||typeof value!=="object")return undefined;
  const candidate=value as TableSort;
  return searchColumnOptions.some(column=>column.id===candidate.key)&&typeof candidate.descending==="boolean"?{key:candidate.key,descending:candidate.descending}:undefined;
}
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
    case "created":return entry.created??-1;
    case "accessed":return entry.accessed??-1;
    case "attributes":return [entry.readonly?"읽기 전용":"",entry.hidden?"숨김":""].filter(Boolean).join(" · ");
    case "root":
      return locationLabel(root);
    case "fullPath": {
      return locationPath(root, entry.path);
    }
  }
}
