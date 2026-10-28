import assert from "node:assert/strict";
import test from "node:test";
import { clipTime } from "../src/clipTime";

test("clipboard times read as relative Korean labels", () => {
  const now = new Date(2026, 9, 28, 15, 30).getTime();
  assert.equal(clipTime(now - 20_000, now), "방금");
  assert.equal(clipTime(now - 5 * 60_000, now), "5분 전");
  assert.match(clipTime(new Date(2026, 9, 28, 9, 5).getTime(), now), /^오늘 /);
  assert.match(clipTime(new Date(2026, 9, 27, 22, 0).getTime(), now), /^어제 /);
  assert.match(clipTime(new Date(2026, 9, 20, 8, 0).getTime(), now), /10월 20일/);
});
