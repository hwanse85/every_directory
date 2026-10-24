import fs from "node:fs/promises";
import path from "node:path";
const metadata = JSON.parse(
  (
    await fs.readFile(
      process.argv[2] ?? "output/e2e/cargo-metadata.json",
      "utf8",
    )
  ).replace(/^\uFEFF/, ""),
);
const marker = "\nWINDOWS DEPENDENCY LICENSE SUPPLEMENT\n";
const original = (await fs.readFile("THIRD_PARTY_NOTICES.txt", "utf8")).replace(/\r\n/g, "\n").split(
  marker,
)[0];
const cache = new Map();
async function remote(url) {
  if (!cache.has(url))
    cache.set(
      url,
      fetch(url, { signal: AbortSignal.timeout(15000) }).then(
        async (response) => (response.ok ? response.text() : ""),
      ),
    );
  return cache.get(url);
}
const additions = [];
for (const item of metadata.packages) {
  const id = `cargo:${item.name}@${item.version}`;
  if (item.name === "every-directory" || original.includes(`${id} (`)) continue;
  const dir = path.dirname(item.manifest_path);
  const vcs = JSON.parse(
    await fs.readFile(path.join(dir, ".cargo_vcs_info.json"), "utf8"),
  );
  const repo = item.repository
    .replace(/^https:\/\/github.com\//, "")
    .replace(/\.git$/, "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo))
    throw new Error(`Unsupported repository: ${id}`);
  const names = [
    "LICENSE",
    "LICENSE.txt",
    "LICENSE-MIT",
    "LICENSE-APACHE",
    "LICENSE_MIT",
    "LICENSE_APACHE-2.0",
    "COPYING",
    "NOTICE",
  ];
  const found = await Promise.all(
    names.map(async (name) => {
      const url = `https://raw.githubusercontent.com/${repo}/${vcs.git.sha1}/${name}`;
      const text = await remote(url);
      return text ? `Source: ${url}\n${text.trim()}` : "";
    }),
  );
  const texts = found.filter(Boolean);
  if (!texts.length && item.license === "MPL-2.0") {
    const url = "https://www.mozilla.org/media/MPL/2.0/index.txt";
    const text = await remote(url);
    if (text.includes("Mozilla Public License Version 2.0"))
      texts.push(`SPDX license text source: ${url}\n${text.trim()}`);
  }
  if (!texts.length)
    throw new Error(`원본 라이선스 파일을 찾지 못했습니다: ${id}`);
  additions.push(
    `\n${"=".repeat(72)}\n${id} (upstream license files at published crate commit; SPDX: ${item.license})\nSource archive: https://crates.io/api/v1/crates/${item.name}/${item.version}/download\n${texts.join("\n\n")}\n`,
  );
}
const inventory = JSON.parse(
  await fs.readFile("src/third-party-licenses.json", "utf8"),
);
for (const item of inventory.filter((item) => item.ecosystem === "npm")) {
  const id = `npm:${item.name}@${item.version}`;
  if (original.includes(`${id} (`)) continue;
  const dir = path.join("node_modules", item.name);
  let files;
  try {
    files = await fs.readdir(dir);
  } catch {
    continue;
  }
  const texts = [];
  for (const name of files.filter((name) =>
    /^(license|licence|copying|notice)(?:[._-]|$)/i.test(name),
  )) {
    const full = path.join(dir, name);
    if ((await fs.stat(full)).isFile())
      texts.push(`${name}:\n${(await fs.readFile(full, "utf8")).trim()}`);
  }
  if (texts.length)
    additions.push(
      `\n${"=".repeat(72)}\n${id} (installed npm package license files; SPDX: ${item.license})\n${texts.join("\n\n")}\n`,
    );
}
await fs.writeFile(
  "THIRD_PARTY_NOTICES.txt",
  original +
    marker +
    "Original license and copyright notices retained from upstream sources. This supplement covers dependencies missing full root license texts in the original collection. Source archives for every listed component are available through the application's component list.\n" +
    additions.join(""),
);
console.log(`고지 보완: ${additions.length}개 구성요소`);
