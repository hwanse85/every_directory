import type { ConnectedRoot, FileEntry } from "./types";

export const demoRoots: ConnectedRoot[] = [
  {
    id: "demo-projects",
    name: "Projects",
    count: 0,
    lastIndexed: 0,
    skipped: 0,
    demo: true,
  },
  {
    id: "demo-documents",
    name: "Documents",
    count: 0,
    lastIndexed: 0,
    skipped: 0,
    demo: true,
  },
  {
    id: "demo-downloads",
    name: "Downloads",
    count: 0,
    lastIndexed: 0,
    skipped: 0,
    demo: true,
  },
];

const trees: string[][] = [
  [
    "Every Directory/",
    "Every Directory/design/",
    "Every Directory/design/Brand guidelines.pdf",
    "Every Directory/design/Workspace concept.fig",
    "Every Directory/design/app-icon.svg",
    "Every Directory/design/Color palette.png",
    "Every Directory/src/",
    "Every Directory/src/App.tsx",
    "Every Directory/src/styles.css",
    "Every Directory/src/search.ts",
    "Every Directory/docs/",
    "Every Directory/docs/프로젝트 기획서.pdf",
    "Every Directory/docs/개발 노트.md",
    "Every Directory/README.md",
    "Every Directory/package.json",
    "Every Directory/tsconfig.json",
    "Website Redesign/",
    "Website Redesign/assets/",
    "Website Redesign/assets/Hero image.png",
    "Website Redesign/웹사이트 기획안.pdf",
    "Mobile App/",
    "Mobile App/사용자 리서치.pdf",
    "Mobile App/wireframe.fig",
    "Brand Assets/",
    "Brand Assets/logo-primary.svg",
    "Brand Assets/logo-symbol.png",
    "프로젝트 일정.xlsx",
  ],
  [
    "업무 문서/",
    "업무 문서/2026년 4분기 업무 계획.pdf",
    "업무 문서/주간 업무 보고.docx",
    "업무 문서/프로젝트 회의록.md",
    "업무 문서/예산 계획.xlsx",
    "개인 문서/",
    "개인 문서/독서 노트.md",
    "개인 문서/여행 계획.pdf",
    "References/",
    "References/인터페이스 레퍼런스.pdf",
    "References/Design systems.pdf",
    "회의록_2026-10-22.md",
    "프로젝트 제안서.pdf",
    "2026 포트폴리오.pdf",
    "업무 체크리스트.xlsx",
    "아이디어 노트.md",
    "계약서_최종.pdf",
    "브랜드 가이드.pdf",
  ],
  [
    "Images/",
    "Images/workspace-inspiration.jpg",
    "Images/desktop-wallpaper.png",
    "Archives/",
    "Archives/project-backup.zip",
    "Archives/brand-assets.zip",
    "Pretendard.zip",
    "사용자 가이드.pdf",
    "screenshot-2026-10-21.png",
    "sample-data.csv",
    "meeting-recording.mp3",
  ],
];

// 실제 파일과 혼동하지 않도록 분리된 체험용 파일 목록을 만든다.
export function createDemoEntries(): FileEntry[] {
  return trees.flatMap((paths, index) =>
    paths.map((raw, n) => {
      const kind = raw.endsWith("/") ? "directory" : "file";
      const path = raw.replace(/\/$/, "");
      const parts = path.split("/");
      const name = parts.pop()!;
      return {
        id: `${demoRoots[index].id}:${path}`,
        rootId: demoRoots[index].id,
        path,
        name,
        parent: parts.join("/"),
        kind,
        extension:
          kind === "file" && name.includes(".")
            ? name.split(".").pop()!.toLowerCase()
            : "",
        size: kind === "file" ? (n + 1) * 18270 : undefined,
        modified: Date.UTC(2026, 9, 22 - (n % 12), 9, 30),
      } satisfies FileEntry;
    }),
  );
}
