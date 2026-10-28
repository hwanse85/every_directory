import {execFileSync} from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

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
export async function prepare(root, suite) {
  await mkdir(root, { recursive: true });
  if(suite==="history"){
    for(const folder of ["대상","$Recycle.Bin/a",".hidden","문서/경로 보고서"])await mkdir(path.join(root,folder),{recursive:true});
    for(const name of ["업무 보고서.txt","$budget.txt","~$lock.docx","cache.tmp","native-hidden.txt","$Recycle.Bin/a/deleted.txt",".hidden/secret.txt","문서/경로 보고서/보관.txt"])await writeFile(path.join(root,name),"history fixture");
    execFileSync("attrib.exe",["+H",path.join(root,"native-hidden.txt")],{windowsHide:true});
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
    return;
  }
  if(suite==="audit"){
    await mkdir(path.join(root,"대상"));
    await Promise.all(Array.from({length:1205},(_,n)=>writeFile(path.join(root,`audit_${String(n).padStart(4,"0")}.txt`),"x".repeat(n+1))));
    return;
  }
  if(suite==="tree"){
    for(const folder of ["문서/2026/분기","문서함/개인","대상/보관",".숨김/내부"])
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
