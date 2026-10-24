import type { ExplorerPane, ExplorerTab, Location } from "./types";

export function tabColor(color: unknown): string | undefined {
  return typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)
    ? color
    : undefined;
}

// 새 탭은 색상을 상속하지 않고 독립적인 이동 기록으로 시작한다.
export function createTab(location: Location): ExplorerTab {
  return { id: crypto.randomUUID(), history: [{ ...location }], cursor: 0 };
}

export function createPane(location: Location): ExplorerPane {
  const tab = createTab(location);
  return {
    id: crypto.randomUUID(),
    tabs: [tab],
    activeTab: tab.id,
    view: "list",
  };
}
