import { FileIndex } from "../src/search";
import type { FileEntry, SearchOptions } from "../src/types";

// 반복 가능한 합성 파일 목록에서 검색 지연을 측정한다.
function benchmark() {
  const count = Number(process.argv[2] || 100_000);
  const entries: FileEntry[] = Array.from({ length: count }, (_, n) => ({
    id: String(n),
    rootId: `root-${n % 4}`,
    name: `${n % 7 === 0 ? "프로젝트_보고서" : "design-reference"}_${n}.${n % 3 === 0 ? "pdf" : "tsx"}`,
    path: `Projects/group-${n % 100}/design-reference_${n}.pdf`,
    parent: `Projects/group-${n % 100}`,
    kind: "file",
    extension: n % 3 === 0 ? "pdf" : "tsx",
  }));
  const index = new FileIndex();
  const start = performance.now();
  index.replace(entries);
  const buildMs = performance.now() - start;
  const queries: Partial<SearchOptions>[] = [
    { query: "보고서" },
    { query: "design-reference" },
    { query: "99999" },
    { query: "a" },
    { query: "프로젝트 ext:pdf" },
    { query: "group-13", fullPath: true },
    { query: "" },
    { query: "*보고서*.pdf", mode: "wildcard" },
    { query: "*????.pdf", mode: "wildcard" },
    { query: String.raw`보고서.*\.pdf$`, mode: "regex" },
    { query: "(a+)+$", mode: "regex" },
    { query: "desgin", mode: "fuzzy" },
    { query: "ㅂㄱㅅ", mode: "initials" },
  ];
  const results = queries.map((options) => {
    const durations: number[] = [];
    let total = 0;
    let partial = false;
    for (let i = 0; i < 30; i++) {
      const result = index.search({
        query: "",
        category: "all",
        rootId: "",
        fullPath: false,
        ...options,
      });
      durations.push(result.elapsed);
      total = result.total;
      partial ||= !!result.partial;
    }
    durations.sort((a, b) => a - b);
    return {
      mode: options.mode || "normal",
      partial,
      query: options.query || "(all)",
      fullPath: !!options.fullPath,
      total,
      medianMs: +durations[15].toFixed(2),
      p95Ms: +durations[28].toFixed(2),
      maxMs: +durations[29].toFixed(2),
    };
  });
  console.log(
    JSON.stringify(
      {
        entries: count,
        buildMs: +buildMs.toFixed(2),
        runtime: process.version,
        note: "Synthetic in-memory engine benchmark; excludes disk scan, HTTP transport, and UI rendering.",
        results,
      },
      null,
      2,
    ),
  );
  if (results.some((result) => result.p95Ms >= 1000 || result.partial))
    process.exitCode = 1;
}

benchmark();
