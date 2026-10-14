import test from "node:test";
import assert from "node:assert/strict";
import {
  applyEdgePull,
  applyPull,
  duplicateShape,
  faceModeFromLocalNormal,
  rectFromCorners,
  sketchBounds,
  snap,
  wallFromPoints,
} from "../src/math.js";
import { createStore } from "../src/store.js";
import { parseDocument, studioSample } from "../src/catalog.js";

test("snap rounds to the modeling grid", () => {
  assert.equal(snap(1.26, 0.1), 1.3);
  assert.equal(snap(1.24, 0.1), 1.2);
  assert.equal(snap(-0.26, 0.5), -0.5);
});

test("rectangle and wall builders keep the footprint", () => {
  const slab = rectFromCorners(0, 0, 2, 1, 2.4);
  assert.deepEqual(slab, { x: 1, z: 0.5, w: 2, d: 1, h: 2.4, y: 0, rotY: 0 });
  assert.equal(rectFromCorners(0, 0, 0.01, 1, 1), null);

  const wall = wallFromPoints(0, 0, 0, 4, 2.4, 0.12);
  assert.ok(wall);
  assert.equal(wall.w, 4);
  assert.equal(wall.d, 0.12);
  assert.equal(wall.x, 0);
  assert.equal(wall.z, 2);
  assert.ok(Math.abs(wall.rotY + Math.PI / 2) < 1e-9);
});

test("push/pull keeps the opposite face fixed", () => {
  const start = { x: 0, z: 0, w: 2, d: 1, rotY: 0 };
  const pulled = applyEdgePull(start, "+x", 2, 0, 0.1);
  assert.equal(pulled.w, 3);
  assert.equal(pulled.d, 1);
  assert.equal(pulled.x, 0.5);
  assert.equal(pulled.z, 0);

  const rotated = { x: 0, z: 0, w: 4, d: 0.12, rotY: -Math.PI / 2 };
  const end = applyEdgePull(rotated, "+x", 0, 3, 0.1);
  assert.equal(end.w, 5);
  assert.ok(Math.abs(end.z - 0.5) < 1e-6);
});

test("pull distance is relative, so a short drag cannot explode a wall", () => {
  const wall = { x: 0, z: 2.06, w: 6.12, d: 0.12, h: 2.48, rotY: 0 };
  const pulled = applyPull(wall, "+z", 0.1, 0.1);
  assert.equal(pulled.d, 0.2);
  assert.ok(Math.abs(pulled.z - 2.1) < 1e-6);
  assert.equal(pulled.w, wall.w);

  const taller = applyPull(wall, "height", 0.35, 0.1);
  assert.equal(taller.h, 2.8);
  const column = applyPull({ w: 0.3, d: 0.3 }, "radius", 0.1, 0.1);
  assert.equal(column.w, 0.5);
  assert.equal(column.d, 0.5);
});

test("face normals pick the edited axis", () => {
  assert.equal(faceModeFromLocalNormal(0, 1, 0), "height");
  assert.equal(faceModeFromLocalNormal(-1, 0, 0), "-x");
  assert.equal(faceModeFromLocalNormal(0, 0.2, 0.8), "+z");
});

test("history collapses a gesture into one undo", () => {
  const store = createStore();
  store.load([{ id: "a", h: 1 }]);
  store.begin();
  store.apply([{ id: "a", h: 2 }]);
  store.apply([{ id: "a", h: 3 }]);
  store.end();
  assert.equal(store.canUndo(), true);
  assert.equal(store.get()[0].h, 3);
  assert.equal(store.undo(), true);
  assert.equal(store.get()[0].h, 1);
  assert.equal(store.redo(), true);
  assert.equal(store.get()[0].h, 3);
});

test("sample studio is a closed room with unique ids", () => {
  const shapes = studioSample();
  const ids = new Set(shapes.map((shape) => shape.id));
  assert.equal(ids.size, shapes.length);
  assert.ok(shapes.length > 15);
  const bounds = sketchBounds(shapes);
  assert.ok(bounds.width > 6 && bounds.width < 6.4);
  assert.ok(bounds.depth > 4 && bounds.depth < 4.4);
  const copy = duplicateShape(shapes[0], 0.1);
  assert.notEqual(copy.id, shapes[0].id);
  assert.equal(copy.x, shapes[0].x + 0.1);

  const parsed = parseDocument({
    name: "Imported",
    shapes: [{ kind: "box", name: "Slab", w: 1, d: 1, h: 1 }, { kind: "nope" }, { kind: "measure", x1: 0, z1: 0, x2: 1, z2: 0 }],
  });
  assert.equal(parsed.name, "Imported");
  assert.equal(parsed.shapes.length, 2);
  assert.equal(parsed.shapes[0].material, "plaster");
});
