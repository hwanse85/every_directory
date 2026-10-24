import path from "node:path";
import { createRequire } from "node:module";
import { copyFile, lstat, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import os from "node:os";
import sharp from "sharp";
import { createWorker, OEM, type Worker } from "tesseract.js";
import type { ImageResizeOptions, OcrResult } from "../src/types";
import { validateName } from "../src/rename";

const require = createRequire(import.meta.url);
let recognizing = false;

// 이미지 형식·파일 크기·픽셀 수를 제한한 디코더를 준비한다.
async function imageInput(filename: string) {
  const info = await lstat(filename);
  if (!info.isFile() || info.size > 50 * 1024 * 1024)
    throw new Error("50MB 이하의 PNG·JPEG·WebP 파일을 선택해 주세요.");
  const input = sharp(filename, { limitInputPixels: 40_000_000 });
  const metadata = await input.metadata();
  if (
    !["png", "jpeg", "webp"].includes(metadata.format ?? "") ||
    (metadata.pages ?? 1) > 1
  )
    throw new Error("정지 이미지 PNG·JPEG·WebP만 지원합니다.");
  return input.autoOrient();
}

// 변환한 사본을 새 폴더에 모아 원본과 기존 파일을 보존한다.
export async function resizeImages(
  sources: string[],
  destination: string,
  name: string,
  options: ImageResizeOptions,
): Promise<{ count: number; names: string[] }> {
  validateName(name);
  if (!sources.length || sources.length > 50)
    throw new Error("이미지를 1~50개 선택해 주세요.");
  if (
    !options ||
    ![options.width, options.height].every(
      (value) => Number.isInteger(value) && value >= 1 && value <= 8192,
    ) ||
    options.width * options.height > 40_000_000
  )
    throw new Error(
      "가로·세로는 1~8192 픽셀, 총 4천만 픽셀 이하로 지정해 주세요.",
    );
  if (
    !["inside", "cover", "fill"].includes(options.fit) ||
    !["png", "jpeg", "webp"].includes(options.format)
  )
    throw new Error("이미지 크기 맞춤 방식과 저장 형식을 확인해 주세요.");
  const names = sources.map(
    (source) =>
      `${path.basename(source, path.extname(source))}.${options.format === "jpeg" ? "jpg" : options.format}`,
  );
  names.forEach(validateName);
  if (new Set(names.map((item) => item.toLowerCase())).size !== names.length)
    throw new Error("변환 결과의 파일 이름이 중복됩니다.");
  // 최종 폴더를 먼저 독점 생성하여 기존 결과를 덮어쓰지 않는다.
  const target = path.join(destination, name);
  await mkdir(target);
  let staging: string | undefined;
  try {
    staging = await mkdtemp(path.join(destination, ".ed-work-"));
    for (let index = 0; index < sources.length; index++) {
      const input = await imageInput(sources[index]);
      await input
        .resize(options.width, options.height, {
          fit: options.fit,
          withoutEnlargement: !options.enlarge,
        })
        .toFormat(options.format)
        .toFile(path.join(staging, names[index]));
    }
    for (const item of names)
      await rename(path.join(staging, item), path.join(target, item));
    return { count: sources.length, names };
  } catch (cause) {
    await rm(target, { recursive: true, force: true });
    throw cause;
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
  }
}

// 설치된 언어 데이터를 읽어 외부 다운로드 없이 OCR 모델을 준비한다.
async function languageData(code: string, destination: string): Promise<void> {
  const directory = path.dirname(
    require.resolve(`@tesseract.js-data/${code}/package.json`),
  );
  await copyFile(
    path.join(directory, "4.0.0_best_int", `${code}.traineddata.gz`),
    path.join(destination, `${code}.traineddata.gz`),
  );
}

// 로컬 Worker 한 개에서 한글·영문을 인식하고 사용한 자원을 정리한다.
export async function extractImageText(
  source: string,
  language = "kor+eng",
): Promise<OcrResult> {
  if (!["kor+eng", "eng", "kor"].includes(language))
    throw new Error("OCR 언어를 확인해 주세요.");
  if (recognizing)
    throw new Error(
      "다른 텍스트 추출이 진행 중입니다. 완료 후 다시 시도해 주세요.",
    );
  recognizing = true;
  let worker: Worker | undefined;
  let modelDirectory: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const input = await imageInput(source);
    const buffer = await input
      .resize({
        width: 3500,
        height: 3500,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    modelDirectory = await mkdtemp(path.join(os.tmpdir(), "ed-ocr-"));
    await Promise.all(
      language.split("+").map((code) => languageData(code, modelDirectory!)),
    );
    worker = await createWorker(language, OEM.LSTM_ONLY, {
      langPath: modelDirectory,
      cacheMethod: "none",
      gzip: true,
      // Worker가 반환한 오류는 인식 Promise에서 사용자에게 전달한다.
      errorHandler: () => undefined,
    });
    const result = await Promise.race([
      worker.recognize(buffer),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "텍스트 추출이 90초를 초과했습니다. 작은 이미지로 다시 시도해 주세요.",
              ),
            ),
          90_000,
        );
      }),
    ]);
    return { text: result.data.text, confidence: result.data.confidence };
  } finally {
    clearTimeout(timer);
    try {
      await worker?.terminate();
    } finally {
      recognizing = false;
      if (modelDirectory)
        await rm(modelDirectory, { recursive: true, force: true });
    }
  }
}
