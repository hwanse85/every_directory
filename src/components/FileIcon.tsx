import {
  Archive,
  Braces,
  File,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  Presentation,
} from "lucide-react";
import { categoryOf } from "../search";
import type { FileEntry } from "../types";

// 파일 형식에 맞는 색상과 아이콘을 표시한다.
export function FileIcon({
  entry,
  large = false,
}: {
  entry: FileEntry;
  large?: boolean;
}) {
  const category = categoryOf(entry);
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
                  ? FileAudio
                  : category === "archive"
                    ? Archive
                    : File;
  return (
    <span
      className={`file-icon ${entry.kind === "directory" ? "folder" : entry.extension === "pdf" ? "pdf" : category} ${large ? "large" : ""}`}
    >
      <Icon size={large ? 32 : 19} strokeWidth={1.7} />
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
