export function snap(value, step) {
  if (!step) return value;
  const snapped = Math.round(value / step) * step;
  return Math.round(snapped * 1e6) / 1e6;
}

export function uid() {
  return crypto.randomUUID();
}

export function formatMm(meters) {
  return `${Math.round(meters * 1000)}`;
}

export function formatLength(meters) {
  const sign = meters < 0 ? "−" : "";
  const mm = Math.abs(Math.round(meters * 1000));
  if (mm >= 1000) {
    const text = (mm / 1000).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
    return `${sign}${text} m`;
  }
  return `${sign}${mm} mm`;
}

export function localOf(shape, x, z) {
  const dx = x - shape.x;
  const dz = z - shape.z;
  const c = Math.cos(shape.rotY);
  const s = Math.sin(shape.rotY);
  return {
    x: c * dx - s * dz,
    z: s * dx + c * dz,
  };
}

export function worldOf(shape, lx, lz) {
  const c = Math.cos(shape.rotY);
  const s = Math.sin(shape.rotY);
  return {
    x: shape.x + c * lx + s * lz,
    z: shape.z - s * lx + c * lz,
  };
}

export function wallFromPoints(x1, z1, x2, z2, height, thickness) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const length = Math.hypot(dx, dz);
  if (length < 0.04) return null;
  return {
    x: (x1 + x2) / 2,
    z: (z1 + z2) / 2,
    w: length,
    d: thickness,
    h: height,
    y: 0,
    rotY: Math.atan2(-dz, dx),
  };
}

export function rectFromCorners(x1, z1, x2, z2, height) {
  const w = Math.abs(x2 - x1);
  const d = Math.abs(z2 - z1);
  if (w < 0.04 || d < 0.04) return null;
  return {
    x: (x1 + x2) / 2,
    z: (z1 + z2) / 2,
    w,
    d,
    h: height,
    y: 0,
    rotY: 0,
  };
}

export function outwardAxis(shape, mode) {
  const c = Math.cos(shape.rotY || 0);
  const s = Math.sin(shape.rotY || 0);
  if (mode === "height") return { x: 0, y: 1, z: 0 };
  if (mode === "+x") return { x: c, y: 0, z: -s };
  if (mode === "-x") return { x: -c, y: 0, z: s };
  if (mode === "+z") return { x: s, y: 0, z: c };
  if (mode === "-z") return { x: -s, y: 0, z: -c };
  return { x: 1, y: 0, z: 0 };
}

export function applyPull(start, mode, delta, step) {
  const safeStep = step || 0.02;
  if (mode === "height") {
    return { h: Math.max(0.02, snap(start.h + delta, safeStep)) };
  }
  if (mode === "radius") {
    const diameter = Math.max(0.08, snap(start.w + delta * 2, safeStep));
    return { w: diameter, d: diameter };
  }
  const axis = outwardAxis(start, mode);
  const alongX = mode === "+x" || mode === "-x";
  const current = alongX ? start.w : start.d;
  const size = Math.max(0.02, snap(current + delta, safeStep));
  const shift = (size - current) / 2;
  const moved = {
    x: start.x + axis.x * shift,
    z: start.z + axis.z * shift,
  };
  return alongX
    ? { ...moved, w: size, d: start.d }
    : { ...moved, w: start.w, d: size };
}

export function applyEdgePull(start, mode, cursorX, cursorZ, step) {
  const local = localOf(start, cursorX, cursorZ);
  const alongX = mode === "+x" || mode === "-x";
  const moving = alongX ? local.x : local.z;
  const fixed =
    mode === "+x" ? -start.w / 2 : mode === "-x" ? start.w / 2 : mode === "+z" ? -start.d / 2 : start.d / 2;
  const size = Math.max(step || 0.02, snap(Math.abs(moving - fixed), step || 0.02));
  const sign = moving >= fixed ? 1 : -1;
  const center = (fixed + fixed + sign * size) / 2;
  const pos = alongX ? worldOf(start, center, 0) : worldOf(start, 0, center);
  return alongX
    ? { x: pos.x, z: pos.z, w: size, d: start.d }
    : { x: pos.x, z: pos.z, w: start.w, d: size };
}

export function faceModeFromLocalNormal(nx, ny, nz) {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  if (ay >= ax && ay >= az) return "height";
  if (ax >= az) return nx >= 0 ? "+x" : "-x";
  return nz >= 0 ? "+z" : "-z";
}

export function sketchBounds(shapes) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let count = 0;
  for (const shape of shapes) {
    if (shape.kind === "measure") continue;
    count += 1;
    const c = Math.cos(shape.rotY);
    const s = Math.sin(shape.rotY);
    const halfX = Math.abs(c) * (shape.w / 2) + Math.abs(s) * (shape.d / 2);
    const halfZ = Math.abs(s) * (shape.w / 2) + Math.abs(c) * (shape.d / 2);
    minX = Math.min(minX, shape.x - halfX);
    maxX = Math.max(maxX, shape.x + halfX);
    minZ = Math.min(minZ, shape.z - halfZ);
    maxZ = Math.max(maxZ, shape.z + halfZ);
  }
  if (!count) return null;
  return { minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ, count };
}

export function duplicateShape(shape, offset) {
  const copy = structuredClone(shape);
  copy.id = uid();
  copy.name = `${shape.name} copy`.slice(0, 48);
  if (copy.kind === "measure") {
    copy.x1 += offset;
    copy.x2 += offset;
  } else {
    copy.x += offset;
  }
  return copy;
}

export function measureLength(shape) {
  return Math.hypot(shape.x2 - shape.x1, shape.z2 - shape.z1);
}
