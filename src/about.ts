export const project = {
  name: "Every Directory",
  maintainer: "hwanse85 (GitHub 저장소 관리자)",
  repository: "https://github.com/hwanse85/every_directory",
  issues: "https://github.com/hwanse85/every_directory/issues",
};

export function componentSource(item: {
  ecosystem: string;
  name: string;
  version: string;
}): string {
  if (item.ecosystem === "cargo")
    return `https://crates.io/api/v1/crates/${encodeURIComponent(item.name)}/${encodeURIComponent(item.version)}/download`;
  const base = item.name.split("/").at(-1)!;
  return `https://registry.npmjs.org/${item.name}/-/${encodeURIComponent(base)}-${encodeURIComponent(item.version)}.tgz`;
}
