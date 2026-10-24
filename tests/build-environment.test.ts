import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error The build wrapper is an executable JavaScript module.
import { privateBuildEnvironment } from "../scripts/build-environment.mjs";

test("private build flags preserve encoded arguments and map specific roots last", () => {
  const env = privateBuildEnvironment({CARGO_ENCODED_RUSTFLAGS:"-C\x1flink-arg=a b", RUSTFLAGS:"ignored"}, {
    home:"/Users/example",temp:"/tmp",root:"/Users/example/Project Files/app",
  });
  const flags = env.CARGO_ENCODED_RUSTFLAGS.split("\x1f");
  assert.deepEqual(flags.slice(0,2),["-C","link-arg=a b"]);
  assert.equal(env.RUSTFLAGS, undefined);
  assert.ok(flags.includes("--remap-path-prefix=/Users/example=/build/user"));
  assert.ok(flags.includes("--remap-path-prefix=/Users/example/Project Files/app=/build/every-directory"));
  assert.ok(flags.findIndex((x: string) => x.includes("Project Files/app")) > flags.findIndex((x: string) => x.includes("example=/build/user")));
});

test("Windows source remapping handles both separators and extended paths", () => {
  const env = privateBuildEnvironment({RUSTFLAGS:"-C debuginfo=0",CARGO_HOME:"C:\\Temp Tools\\cargo"}, {
    home:"C:\\Users\\example",temp:"C:\\Temp Tools",root:"C:\\Users\\example\\Project Files\\app",
  });
  const flags = env.CARGO_ENCODED_RUSTFLAGS.split("\x1f");
  assert.deepEqual(flags.slice(0,2),["-C","debuginfo=0"]);
  for (const prefix of ["C:\\Users\\example","C:/Users/example","\\\\?\\C:\\Users\\example"])
    assert.ok(flags.includes(`--remap-path-prefix=${prefix}=/build/user`));
  assert.ok(flags.includes("--remap-path-prefix=C:\\Temp Tools\\cargo=/build/cargo"));
});
