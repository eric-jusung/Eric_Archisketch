import { uid } from "./math.js";

export const MATERIALS = {
  plaster: { label: "Plaster", color: "#f4f0e8", roughness: 0.92 },
  ash: { label: "Ash", color: "#e6d3bc", roughness: 0.78 },
  oak: { label: "Oak", color: "#c49a5a", roughness: 0.68 },
  walnut: { label: "Walnut", color: "#6d4630", roughness: 0.55 },
  linen: { label: "Linen", color: "#f3eadf", roughness: 0.9 },
  sage: { label: "Sage", color: "#8ea48d", roughness: 0.82 },
  concrete: { label: "Concrete", color: "#c4bbb0", roughness: 0.96 },
  terracotta: { label: "Clay", color: "#e06a45", roughness: 0.74 },
  ink: { label: "Ink", color: "#243038", roughness: 0.45 },
  glass: { label: "Glass", color: "#b7dce8", roughness: 0.08, opacity: 0.38 },
};

export const TOOLS = [
  { id: "select", key: "V", label: "Select", hint: "Click a mass to inspect it. Right-drag orbits the model." },
  { id: "area", key: "A", label: "Area", hint: "Drag a rectangle on the floor. Height follows the draw setting." },
  { id: "wall", key: "W", label: "Wall", hint: "Drag a centerline. Walls are 120 mm thick." },
  { id: "column", key: "C", label: "Column", hint: "Drag outward to set the diameter." },
  { id: "push", key: "P", label: "Push/Pull", hint: "Drag a top face to change height, or a side face to stretch." },
  { id: "move", key: "G", label: "Move", hint: "Drag a mass along the floor." },
  { id: "rotate", key: "R", label: "Rotate", hint: "Drag sideways to turn in 15° steps." },
  { id: "measure", key: "M", label: "Measure", hint: "Drag between two points to read the distance." },
  { id: "erase", key: "X", label: "Erase", hint: "Click a mass to remove it." },
];

export const DRAW_HEIGHTS = [
  { mm: 100, label: "Plate" },
  { mm: 450, label: "Seat" },
  { mm: 900, label: "Counter" },
  { mm: 2400, label: "Wall" },
];

export const SNAP_STEPS = [
  { mm: 50, label: "50" },
  { mm: 100, label: "100" },
  { mm: 500, label: "500" },
];

const STORAGE_KEY = "modeling-sketch-v5";

export function loadDocument() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return parseDocument(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveDocument(doc) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
}

export function parseDocument(data) {
  const shapes = Array.isArray(data?.shapes) ? data.shapes.map(sanitizeShape).filter(Boolean) : [];
  return {
    version: 1,
    name: String(data?.name || "Untitled sketch").slice(0, 48),
    shapes,
  };
}

function sanitizeShape(shape) {
  if (!shape || typeof shape !== "object") return null;
  if (shape.kind === "measure") {
    const x1 = Number(shape.x1);
    const z1 = Number(shape.z1);
    const x2 = Number(shape.x2);
    const z2 = Number(shape.z2);
    if (![x1, z1, x2, z2].every(Number.isFinite)) return null;
    return {
      id: typeof shape.id === "string" ? shape.id : uid(),
      kind: "measure",
      name: cleanName(shape.name, "Measure"),
      x1,
      z1,
      x2,
      z2,
    };
  }
  if (shape.kind !== "box" && shape.kind !== "column") return null;
  const numeric = {
    x: Number(shape.x ?? 0),
    y: Number(shape.y ?? 0),
    z: Number(shape.z ?? 0),
    w: Number(shape.w),
    d: Number(shape.d),
    h: Number(shape.h),
    rotY: Number(shape.rotY ?? 0),
  };
  if (!Object.values(numeric).every(Number.isFinite)) return null;
  if (numeric.w <= 0 || numeric.d <= 0 || numeric.h <= 0) return null;
  return {
    id: typeof shape.id === "string" ? shape.id : uid(),
    kind: shape.kind,
    name: cleanName(shape.name, shape.kind === "column" ? "Column" : "Mass"),
    material: MATERIALS[shape.material] ? shape.material : "plaster",
    ...numeric,
  };
}

function cleanName(name, fallback) {
  const text = String(name || fallback).trim();
  return (text || fallback).slice(0, 48);
}

function box(partial) {
  return {
    id: uid(),
    kind: "box",
    y: 0,
    rotY: 0,
    material: "plaster",
    ...partial,
  };
}

export function studioSample() {
  const t = 0.12;
  const wallH = 2.48;
  const floorTop = 0.05;
  const southZ = -2.06;
  const northZ = 2.06;
  const eastX = 3.06;
  const westX = -3.06;

  return [
    box({ name: "Floor", x: 0, z: 0, w: 6, d: 4, h: floorTop, material: "ash" }),
    box({ name: "South wall, west", x: -2.13, z: southZ, w: 1.86, d: t, h: 0.42 }),
    box({ name: "South sill", x: -0.3, z: southZ, w: 1.8, d: t, h: 0.42 }),
    box({ name: "South wall, east", x: 1.83, z: southZ, w: 2.46, d: t, h: 0.42 }),
    box({ name: "North wall", x: 0, z: northZ, w: 6.12, d: t, h: wallH }),
    box({ name: "West wall", x: westX, z: 0, w: t, d: 4, h: wallH }),
    box({ name: "East wall, south", x: eastX, z: -0.925, w: t, d: 2.15, h: wallH }),
    box({ name: "Door head", x: eastX, y: 2.1, z: 0.6, w: t, d: 0.9, h: 0.38 }),
    box({ name: "East wall, north", x: eastX, z: 1.525, w: t, d: 0.95, h: wallH }),
    box({ name: "Door", x: 2.96, z: 0.6, w: 0.04, d: 0.86, h: 2.08, material: "walnut" }),
    box({ name: "Rug", x: 1.15, y: floorTop, z: -0.95, w: 2.35, d: 1.7, h: 0.012, material: "linen" }),
    box({ name: "Bed", x: -1.9, y: floorTop, z: -0.85, w: 2.05, d: 1.55, h: 0.48, material: "linen" }),
    box({ name: "Headboard", x: -2.9, y: floorTop, z: -0.85, w: 0.08, d: 1.55, h: 1.05, material: "walnut" }),
    box({ name: "Sofa", x: 1.2, y: floorTop, z: -1.35, w: 1.9, d: 0.84, h: 0.7, material: "sage" }),
    box({ name: "Coffee table", x: 1.2, y: floorTop, z: -0.45, w: 1.05, d: 0.52, h: 0.36, material: "walnut" }),
    box({ name: "Dining table", x: -1.55, y: floorTop, z: 1.05, w: 1.35, d: 0.78, h: 0.74, material: "oak" }),
    box({ name: "Bench", x: -1.55, y: floorTop, z: 0.38, w: 1.2, d: 0.32, h: 0.45, material: "oak" }),
    box({ name: "Counter", x: 1.45, y: floorTop, z: 1.62, w: 2.5, d: 0.62, h: 0.9, material: "concrete" }),
    box({ name: "Upper cabinet", x: 1.45, y: 1.5, z: 1.8, w: 2.5, d: 0.34, h: 0.62, material: "walnut" }),
    box({
      name: "Planter",
      kind: "column",
      x: 2.5,
      y: floorTop,
      z: 0.35,
      w: 0.32,
      d: 0.32,
      h: 0.9,
      material: "sage",
    }),
  ];
}
