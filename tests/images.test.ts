import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import sharp from "sharp";
import { LocalFiles } from "../server/service";
import { operate } from "../server/operations";
import type { ImageResizeOptions, OcrResult } from "../src/types";

const options: ImageResizeOptions = {
  width: 100,
  height: 100,
  fit: "inside",
  format: "png",
  enlarge: false,
};

// 임시 연결 폴더에 실제 PNG와 잘못된 이미지 파일을 준비한다.
async function fixture() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "ed-images-"));
  const root = path.join(temporary, "images");
  await mkdir(root);
  await sharp({
    create: { width: 320, height: 180, channels: 3, background: "#7a56d6" },
  })
    .png()
    .toFile(path.join(root, "sample.png"));
  await writeFile(path.join(root, "invalid.png"), "invalid image bytes");
  const files = new LocalFiles(path.join(temporary, "data"), false);
  await files.initialize();
  const connected = await files.scan({ absolutePath: root });
  const entry = { rootId: connected.id, path: "sample.png" };
  const destination = { rootId: connected.id, path: "" };
  return { temporary, root, files, entry, destination };
}

test("image copies preserve originals, aspect ratio and output format without overwrite", async () => {
  const f = await fixture();
  try {
    const original = await readFile(path.join(f.root, "sample.png"));
    await operate(f.files, {
      action: "resizeImages",
      entries: [f.entry],
      destination: f.destination,
      name: "small",
      image: options,
    });
    const small = await sharp(
      path.join(f.root, "small", "sample.png"),
    ).metadata();
    assert.equal(small.width, 100);
    assert.equal(small.height, 56);
    assert.deepEqual(await readFile(path.join(f.root, "sample.png")), original);
    assert.ok(
      f.files.index
        .list(f.entry.rootId, "small")
        .some((entry) => entry.name === "sample.png"),
    );
    await assert.rejects(
      operate(f.files, {
        action: "resizeImages",
        entries: [f.entry],
        destination: f.destination,
        name: "small",
        image: options,
      }),
    );
    assert.equal(
      (await sharp(path.join(f.root, "small", "sample.png")).metadata()).width,
      100,
    );
    await operate(f.files, {
      action: "resizeImages",
      entries: [f.entry],
      destination: f.destination,
      name: "cropped",
      image: { ...options, fit: "cover", format: "jpeg" },
    });
    const cropped = await sharp(
      path.join(f.root, "cropped", "sample.jpg"),
    ).metadata();
    assert.equal(cropped.width, 100);
    assert.equal(cropped.height, 100);
    assert.equal(cropped.format, "jpeg");
    await operate(f.files, {
      action: "resizeImages",
      entries: [f.entry],
      destination: f.destination,
      name: "stretch",
      image: { ...options, fit: "fill", format: "webp" },
    });
    const stretch = await sharp(
      path.join(f.root, "stretch", "sample.webp"),
    ).metadata();
    assert.equal(stretch.width, 100);
    assert.equal(stretch.height, 100);
    assert.equal(stretch.format, "webp");
    await writeFile(path.join(f.root, "second.png"), original);
    await f.files.scan({ id: f.entry.rootId });
    await operate(f.files, {
      action: "resizeImages",
      entries: [f.entry, { ...f.entry, path: "second.png" }],
      destination: f.destination,
      name: "multiple",
      image: options,
    });
    assert.deepEqual((await readdir(path.join(f.root, "multiple"))).sort(), [
      "sample.png",
      "second.png",
    ]);
    await operate(f.files, {
      action: "resizeImages",
      entries: [f.entry],
      destination: f.destination,
      name: "no-enlarge",
      image: { ...options, width: 1000, height: 1000 },
    });
    assert.equal(
      (await sharp(path.join(f.root, "no-enlarge", "sample.png")).metadata())
        .width,
      320,
    );
  } finally {
    await f.files.close();
    await rm(f.temporary, { recursive: true, force: true });
  }
});

test("image validation rejects invalid paths, dimensions and batches without partial output", async () => {
  const f = await fixture();
  try {
    for (const image of [
      { ...options, width: -1 },
      { ...options, height: 9000 },
      { ...options, width: 8192, height: 8192 },
    ])
      await assert.rejects(
        operate(f.files, {
          action: "resizeImages",
          entries: [f.entry],
          destination: f.destination,
          name: "bad",
          image,
        }),
        /픽셀/,
      );
    await assert.rejects(
      operate(f.files, {
        action: "resizeImages",
        entries: [f.entry],
        destination: f.destination,
        name: "../escape",
        image: options,
      }),
    );
    await assert.rejects(
      operate(f.files, {
        action: "resizeImages",
        entries: [f.entry, { ...f.entry, path: "invalid.png" }],
        destination: f.destination,
        name: "partial",
        image: options,
      }),
    );
    assert.deepEqual((await readdir(f.root)).sort(), [
      "invalid.png",
      "sample.png",
    ]);
    await assert.rejects(
      operate(f.files, {
        action: "ocr",
        entries: [{ ...f.entry, path: "../outside.png" }],
      }),
    );
    await assert.rejects(
      operate(f.files, {
        action: "ocr",
        entries: [{ ...f.entry, path: "invalid.png" }],
      }),
    );
  } finally {
    await f.files.close();
    await rm(f.temporary, { recursive: true, force: true });
  }
});

test("OCR recognizes an actual image with installed English and Korean models and keeps the source", async () => {
  const f = await fixture();
  try {
    const filename = path.join(f.root, "ocr.png");
    await writeFile(
      filename,
      await readFile(new URL("./fixtures/ocr-korean.png", import.meta.url)),
    );
    const original = await readFile(filename);
    await f.files.scan({ id: f.entry.rootId });
    const result = (await operate(f.files, {
      action: "ocr",
      entries: [{ ...f.entry, path: "ocr.png" }],
      language: "kor+eng",
    })) as OcrResult;
    assert.match(result.text, /Every Directory 2026/);
    assert.match(result.text, /한글\s*파일\s*검색/);
    assert.ok(result.confidence > 50);
    assert.deepEqual(await readFile(filename), original);
  } finally {
    await f.files.close();
    await rm(f.temporary, { recursive: true, force: true });
  }
});
