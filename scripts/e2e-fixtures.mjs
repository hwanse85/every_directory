import {execFileSync} from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import sharp from "sharp";
import yazl from "yazl";

// 압축 안에 XML을 넣은 문서(docx·xlsx·pptx·hwpx)를 만든다.
async function officeFile(file, entries) {
  const zip = new yazl.ZipFile();
  for (const [name, text] of entries) zip.addBuffer(Buffer.from(text), name);
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(file));
}

// 한글 본문(계약 해지 조건)을 2바이트 글꼴 + ToUnicode 표로 담은 PDF
function koreanPdf() {
  const codes = { "계": "ACC4", "약": "C57D", " ": "0020", "해": "D574", "지": "C9C0", "조": "C870", "건": "AC74" };
  const keys = Object.keys(codes);
  const text = "계약 해지 조건";
  const hex = [...text].map((c) => (keys.indexOf(c) + 1).toString(16).padStart(4, "0")).join("");
  const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n1 begincodespacerange <0000> <FFFF> endcodespacerange\n${keys.length} beginbfchar\n${keys.map((c, i) => `<${(i + 1).toString(16).padStart(4, "0")}> <${codes[c]}>`).join("\n")}\nendbfchar\nendcmap`;
  const content = `BT /F1 12 Tf 72 700 Td <${hex}> Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type0 /BaseFont /Korean /Encoding /Identity-H /ToUnicode 6 0 R >>",
    `<< /Length ${Buffer.byteLength(cmap)} >>\nstream\n${cmap}\nendstream`,
  ];
  let result = "%PDF-1.4\n";
  objects.forEach((object, index) => {
    result += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  return result + "trailer\n<< /Root 1 0 R >>\n%%EOF\n";
}

// 본문 검색 검증 문서: 이름에는 없고 본문에만 ‘계약 해지’가 있다.
async function contentFixtures(folder) {
  await mkdir(folder, { recursive: true });
  await officeFile(path.join(folder, "초안 문서.docx"), [["word/document.xml", "<w:document><w:body><w:p><w:r><w:t>계약 </w:t></w:r><w:r><w:t>해지 조건을 정리합니다</w:t></w:r></w:p></w:body></w:document>"]]);
  await officeFile(path.join(folder, "정산 표.xlsx"), [["xl/sharedStrings.xml", "<sst><si><t>계약 해지 위약금</t></si></sst>"]]);
  await officeFile(path.join(folder, "발표 자료.pptx"), [["ppt/slides/slide1.xml", "<p:sld><a:p><a:r><a:t>계약 해지 일정</a:t></a:r></a:p></p:sld>"]]);
  await officeFile(path.join(folder, "검토 의견.hwpx"), [["Contents/section0.xml", "<hs:sec><hp:p><hp:run><hp:t>계약 해지 검토</hp:t></hp:run></hp:p></hs:sec>"]]);
  await writeFile(path.join(folder, "스캔 본.pdf"), koreanPdf());
  // CP949(EUC-KR)로 저장한 메모: 계약 해지
  await writeFile(path.join(folder, "옛날 메모.txt"), Buffer.from([0xb0, 0xe8, 0xbe, 0xe0, 0x20, 0xc7, 0xd8, 0xc1, 0xf6]));
}

// PDF 렌더러 검증용 최소 3페이지 문서. 각 객체의 실제 바이트 위치로 xref를 만든다.
function pdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>",
  ];
  for (let i = 0; i < 3; i++) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 9 0 R >> >> >>`,
    );
    const content = `BT /F1 18 Tf 60 700 Td (E2E page ${i + 1}) Tj ET`;
    objects.push(
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    );
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let result = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(result));
    result += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(result);
  result +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
      .join("");
  result += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF\n`;
  return result;
}
// 첫 실행 추천 폴더 검증용 폴더 두 개를 만들고 경로를 돌려준다.
export async function suggestedFolders(base) {
  const folders = [path.join(base, "추천 문서"), path.join(base, "추천 다운로드")];
  for (const [index, folder] of folders.entries()) {
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, `추천 파일 ${index + 1}.txt`), "suggested");
  }
  return folders;
}
export async function prepare(root, suite) {
  await mkdir(root, { recursive: true });
  if(suite==="history"){
    for(const folder of ["대상","$Recycle.Bin/a",".hidden","문서/경로 보고서"])await mkdir(path.join(root,folder),{recursive:true});
    for(const name of ["업무 보고서.txt","$budget.txt","~$lock.docx","cache.tmp","native-hidden.txt","$Recycle.Bin/a/deleted.txt",".hidden/secret.txt","문서/경로 보고서/보관.txt"])await writeFile(path.join(root,name),"history fixture");
    // 운영체제 숨김 표시: Windows는 숨김 속성, macOS는 Finder 숨김 플래그
    if(process.platform==="win32")execFileSync("attrib.exe",["+H",path.join(root,"native-hidden.txt")],{windowsHide:true});
    else execFileSync("chflags",["hidden",path.join(root,"native-hidden.txt")]);
    return;
  }
  if(suite==="ux"){
    for(const folder of ["가 폴더/하위","나 폴더"])await mkdir(path.join(root,folder),{recursive:true});
    for(const name of ["가 폴더/하위/내용.txt","다 문서.txt","사 삭제용.txt","아 이름변경.txt","자 마지막.txt"])await writeFile(path.join(root,name),`ux ${name}`);
    await writeFile(path.join(root,"라 계산.xlsx"),"xlsx placeholder");
    await writeFile(path.join(root,"마 보고서.pdf"),pdf());
    await sharp({create:{width:96,height:64,channels:3,background:"#2f7fd8"}}).png().toFile(path.join(root,"바 그림.png"));
    return;
  }
  if(suite==="explorer"){
    for(const folder of ["문서/하위","비공개/하위","대상"])await mkdir(path.join(root,folder),{recursive:true});
    await writeFile(path.join(root,"업무 보고서.txt"),"미리보기 검증\n".repeat(60));
    await writeFile(path.join(root,"문서/하위/보관.txt"),"자료");
    await writeFile(path.join(root,"비공개/하위/제외 검증.txt"),"검색 제외 · 탐색 유지");
    await writeFile(path.join(root,"안내.pdf"),pdf());
    await sharp({create:{width:320,height:180,channels:3,background:"#6389c6"}}).png().toFile(path.join(root,"이미지.png"));
    // 색인하지 않은 위치(이 PC)의 탐색·작업 검증용. 연결 폴더 바깥(같은 임시 폴더)에 둔다.
    await mkdir(path.join(path.dirname(root),"색인 밖 폴더","하위"),{recursive:true});
    await writeFile(path.join(path.dirname(root),"색인 밖 폴더","바깥 파일.txt"),"색인 밖 원본");
    return;
  }
  if(suite==="audit"){
    await mkdir(path.join(root,"대상"));
    await Promise.all(Array.from({length:1205},(_,n)=>writeFile(path.join(root,`audit_${String(n).padStart(4,"0")}.txt`),"x".repeat(n+1))));
    return;
  }
  if(suite==="tree"){
    for(const folder of ["문서/2026/분기","깊은 폴더/설계 검토/기계 계통/배관 해석/최종 보고서/첨부 자료/도면 원본","문서함/개인","대상/보관",".숨김/내부"])
      await mkdir(path.join(root,folder),{recursive:true});
    await writeFile(path.join(root,"문서/2026/분기/업무 보고서.txt"),"트리 검증용 예시");
  }
  if (suite === "drag") await writeFile(path.join(path.dirname(root), "외부 드롭.txt"), "외부 원본");
  if (suite === "windows") {
    await mkdir(path.join(root, "Reports", "하위"), { recursive: true });
    await writeFile(path.join(root, "Reports", "원본.txt"), "원본");
    await writeFile(path.join(root, "Reports", "a.txt"), "a");
    await writeFile(path.join(root, "Reports", "z.txt"), "z");
    await writeFile(path.join(root, ".hidden.txt"), "hidden");
    return;
  }
  if (suite === "desktop") {
    for (const name of ["문서", "이미지", "정리함"])
      await mkdir(path.join(root, name));
    await writeFile(
      path.join(root, "문서", "업무 보고서 2026.txt"),
      "한글 검색과 미리보기\n".repeat(50),
    );
    await writeFile(path.join(root, "문서", "회의록.md"), "회의록");
    await writeFile(path.join(root, "문서", "개발 계획.pdf"), pdf());
    await sharp({
      create: { width: 320, height: 180, channels: 3, background: "#6389c6" },
    })
      .png()
      .toFile(path.join(root, "이미지", "작업 화면.png"));
  } else {
    await mkdir(path.join(root, "대상"), {recursive:true});
    await mkdir(path.join(root, "문서"), {recursive:true});
    await writeFile(path.join(root, "업무 보고서.txt"), "한글 원본 내용");
    await writeFile(path.join(root, "쏠리마인드.txt"), "된소리 검색");
    await writeFile(path.join(root, "README.md"), "# readme");
    await writeFile(path.join(root, "문서", "메모.txt"), "메모");
    if (suite === "quick") {
      await writeFile(path.join(root, "문서", "YK5 정산표.xlsx"), "xlsx placeholder");
      await writeFile(path.join(root, "문서", "MyBigReport.pdf"), "acronym fixture");
      // 사용자 동작이 셸을 거치지 않는지 확인하는 위험한 이름(Windows에서도 쓸 수 있는 글자만)
      await writeFile(path.join(root, "주입 시험; touch hacked && echo $(id).txt"), "injection fixture");
    }
    // 검색 방식(와일드카드·정규식·퍼지·연산자) 검증용 이름
    if (suite === "search") await contentFixtures(path.join(root, "본문"));
    if (suite === "search")
      for (const name of ["IMG_0042.jpg", "IMG_12.jpg", "회의록_2026-03.docx", "Invoice_2025.PDF", "프로젝트 계획서.hwp", "configuration.json", "업무 계획.txt", "MyBigReport.pdf"])
        await writeFile(path.join(root, "문서", name), "search fixture");
    if (suite === "actions")
      await sharp({
        create: { width: 320, height: 180, channels: 3, background: "#6389c6" },
      })
        .png()
        .toFile(path.join(root, "이미지.png"));
    if (suite === "grid")
      await Promise.all(
        Array.from({ length: 310 }, (_, n) =>
          writeFile(
            path.join(root, `zzgrid_${String(n).padStart(4, "0")}.txt`),
            String(n),
          ),
        ),
      );
  }
}
