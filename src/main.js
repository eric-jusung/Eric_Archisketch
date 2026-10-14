import {
  DRAW_HEIGHTS,
  MATERIALS,
  SNAP_STEPS,
  TOOLS,
  loadDocument,
  parseDocument,
  saveDocument,
  studioSample,
} from "./catalog.js";
import { createEditor } from "./editor.js";
import { duplicateShape, formatLength, formatMm, measureLength, sketchBounds, snap } from "./math.js";
import { createStore } from "./store.js";

const store = createStore();
const canvas = document.querySelector("#view");
const toolRail = document.querySelector("#tools");
const side = document.querySelector("#side-body");
const hint = document.querySelector("#hint");
const readout = document.querySelector("#readout");
const cursorReadout = document.querySelector("#cursor");
const nameInput = document.querySelector("#sketch-name");
const floatLabel = document.querySelector("#float-label");
const empty = document.querySelector("#empty");
const fileInput = document.querySelector("#file-input");
const help = document.querySelector("#help");

let selectedId = null;
let sketchName = "Seongsu studio";
let tool = "select";
let snapMm = 100;
let drawHeightMm = 2400;
let drawMaterial = "plaster";
let saveTimer = 0;
let fieldGesture = false;
let panelKey = "";
let sketchLines = true;
let sunlight = true;

const editor = createEditor(canvas, {
  onShapes(next, phase) {
    if (phase === "begin") store.begin();
    if (phase === "apply") store.apply(next);
    if (phase === "end") store.end();
    if (phase === "cancel") store.cancel();
    if (phase === "commit") store.commit(next);
  },
  onSelect(id) {
    selectedId = id;
    editor.sync(store.get(), selectedId);
    renderChrome();
  },
  onCursor({ x, z, preview }) {
    if (x == null || z == null) {
      cursorReadout.textContent = preview || "—";
      return;
    }
    const position = `${formatMm(x)} , ${formatMm(z)}`;
    cursorReadout.textContent = preview ? `${preview} · ${position}` : position;
  },
  onViewChange(view) {
    for (const button of document.querySelectorAll("[data-view]")) {
      button.setAttribute("aria-pressed", String(button.dataset.view === view));
    }
  },
  onFrame({ screen, label }) {
    if (!screen || !label || !selectedId) {
      floatLabel.hidden = true;
      return;
    }
    floatLabel.hidden = false;
    floatLabel.textContent = label;
    floatLabel.style.left = `${screen.x}px`;
    floatLabel.style.top = `${screen.y}px`;
  },
});

store.subscribe(() => {
  editor.sync(store.get(), selectedId);
  scheduleSave();
  renderChrome();
});

const saved = loadDocument();
if (saved && saved.shapes.length) {
  sketchName = saved.name;
  store.load(saved.shapes);
} else {
  store.load(studioSample());
}
nameInput.value = sketchName;
editor.fit();

toolRail.innerHTML = TOOLS.map(
  (item) => `
    <button type="button" class="tool" data-tool="${item.id}" aria-pressed="${item.id === tool}" title="${item.label} (${item.key})">
      ${icon(item.id)}
      <span>${item.label}</span>
      <kbd>${item.key}</kbd>
    </button>
  `,
).join("");

toolRail.addEventListener("click", (event) => {
  const button = event.target.closest("[data-tool]");
  if (!button) return;
  chooseTool(button.dataset.tool);
});

document.querySelector("#views").addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (!button) return;
  editor.setView(button.dataset.view);
});

document.querySelector("#undo").addEventListener("click", () => {
  editor.endGesture();
  store.undo();
});
document.querySelector("#redo").addEventListener("click", () => {
  editor.endGesture();
  store.redo();
});
document.querySelector("#fit").addEventListener("click", () => editor.fit());
document.querySelector("#help-open").addEventListener("click", () => help.showModal());
document.querySelector("#help-close").addEventListener("click", () => help.close());

document.querySelector("#file-menu").addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "new") {
    selectedId = null;
    sketchName = "Untitled sketch";
    nameInput.value = sketchName;
    store.commit([]);
  }
  if (action === "sample") openSample();
  if (action === "export") exportSketch();
  if (action === "import") fileInput.click();
  document.querySelector("#file-menu").removeAttribute("open");
});

document.querySelector("#empty-sample").addEventListener("click", openSample);
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) return;
  try {
    const doc = parseDocument(JSON.parse(await file.text()));
    selectedId = null;
    sketchName = doc.name;
    nameInput.value = sketchName;
    store.load(doc.shapes);
    editor.fit();
  } catch {
    readout.textContent = "Could not read that file";
  }
});

nameInput.addEventListener("input", () => {
  sketchName = nameInput.value.trim() || "Untitled sketch";
  scheduleSave();
});

window.addEventListener("keydown", onKeyDown);
window.addEventListener("resize", () => editor.resize());
new ResizeObserver(() => editor.resize()).observe(document.querySelector("#viewport"));

chooseTool("select");
renderChrome();

function chooseTool(next) {
  tool = next;
  editor.setTool(tool);
  if (["area", "wall", "column", "measure"].includes(tool) && editor.getView() !== "plan") {
    editor.setView("plan");
  }
  for (const button of toolRail.querySelectorAll("[data-tool]")) {
    button.setAttribute("aria-pressed", String(button.dataset.tool === tool));
  }
  const spec = TOOLS.find((item) => item.id === tool);
  hint.textContent = spec ? spec.hint : "";
}

function openSample() {
  selectedId = null;
  sketchName = "Seongsu studio";
  nameInput.value = sketchName;
  store.commit(studioSample());
  editor.setView("model");
  editor.fit();
}

function exportSketch() {
  const blob = new Blob(
    [JSON.stringify({ version: 1, name: sketchName, shapes: store.get() }, null, 2)],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sketchName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "sketch"}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveDocument({ version: 1, name: sketchName, shapes: store.get() });
  }, 180);
}

function renderChrome() {
  const shapes = store.get();
  const bounds = sketchBounds(shapes);
  readout.textContent = bounds
    ? `${formatLength(bounds.width)} × ${formatLength(bounds.depth)} · ${bounds.count} masses`
    : "Empty sheet";
  document.querySelector("#undo").disabled = !store.canUndo();
  document.querySelector("#redo").disabled = !store.canRedo();
  empty.hidden = shapes.length > 0;
  document.title = `${sketchName} · Modeling Sketch`;
  renderSide(shapes);
}

function renderSide(shapes) {
  const selected = shapes.find((shape) => shape.id === selectedId) || null;
  const key = `${selected?.id || "none"}:${selected?.kind || ""}:${shapes.map((shape) => shape.id).join(",")}`;
  if (key !== panelKey) {
    panelKey = key;
    side.innerHTML = panelMarkup(selected, shapes);
    bindPanel(selected);
  } else {
    updatePanel(selected);
  }
}

function panelMarkup(selected, shapes) {
  return `
    <section class="block">
      <p class="kicker">Draw</p>
      <div class="chips" id="height-chips">
        ${DRAW_HEIGHTS.map(
          (item) => `
            <button type="button" data-height="${item.mm}" aria-pressed="${item.mm === drawHeightMm}">
              <strong>${item.label}</strong>
              <span>${item.mm}</span>
            </button>
          `,
        ).join("")}
      </div>
      <label class="field-label" for="snap-step">Snap</label>
      <div class="segmented" id="snap-step">
        ${SNAP_STEPS.map(
          (item) => `
            <button type="button" data-snap="${item.mm}" aria-pressed="${item.mm === snapMm}">${item.label}</button>
          `,
        ).join("")}
      </div>
    </section>
    ${selected ? propertiesMarkup(selected) : `<section class="block quiet"><p>Select a mass, or draw on the plan. The studio sample is a one-room massing study.</p></section>`}
    <section class="block">
      <p class="kicker">${selected ? "Material" : "Draw material"}</p>
      <div class="swatches" id="swatches">
        ${Object.entries(MATERIALS)
          .map(([id, spec]) => {
            const active = selected ? selected.material === id : drawMaterial === id;
            return `<button type="button" data-material="${id}" aria-pressed="${active}" title="${spec.label}"><i style="background:${spec.color}"></i>${spec.label}</button>`;
          })
          .join("")}
      </div>
    </section>
    <section class="block grow">
      <p class="kicker">Sheet</p>
      <ul class="outliner" id="outliner">
        ${
          shapes.length
            ? shapes
                .map(
                  (shape) => `
                    <li>
                      <button type="button" data-select="${shape.id}" aria-current="${shape.id === selectedId}">
                        <em>${kindLabel(shape)}</em>
                        <span>${escapeHtml(shape.name)}</span>
                      </button>
                    </li>
                  `,
                )
                .join("")
            : `<li class="muted">Nothing on the sheet yet.</li>`
        }
      </ul>
    </section>
    <section class="block toggles">
      <label><input id="lines-toggle" type="checkbox" ${sketchLines ? "checked" : ""} /> Sketch lines</label>
      <label><input id="shadow-toggle" type="checkbox" ${sunlight ? "checked" : ""} /> Sunlight</label>
    </section>
  `;
}

function propertiesMarkup(shape) {
  if (shape.kind === "measure") {
    return `
      <section class="block">
        <p class="kicker">Measure</p>
        <label class="field-label">Name<input id="prop-name" value="${escapeHtml(shape.name)}" /></label>
        <p class="measure-readout">${formatLength(measureLength(shape))}</p>
        <button type="button" class="danger" id="delete-shape">Remove</button>
      </section>
    `;
  }
  const diameter = shape.kind === "column";
  return `
    <section class="block">
      <p class="kicker">${diameter ? "Column" : "Mass"}</p>
      <label class="field-label">Name<input id="prop-name" value="${escapeHtml(shape.name)}" /></label>
      <div class="dims">
        ${
          diameter
            ? `<label>Diameter<input id="prop-w" inputmode="numeric" value="${formatMm(shape.w)}" /> mm</label>`
            : `<label>Width<input id="prop-w" inputmode="numeric" value="${formatMm(shape.w)}" /> mm</label>
               <label>Depth<input id="prop-d" inputmode="numeric" value="${formatMm(shape.d)}" /> mm</label>`
        }
        <label>Height<input id="prop-h" inputmode="numeric" value="${formatMm(shape.h)}" /> mm</label>
        <label>Elevation<input id="prop-y" inputmode="numeric" value="${formatMm(shape.y)}" /> mm</label>
        <label>Rotate<input id="prop-rot" inputmode="numeric" value="${Math.round((shape.rotY * 180) / Math.PI)}" /> °</label>
      </div>
      <button type="button" class="danger" id="delete-shape">Remove</button>
    </section>
  `;
}

function bindPanel() {
  side.querySelectorAll("[data-height]").forEach((button) => {
    button.addEventListener("click", () => {
      drawHeightMm = Number(button.dataset.height);
      editor.setDrawHeight(drawHeightMm / 1000);
      side.querySelectorAll("[data-height]").forEach((item) => {
        item.setAttribute("aria-pressed", String(item === button));
      });
    });
  });
  side.querySelectorAll("[data-snap]").forEach((button) => {
    button.addEventListener("click", () => {
      snapMm = Number(button.dataset.snap);
      editor.setSnap(snapMm / 1000);
      side.querySelectorAll("[data-snap]").forEach((item) => {
        item.setAttribute("aria-pressed", String(item === button));
      });
    });
  });
  side.querySelectorAll("[data-material]").forEach((button) => {
    button.addEventListener("click", () => {
      const material = button.dataset.material;
      const selected = store.get().find((shape) => shape.id === selectedId);
      if (!selected || selected.kind === "measure") {
        drawMaterial = material;
        editor.setDrawMaterial(material);
        panelKey = "";
        renderSide(store.get());
        return;
      }
      store.commit(store.get().map((shape) => (shape.id === selected.id ? { ...shape, material } : shape)));
    });
  });
  side.querySelectorAll("[data-select]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedId = button.dataset.select;
      editor.sync(store.get(), selectedId);
      renderChrome();
    });
  });
  const del = side.querySelector("#delete-shape");
  del?.addEventListener("click", () => removeSelected());
  for (const input of side.querySelectorAll("input[id^='prop-']")) {
    input.addEventListener("focus", () => {
      store.begin();
      fieldGesture = true;
    });
    input.addEventListener("input", () => applyFields(false));
    input.addEventListener("blur", () => {
      if (!fieldGesture) return;
      applyFields(true);
      store.end();
      fieldGesture = false;
    });
  }
  side.querySelector("#lines-toggle")?.addEventListener("change", (event) => {
    sketchLines = event.target.checked;
    editor.setSketchLines(sketchLines);
  });
  side.querySelector("#shadow-toggle")?.addEventListener("change", (event) => {
    sunlight = event.target.checked;
    editor.setShadows(sunlight);
  });
  editor.setDrawHeight(drawHeightMm / 1000);
  editor.setSnap(snapMm / 1000);
  editor.setDrawMaterial(drawMaterial);
}

function updatePanel(selected) {
  if (!selected) return;
  setField("prop-name", selected.name);
  if (selected.kind === "measure") return;
  setField("prop-w", formatMm(selected.w));
  setField("prop-d", formatMm(selected.d));
  setField("prop-h", formatMm(selected.h));
  setField("prop-y", formatMm(selected.y));
  setField("prop-rot", String(Math.round((selected.rotY * 180) / Math.PI)));
  side.querySelectorAll("[data-material]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.material === selected.material));
  });
  const current = side.querySelector(`[data-select="${CSS.escape(selected.id)}"]`);
  side.querySelectorAll("[data-select]").forEach((button) => button.removeAttribute("aria-current"));
  current?.setAttribute("aria-current", "true");
  const name = current?.querySelector("span");
  if (name && name.textContent !== selected.name) name.textContent = selected.name;
}

function setField(id, value) {
  const field = document.getElementById(id);
  if (!field || document.activeElement === field) return;
  if (field.value !== String(value)) field.value = String(value);
}

function applyFields() {
  const selected = store.get().find((shape) => shape.id === selectedId);
  if (!selected) return;
  const name = document.getElementById("prop-name")?.value.trim() || selected.name;
  if (selected.kind === "measure") {
    store.apply(store.get().map((shape) => (shape.id === selected.id ? { ...shape, name } : shape)));
    return;
  }
  const read = (id, fallback) => {
    const raw = document.getElementById(id)?.value;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  };
  const width = clamp(read("prop-w", selected.w * 1000), 20, 50000) / 1000;
  const depth = clamp(read("prop-d", selected.d * 1000), 20, 50000) / 1000;
  const height = clamp(read("prop-h", selected.h * 1000), 20, 20000) / 1000;
  const elevation = clamp(read("prop-y", selected.y * 1000), 0, 20000) / 1000;
  const rotation = (read("prop-rot", (selected.rotY * 180) / Math.PI) * Math.PI) / 180;
  const patch = {
    name,
    h: snap(height, 0.001),
    y: snap(elevation, 0.001),
    rotY: rotation,
  };
  if (selected.kind === "column") {
    patch.w = snap(width, 0.001);
    patch.d = patch.w;
  } else {
    patch.w = snap(width, 0.001);
    patch.d = snap(depth, 0.001);
  }
  store.apply(store.get().map((shape) => (shape.id === selected.id ? { ...shape, ...patch } : shape)));
}

function removeSelected() {
  if (!selectedId) return;
  const id = selectedId;
  selectedId = null;
  store.commit(store.get().filter((shape) => shape.id !== id));
}

function onKeyDown(event) {
  const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
  const meta = event.metaKey || event.ctrlKey;
  if (meta && event.key.toLowerCase() === "z") {
    event.preventDefault();
    editor.endGesture();
    if (event.shiftKey) store.redo();
    else store.undo();
    return;
  }
  if (meta && event.key.toLowerCase() === "y") {
    event.preventDefault();
    editor.endGesture();
    store.redo();
    return;
  }
  if (typing) {
    if (event.key === "Escape") event.target.blur();
    return;
  }
  if (meta && event.key.toLowerCase() === "d") {
    event.preventDefault();
    duplicateSelected();
    return;
  }
  if (meta && event.key.toLowerCase() === "s") {
    event.preventDefault();
    exportSketch();
    return;
  }
  if (event.key === "Escape") {
    editor.cancel();
    selectedId = null;
    editor.sync(store.get(), null);
    renderChrome();
    help.close();
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    removeSelected();
    return;
  }
  if (event.key === "?") {
    help.showModal();
    return;
  }
  const arrows = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
  if (arrows[event.key]) {
    event.preventDefault();
    editor.nudge(arrows[event.key], event.shiftKey ? 5 : 1);
    return;
  }
  if (event.key === "1") editor.setView("plan");
  if (event.key === "2") editor.setView("model");
  if (event.key.toLowerCase() === "f") editor.fit();
  const byKey = {
    v: "select",
    a: "area",
    w: "wall",
    c: "column",
    p: "push",
    g: "move",
    r: "rotate",
    m: "measure",
    x: "erase",
  };
  const next = byKey[event.key.toLowerCase()];
  if (next) chooseTool(next);
}

function duplicateSelected() {
  const shape = store.get().find((item) => item.id === selectedId);
  if (!shape) return;
  const copy = duplicateShape(shape, snapMm / 1000);
  selectedId = copy.id;
  store.commit([...store.get(), copy]);
}

function kindLabel(shape) {
  if (shape.kind === "column") return "Col";
  if (shape.kind === "measure") return "Dim";
  return "Box";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function icon(id) {
  const paths = {
    select: '<path d="M5 4l6 14 2-6 6-2z"/>',
    area: '<rect x="4" y="6" width="14" height="10" rx="1"/>',
    wall: '<path d="M4 16V8h3v8M10 16V5h3v11M17 16v-6"/>',
    column: '<ellipse cx="11" cy="6" rx="4" ry="2"/><path d="M7 6v10c0 1 1.8 2 4 2s4-1 4-2V6"/>',
    push: '<path d="M11 18V5M7 8l4-4 4 4M7 15l4 4 4-4"/>',
    move: '<path d="M11 3v16M3 11h16M7 6L4 11l3 5M15 6l3 5-3 5M6 7l5-4 5 4M6 15l5 4 5-4"/>',
    rotate: '<path d="M16 7a6 6 0 1 0 1.2 4"/><path d="M16 3v4h-4"/>',
    measure: '<path d="M4 16L16 6"/><path d="M4 16v-3M4 16h3M16 6v3M16 6h-3"/>',
    erase: '<path d="M5 14l6-8 6 4-6 8H8z"/><path d="M4 18h14"/>',
  };
  return `<svg viewBox="0 0 22 22" aria-hidden="true">${paths[id]}</svg>`;
}
