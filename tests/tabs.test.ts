import test from "node:test";
import assert from "node:assert/strict";
import { createPane, createTab, tabColor } from "../src/tabs";

test("the first tab and every new tab have no assigned color or shared history", () => {
  const location = { rootId: "root", path: "문서" };
  const pane = createPane(location);
  pane.tabs[0].color = "#6389c6";
  const next = createTab(pane.tabs[0].history[0]);
  assert.equal(next.color, undefined);
  assert.equal(tabColor(createPane(location).tabs[0].color), undefined);
  assert.notEqual(next.id, pane.tabs[0].id);
  location.path = "변경";
  assert.equal(next.history[0].path, "문서");
  assert.equal(pane.tabs[0].history[0].path, "문서");
  for (const value of [null, "", "red", "#123", "#6389c622", undefined])
    assert.equal(tabColor(value), undefined);
  assert.equal(tabColor("#6389c6"), "#6389c6");
});
