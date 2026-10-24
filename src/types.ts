export type FileCategory =
  "all" | "document" | "image" | "folder" | "code" | "audio" | "archive";
export type SearchMode = "normal" | "wildcard" | "regex" | "fuzzy" | "initials";
export type Placement = "left" | "right" | "top" | "bottom";
export type Arrangement = "column" | "row" | "grid";

export interface FileEntry {
  id: string;
  rootId: string;
  name: string;
  path: string;
  parent: string;
  kind: "file" | "directory";
  extension: string;
  size?: number;
  modified?: number;
}

export interface ConnectedRoot {
  id: string;
  name: string;
  absolutePath?: string;
  watchError?: string;
  count: number;
  lastIndexed: number;
  skipped: number;
  demo?: boolean;
}

export interface Location {
  rootId: string;
  path: string;
}

export interface ExplorerTab {
  id: string;
  history: Location[];
  cursor: number;
  color?: string;
}

export interface ExplorerPane {
  id: string;
  tabs: ExplorerTab[];
  activeTab: string;
  view: "list" | "grid";
}

export interface SearchOptions {
  query: string;
  mode?: SearchMode;
  caseSensitive?: boolean;
  category: FileCategory;
  rootId: string;
  fullPath: boolean;
  limit?: number;
}

export interface SearchResult {
  entries: FileEntry[];
  total: number;
  elapsed: number;
  partial?: boolean;
  scanned?: number;
}

export interface IndexProgress {
  rootId: string;
  count: number;
  directory: string;
}

export interface Favorite extends Location {
  name: string;
  kind?: "file" | "directory";
}

export interface QuickAccess {
  initialized: boolean;
  favorites: Favorite[];
  opened: (Favorite & { openedAt: number })[];
  recent: string[];
}

export interface QuickSuggestions {
  access: QuickAccess;
  warning?: string;
  entries: FileEntry[];
  roots: ConnectedRoot[];
}

export interface FileClipboard {
  entries: Location[];
  cut: boolean;
}

export interface RenameRule {
  find: string;
  replace: string;
  regex: boolean;
  caseSensitive: boolean;
  preserveExtension: boolean;
  prefix: string;
  suffix: string;
  number: boolean;
  start: number;
  padding: number;
}

export interface TrashItem {
  id: string;
  rootId: string;
  path: string;
  name: string;
  deletedAt: number;
}

export interface FileProperties {
  path: string;
  files: number;
  directories: number;
  bytes: number;
  modified: number;
  sha256?: string;
  cached?: boolean;
  indexedAt?: number;
}

export interface ImageResizeOptions {
  width: number;
  height: number;
  fit: "inside" | "cover" | "fill";
  format: "png" | "jpeg" | "webp";
  enlarge: boolean;
}

export interface OcrResult {
  text: string;
  confidence: number;
}

export interface ToolRequest {
  id: number;
  entry?: FileEntry;
  action:
    | "batchRename"
    | "preview"
    | "resizeImages"
    | "ocr"
    | "open"
    | "reveal"
    | "trashList"
    | "copy"
    | "cut"
    | "paste"
    | "mkdir"
    | "rename"
    | "trash"
    | "zip"
    | "unzip"
    | "properties"
    | "mkfile"
    | "duplicate"
    | "hash"
    | "terminal"
    | "openNewTab"
    | "openOtherPane"
    | "copyOtherPane"
    | "moveOtherPane"
    | "copyPath"
    | "copyName"
    | "copyRelativePath"
    | "copyMarkdown"
    | "selectAll"
    | "invertSelection"
    | "toggleHidden"
    | "refresh"
    | "favorite"
    | "stats"
    | "duplicates"
    | "compare"
    | "exportList";
}

export type FileAction =
  | "mkdir"
  | "mkfile"
  | "duplicate"
  | "terminal"
  | "rename"
  | "batchRename"
  | "copy"
  | "move"
  | "trash"
  | "restore"
  | "zip"
  | "unzip"
  | "properties"
  | "hash"
  | "reveal"
  | "open"
  | "resizeImages"
  | "ocr";
export interface FileOperation {
  action: FileAction;
  entries?: Location[];
  destination?: Location;
  name?: string;
  rule?: RenameRule;
  trashId?: string;
  image?: ImageResizeOptions;
  language?: "kor+eng" | "eng" | "kor";
}
