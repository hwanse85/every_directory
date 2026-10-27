import type { SearchColumn } from "./searchColumns";

export type ColumnWidths = Partial<Record<SearchColumn, number>>;
export interface TableColumn { id: SearchColumn; label: string; width: number }

export function minimumColumnWidth(id: SearchColumn): number {
  return id === "name" ? 100 : id === "fullPath" ? 120 : id === "modified" ? 100 : id === "location" || id === "root" ? 90 : 60;
}
export function clampColumnWidth(id: SearchColumn, width: number): number {
  return Math.round(Math.max(minimumColumnWidth(id), Math.min(2000, width)));
}
export function normalizeColumnWidths(value: unknown): ColumnWidths {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: ColumnWidths = {};
  for (const id of ["name", "location", "type", "extension", "size", "modified", "created", "accessed", "attributes", "root", "fullPath"] as const) {
    const width = (value as ColumnWidths)[id];
    if (typeof width === "number" && Number.isFinite(width)) result[id] = clampColumnWidth(id, width);
  }
  return result;
}
// Unconfigured tables fill their pane. Once resized, pixel widths stay stable across pane changes.
export function resolveColumnWidths(columns: readonly TableColumn[], saved: ColumnWidths, viewport: number): number[] {
  const widths = columns.map(column => saved[column.id] ?? column.width);
  const flexible = columns.map((column, index) => ({column, index})).filter(({column}) => saved[column.id] === undefined && (column.id === "name" || column.id === "location"));
  const extra = Math.max(0, viewport - 48 - widths.reduce((sum, width) => sum + width, 0));
  for (const {index} of flexible) widths[index] += extra / flexible.length;
  return widths.map(Math.round);
}
