import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { MATERIALS } from "./catalog.js";
import {
  applyPull,
  faceModeFromLocalNormal,
  formatLength,
  measureLength,
  outwardAxis,
  rectFromCorners,
  snap,
  uid,
  wallFromPoints,
} from "./math.js";

const WALL_THICKNESS = 0.12;

export function createEditor(canvas, handlers) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0xefe6d6);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#efe6d6");
  scene.fog = new THREE.Fog("#efe6d6", 28, 48);

  const persp = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
  persp.position.set(8.2, 6.4, 8.4);
  const ortho = new THREE.OrthographicCamera(-8, 8, 6, -6, 0.1, 80);
  ortho.position.set(0, 40, 0);
  ortho.up.set(0, 0, -1);
  ortho.lookAt(0, 0, 0);

  const controls = new OrbitControls(persp, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.target.set(0, 0.8, 0);
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.mouseButtons = {
    LEFT: -1,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE,
  };
  controls.update();

  const hemi = new THREE.HemisphereLight(0xfff8f0, 0xe7d7c4, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e4, 0.55);
  sun.position.set(7, 12, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 40;
  sun.shadow.camera.left = -12;
  sun.shadow.camera.right = 12;
  sun.shadow.camera.top = 12;
  sun.shadow.camera.bottom = -12;
  sun.shadow.bias = -0.00035;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xfff6ee, 0.5);
  fill.position.set(-5, 7, -3);
  scene.add(fill);
  const bounce = new THREE.DirectionalLight(0xffe7d4, 0.35);
  bounce.position.set(4, 3, 6);
  scene.add(bounce);

  const grid = new THREE.GridHelper(24, 48, 0xd5c8b4, 0xe6dccb);
  grid.position.y = 0.001;
  scene.add(grid);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.ShadowMaterial({ opacity: 0.22 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const content = new THREE.Group();
  const preview = new THREE.Group();
  scene.add(content, preview);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  let shapes = [];
  let selectedId = null;
  let tool = "select";
  let view = "model";
  let snapStep = 0.1;
  let drawHeight = 2.4;
  let drawMaterial = "plaster";
  let sketchLines = true;
  let drag = null;
  let planReady = false;
  let frame = 0;

  function activeCamera() {
    return view === "plan" ? ortho : persp;
  }

  function resize() {
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    renderer.setSize(width, height, false);
    persp.aspect = width / height;
    persp.updateProjectionMatrix();
    const half = ortho.top;
    const aspect = width / height;
    ortho.left = -half * aspect;
    ortho.right = half * aspect;
    ortho.updateProjectionMatrix();
  }

  function setView(next) {
    if (next === view) return;
    view = next;
    controls.object = activeCamera();
    controls.enableRotate = view === "model";
    controls.mouseButtons.RIGHT = view === "plan" ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    if (view === "plan" && !planReady) {
      planReady = true;
      fit();
    }
    controls.update();
    handlers.onViewChange?.(view);
  }

  function fit() {
    const box = new THREE.Box3();
    if (content.children.length === 0) {
      controls.target.set(0, 0.6, 0);
      persp.position.set(8.2, 6.4, 8.4);
      ortho.position.set(0, 40, 0);
      ortho.zoom = 1;
      controls.update();
      return;
    }
    box.setFromObject(content);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.z, 1);
    controls.target.set(center.x, 0.2, center.z);
    const dist = Math.max(span * 1.15, size.y * 2.2, 4);
    persp.position.set(center.x + dist * 0.15, dist * 1.35, center.z - dist * 0.72);
    const aspect = (canvas.clientWidth || 1) / (canvas.clientHeight || 1);
    const half = Math.max(size.z, size.x / aspect, 2) * 0.68;
    ortho.top = half;
    ortho.bottom = -half;
    ortho.left = -half * aspect;
    ortho.right = half * aspect;
    ortho.zoom = 1;
    ortho.position.set(center.x, 40, center.z);
    ortho.lookAt(center.x, 0, center.z);
    ortho.updateProjectionMatrix();
    controls.update();
  }

  function sync(nextShapes, nextSelectedId) {
    shapes = nextShapes;
    selectedId = nextSelectedId;
    rebuild();
  }

  function rebuild() {
    clearGroup(content);
    for (const shape of shapes) {
      const object = buildShape(shape, shape.id === selectedId);
      object.userData.shapeId = shape.id;
      content.add(object);
    }
  }

  function buildShape(shape, selected) {
    if (shape.kind === "measure") return buildMeasure(shape, selected);
    const group = new THREE.Group();
    const material = makeMaterial(shape.material);
    let mesh;
    if (shape.kind === "column") {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(shape.w / 2, shape.w / 2, shape.h, 40), material);
    } else {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(shape.w, shape.h, shape.d), material);
    }
    mesh.position.y = shape.y + shape.h / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.shapeId = shape.id;
    group.add(mesh);
    if (sketchLines || selected) {
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry, 20),
        new THREE.LineBasicMaterial({
          color: selected ? 0xc4491d : 0x2b261f,
          transparent: true,
          opacity: selected ? 0.95 : 0.45,
        }),
      );
      edges.position.copy(mesh.position);
      edges.raycast = () => {};
      group.add(edges);
    }
    group.position.set(shape.x, 0, shape.z);
    group.rotation.y = shape.rotY || 0;
    return group;
  }

  function buildMeasure(shape, selected) {
    const group = new THREE.Group();
    const length = measureLength(shape);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(length, 0.02), 0.02, 0.03),
      new THREE.MeshStandardMaterial({
        color: selected ? 0xc4491d : 0x243038,
        roughness: 0.5,
      }),
    );
    mesh.userData.shapeId = shape.id;
    const dx = shape.x2 - shape.x1;
    const dz = shape.z2 - shape.z1;
    mesh.position.set((shape.x1 + shape.x2) / 2, 0.08, (shape.z1 + shape.z2) / 2);
    mesh.rotation.y = Math.atan2(-dz, dx);
    group.add(mesh);
    const label = makeLabel(formatLength(length), selected);
    label.position.set(mesh.position.x, 0.28, mesh.position.z);
    group.add(label);
    return group;
  }

  function makeMaterial(id) {
    const spec = MATERIALS[id] || MATERIALS.plaster;
    const material = new THREE.MeshBasicMaterial({
      color: spec.color,
      transparent: spec.opacity != null,
      opacity: spec.opacity ?? 1,
    });
    return material;
  }

  function makeLabel(text, selected) {
    const canvas = document.createElement("canvas");
    canvas.width = 384;
    canvas.height = 96;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = selected ? "#c4491d" : "rgba(28, 25, 21, 0.88)";
    roundRect(ctx, 8, 14, 368, 68, 18);
    ctx.fill();
    ctx.fillStyle = "#f7f1e6";
    ctx.font = "600 40px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 192, 48);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
    sprite.scale.set(1.15, 0.29, 1);
    sprite.raycast = () => {};
    return sprite;
  }

  function floorPoint(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, activeCamera());
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(floorPlane, hit)) return null;
    return hit;
  }

  function pickShape(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, activeCamera());
    const hits = raycaster.intersectObjects(content.children, true);
    const hit = hits.find((item) => item.object.userData.shapeId);
    if (!hit) return null;
    const shape = shapes.find((item) => item.id === hit.object.userData.shapeId);
    return shape ? { shape, face: hit.face, object: hit.object, point: hit.point.clone() } : null;
  }

  function snappedPoint(point) {
    return { x: snap(point.x, snapStep), z: snap(point.z, snapStep) };
  }

  function onLeftDown(event) {
    if (event.button !== 0) return;
    event.stopPropagation();
    canvas.setPointerCapture(event.pointerId);
    const point = floorPoint(event);
    if (tool === "area" || tool === "wall" || tool === "column" || tool === "measure") {
      if (!point) return;
      const start = snappedPoint(point);
      drag = { kind: tool, start, pointerY: event.clientY };
      return;
    }
    const picked = pickShape(event);
    if (tool === "erase") {
      if (!picked) return;
      handlers.onShapes(
        shapes.filter((shape) => shape.id !== picked.shape.id),
        "commit",
      );
      if (selectedId === picked.shape.id) handlers.onSelect(null);
      return;
    }
    if (!picked) {
      handlers.onSelect(null);
      return;
    }
    handlers.onSelect(picked.shape.id);
    if (tool === "select") return;
    if (tool === "push") {
      if (picked.shape.kind === "measure") return;
      const mode =
        picked.shape.kind === "column"
          ? Math.abs(picked.face.normal.y) > 0.65
            ? "height"
            : "radius"
          : faceModeFromLocalNormal(picked.face.normal.x, picked.face.normal.y, picked.face.normal.z);
      const axis = pushAxis(picked.shape, mode, picked.point);
      const origin = new THREE.Vector3(picked.shape.x, picked.shape.y + picked.shape.h / 2, picked.shape.z);
      drag = {
        kind: "push",
        id: picked.shape.id,
        mode,
        start: structuredClone(picked.shape),
        axis,
        origin,
        startScalar: pointerScalar(event, origin, axis) ?? 0,
      };
      handlers.onShapes(shapes, "begin");
      return;
    }
    if (tool === "move" || tool === "rotate") {
      drag = {
        kind: tool,
        id: picked.shape.id,
        start: structuredClone(picked.shape),
        point: point ? snappedPoint(point) : { x: picked.shape.x, z: picked.shape.z },
        pointerX: event.clientX,
      };
      handlers.onShapes(shapes, "begin");
    }
  }

  function onMove(event) {
    const point = floorPoint(event);
    if (!drag) {
      const picked = event.buttons === 0 ? pickShape(event) : null;
      canvas.style.cursor = cursorFor(tool, picked);
      const shown = boundedPoint(point);
      handlers.onCursor?.({
        x: shown?.x ?? null,
        z: shown?.z ?? null,
        preview: null,
      });
      return;
    }
    if (!point && drag.kind !== "push" && drag.kind !== "rotate") return;
    if (drag.kind === "area") updateAreaPreview(point);
    if (drag.kind === "wall") updateWallPreview(point);
    if (drag.kind === "column") updateColumnPreview(point);
    if (drag.kind === "measure") updateMeasurePreview(point);
    if (drag.kind === "push") updatePush(event);
    if (drag.kind === "move" && point) updateMove(point);
    if (drag.kind === "rotate") updateRotate(event);
  }

  function onUp(event) {
    if (!drag) return;
    const point = floorPoint(event);
    if (drag.kind === "area" && point) commitArea(point);
    if (drag.kind === "wall" && point) commitWall(point);
    if (drag.kind === "column" && point) commitColumn(point);
    if (drag.kind === "measure" && point) commitMeasure(point);
    endGesture();
    const shown = boundedPoint(point);
    handlers.onCursor?.({ x: shown?.x ?? null, z: shown?.z ?? null, preview: null });
  }

  function endGesture() {
    if (!drag) return;
    if (drag.kind === "push" || drag.kind === "move" || drag.kind === "rotate") {
      handlers.onShapes(shapes, "end");
    }
    drag = null;
    clearGroup(preview);
  }

  function updateAreaPreview(point) {
    const end = snappedPoint(point);
    const spec = rectFromCorners(drag.start.x, drag.start.z, end.x, end.z, drawHeight);
    showPreview(spec, drawMaterial);
    handlers.onCursor?.({
      x: end.x,
      z: end.z,
      preview: spec ? `${formatLength(spec.w)} × ${formatLength(spec.d)} · h ${formatLength(spec.h)}` : null,
    });
  }

  function updateWallPreview(point) {
    const end = snappedPoint(point);
    const spec = wallFromPoints(drag.start.x, drag.start.z, end.x, end.z, drawHeight, WALL_THICKNESS);
    showPreview(spec, drawMaterial);
    handlers.onCursor?.({
      x: end.x,
      z: end.z,
      preview: spec ? `${formatLength(spec.w)} wall · h ${formatLength(drawHeight)}` : null,
    });
  }

  function updateColumnPreview(point) {
    const end = snappedPoint(point);
    const diameter = Math.max(snap(Math.hypot(end.x - drag.start.x, end.z - drag.start.z) * 2, snapStep), snapStep);
    const spec = {
      x: drag.start.x,
      z: drag.start.z,
      y: 0,
      w: diameter,
      d: diameter,
      h: drawHeight,
      rotY: 0,
      kind: "column",
    };
    showPreview(spec, drawMaterial);
    handlers.onCursor?.({
      x: end.x,
      z: end.z,
      preview: `Ø ${formatLength(diameter)} · h ${formatLength(drawHeight)}`,
    });
    drag.diameter = diameter;
  }

  function updateMeasurePreview(point) {
    const end = snappedPoint(point);
    const length = Math.hypot(end.x - drag.start.x, end.z - drag.start.z);
    clearGroup(preview);
    if (length >= 0.04) {
      preview.add(
        buildMeasure(
          { id: "preview", kind: "measure", x1: drag.start.x, z1: drag.start.z, x2: end.x, z2: end.z },
          true,
        ),
      );
    }
    handlers.onCursor?.({
      x: end.x,
      z: end.z,
      preview: length >= 0.04 ? formatLength(length) : null,
    });
  }

  function showPreview(spec, materialId) {
    clearGroup(preview);
    if (!spec) return;
    preview.add(
      buildShape(
        {
          ...spec,
          id: "preview",
          kind: spec.kind || "box",
          material: materialId,
          name: "Preview",
        },
        true,
      ),
    );
  }

  function commitArea(point) {
    const end = snappedPoint(point);
    const spec = rectFromCorners(drag.start.x, drag.start.z, end.x, end.z, drawHeight);
    if (!spec) return;
    const shape = {
      id: uid(),
      kind: "box",
      name: nextName("Mass"),
      material: drawMaterial,
      ...spec,
    };
    handlers.onShapes([...shapes, shape], "commit");
    handlers.onSelect(shape.id);
  }

  function commitWall(point) {
    const end = snappedPoint(point);
    const spec = wallFromPoints(drag.start.x, drag.start.z, end.x, end.z, drawHeight, WALL_THICKNESS);
    if (!spec) return;
    const shape = {
      id: uid(),
      kind: "box",
      name: nextName("Wall"),
      material: drawMaterial,
      ...spec,
    };
    handlers.onShapes([...shapes, shape], "commit");
    handlers.onSelect(shape.id);
  }

  function commitColumn(point) {
    const end = snappedPoint(point);
    let diameter = drag.diameter;
    if (!diameter) {
      diameter = Math.max(snap(Math.hypot(end.x - drag.start.x, end.z - drag.start.z) * 2, snapStep), 0.2);
    }
    if (diameter < 0.08) diameter = 0.3;
    const shape = {
      id: uid(),
      kind: "column",
      name: nextName("Column"),
      material: drawMaterial,
      x: drag.start.x,
      y: 0,
      z: drag.start.z,
      w: diameter,
      d: diameter,
      h: drawHeight,
      rotY: 0,
    };
    handlers.onShapes([...shapes, shape], "commit");
    handlers.onSelect(shape.id);
  }

  function commitMeasure(point) {
    const end = snappedPoint(point);
    if (Math.hypot(end.x - drag.start.x, end.z - drag.start.z) < 0.04) return;
    const shape = {
      id: uid(),
      kind: "measure",
      name: nextName("Measure"),
      x1: drag.start.x,
      z1: drag.start.z,
      x2: end.x,
      z2: end.z,
    };
    handlers.onShapes([...shapes, shape], "commit");
    handlers.onSelect(shape.id);
  }

  function updatePush(event) {
    const scalar = pointerScalar(event, drag.origin, drag.axis);
    if (scalar == null) return;
    const patch = applyPull(drag.start, drag.mode, scalar - drag.startScalar, snapStep);
    const next = shapes.map((shape) => (shape.id === drag.id ? { ...shape, ...patch } : shape));
    handlers.onShapes(next, "apply");
    const current = next.find((shape) => shape.id === drag.id);
    handlers.onCursor?.({
      x: null,
      z: null,
      preview: current
        ? drag.mode === "radius"
          ? `Ø ${formatLength(current.w)}`
          : `${formatLength(current.w)} × ${formatLength(current.d)} · h ${formatLength(current.h)}`
        : null,
    });
  }

  function pointerScalar(event, origin, axis) {
    const viewDir = new THREE.Vector3();
    activeCamera().getWorldDirection(viewDir);
    const normal = viewDir.clone().projectOnPlane(axis);
    if (normal.lengthSq() < 1e-4) {
      const worldPerPixel =
        view === "plan"
          ? (ortho.top - ortho.bottom) / (canvas.clientHeight || 1) / (ortho.zoom || 1)
          : 0.01;
      return -event.clientY * worldPerPixel;
    }
    normal.normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, activeCamera());
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, hit)) return null;
    return hit.dot(axis);
  }

  function updateMove(point) {
    const end = snappedPoint(point);
    const dx = end.x - drag.point.x;
    const dz = end.z - drag.point.z;
    const next = shapes.map((shape) => {
      if (shape.id !== drag.id) return shape;
      if (shape.kind === "measure") {
        return {
          ...shape,
          x1: drag.start.x1 + dx,
          z1: drag.start.z1 + dz,
          x2: drag.start.x2 + dx,
          z2: drag.start.z2 + dz,
        };
      }
      return { ...shape, x: snap(drag.start.x + dx, snapStep), z: snap(drag.start.z + dz, snapStep) };
    });
    handlers.onShapes(next, "apply");
  }

  function updateRotate(event) {
    const degrees = ((event.clientX - drag.pointerX) / canvas.clientWidth) * 360;
    const snapped = Math.round((THREE.MathUtils.radToDeg(drag.start.rotY || 0) + degrees) / 15) * 15;
    const rotY = THREE.MathUtils.degToRad(snapped);
    const next = shapes.map((shape) => {
      if (shape.id !== drag.id) return shape;
      if (shape.kind === "measure") {
        const cx = (drag.start.x1 + drag.start.x2) / 2;
        const cz = (drag.start.z1 + drag.start.z2) / 2;
        const delta = rotY - (drag.start.rotY || 0);
        const a = rotateAround(drag.start.x1, drag.start.z1, cx, cz, delta);
        const b = rotateAround(drag.start.x2, drag.start.z2, cx, cz, delta);
        return { ...shape, x1: a.x, z1: a.z, x2: b.x, z2: b.z, rotY };
      }
      return { ...shape, rotY };
    });
    handlers.onShapes(next, "apply");
    handlers.onCursor?.({ x: null, z: null, preview: `${snapped}°` });
  }

  function nudge(direction, multiplier) {
    const shape = shapes.find((item) => item.id === selectedId);
    if (!shape) return;
    const distance = snapStep * multiplier;
    const { right, up } = screenAxes(activeCamera());
    const vector =
      direction === "up"
        ? up
        : direction === "down"
          ? up.clone().negate()
          : direction === "right"
            ? right
            : right.clone().negate();
    const dx = snap(vector.x * distance, snapStep);
    const dz = snap(vector.z * distance, snapStep);
    const next = shapes.map((item) => {
      if (item.id !== shape.id) return item;
      if (item.kind === "measure") {
        return { ...item, x1: item.x1 + dx, z1: item.z1 + dz, x2: item.x2 + dx, z2: item.z2 + dz };
      }
      return { ...item, x: snap(item.x + dx, snapStep), z: snap(item.z + dz, snapStep) };
    });
    handlers.onShapes(next, "commit");
  }

  function cancel() {
    if (!drag) return;
    if (drag.kind === "push" || drag.kind === "move" || drag.kind === "rotate") handlers.onShapes(shapes, "cancel");
    drag = null;
    clearGroup(preview);
  }

  function nextName(prefix) {
    const used = new Set(shapes.map((shape) => shape.name));
    let index = 1;
    while (used.has(`${prefix} ${index}`)) index += 1;
    return `${prefix} ${index}`;
  }

  function selectionAnchor() {
    const shape = shapes.find((item) => item.id === selectedId);
    if (!shape) return null;
    if (shape.kind === "measure") {
      return new THREE.Vector3((shape.x1 + shape.x2) / 2, 0.2, (shape.z1 + shape.z2) / 2);
    }
    return new THREE.Vector3(shape.x, shape.y + shape.h + 0.18, shape.z);
  }

  function project(vector) {
    const projected = vector.clone().project(activeCamera());
    if (projected.z > 1) return null;
    return {
      x: (projected.x * 0.5 + 0.5) * canvas.clientWidth,
      y: (-projected.y * 0.5 + 0.5) * canvas.clientHeight,
    };
  }

  function render() {
    frame = requestAnimationFrame(render);
    controls.update();
    renderer.render(scene, activeCamera());
    const anchor = selectionAnchor();
    const screen = anchor ? project(anchor) : null;
    const shape = shapes.find((item) => item.id === selectedId);
    handlers.onFrame?.({
      screen,
      label: shape ? selectionLabel(shape) : "",
    });
  }

  canvas.addEventListener("pointerdown", onLeftDown, true);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", (event) => {
    if (!drag) onMove(event);
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("wheel", (event) => event.preventDefault(), { passive: false });

  resize();
  render();

  return {
    sync,
    resize,
    fit,
    nudge,
    cancel,
    endGesture,
    setTool(next) {
      tool = next;
      canvas.style.cursor = cursorFor(tool, null);
    },
    setView,
    getView() {
      return view;
    },
    setSnap(step) {
      snapStep = step;
    },
    setDrawHeight(height) {
      drawHeight = height;
    },
    setDrawMaterial(material) {
      drawMaterial = material;
    },
    setSketchLines(enabled) {
      sketchLines = enabled;
      rebuild();
    },
    setShadows(enabled) {
      renderer.shadowMap.enabled = enabled;
      sun.castShadow = enabled;
      rebuild();
    },
    dispose() {
      cancelAnimationFrame(frame);
      controls.dispose();
      renderer.dispose();
    },
  };
}

function selectionLabel(shape) {
  if (shape.kind === "measure") return `${shape.name} · ${formatLength(measureLength(shape))}`;
  if (shape.kind === "column") {
    return `${shape.name} · Ø ${formatLength(shape.w)} · h ${formatLength(shape.h)}`;
  }
  return `${shape.name} · ${formatLength(shape.w)} × ${formatLength(shape.d)} × ${formatLength(shape.h)}`;
}

function boundedPoint(point) {
  if (!point || Math.abs(point.x) > 40 || Math.abs(point.z) > 40) return null;
  return point;
}

function pushAxis(shape, mode, hitPoint) {
  if (mode === "radius" && hitPoint) {
    const axis = new THREE.Vector3(hitPoint.x - shape.x, 0, hitPoint.z - shape.z);
    if (axis.lengthSq() > 1e-6) return axis.normalize();
  }
  const plain = outwardAxis(shape, mode);
  return new THREE.Vector3(plain.x, plain.y, plain.z).normalize();
}

function cursorFor(tool, picked) {
  if (tool === "push") return picked ? "ns-resize" : "crosshair";
  if (tool === "move") return "grab";
  if (tool === "erase") return "not-allowed";
  if (tool === "select") return picked ? "pointer" : "default";
  return "crosshair";
}

function screenAxes(camera) {
  camera.updateMatrixWorld();
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  right.y = 0;
  up.y = 0;
  if (right.lengthSq() < 1e-4 || up.lengthSq() < 1e-4) {
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    up.copy(forward);
    right.set(-forward.z, 0, forward.x);
  } else {
    right.normalize();
    up.normalize();
  }
  return { right, up };
}

function rotateAround(x, z, cx, cz, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = x - cx;
  const dz = z - cz;
  return { x: cx + dx * c - dz * s, z: cz + dx * s + dz * c };
}

function clearGroup(group) {
  for (const child of [...group.children]) {
    child.traverse((object) => {
      object.geometry?.dispose();
      const materials = object.material ? [].concat(object.material) : [];
      for (const material of materials) {
        material.map?.dispose();
        material.dispose();
      }
    });
    group.remove(child);
  }
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}
