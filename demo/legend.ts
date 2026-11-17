import { colorForLayer, LAYER_PALETTES, M, W, type DisplayLayer, type PaletteId } from "./render";

type LegendSort = "tpid" | "category";

export interface LegendModel {
  datasetId: string;
  layers: readonly DisplayLayer[];
  layoutOrder: string[];
  tpidRanking: string[];
  tpidDepth: Record<string, number>;
  tpidDefined: boolean;
  selectedLayerId: string | null;
  note?: string;
}

export interface LegendAppearance {
  palette: PaletteId;
  colorOverrides: Record<string, string>;
}

export interface LegendController {
  getLayoutOrder(layerIds: string[]): string[] | undefined;
  getAppearance(datasetId: string): LegendAppearance;
  update(model: LegendModel): void;
}

interface SavedAppearance {
  palette: PaletteId;
  colors: Record<string, string>;
}

interface LegendCallbacks {
  onLayoutOrderChange(): void;
  onAppearanceChange(): void;
  onLayerSelect(layerId: string | null): void;
}

const STORAGE_KEY = "braidedstream:appearance:v1";
const DEFAULT_APPEARANCE: SavedAppearance = { palette: "reference", colors: {} };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPaletteId(value: unknown): value is PaletteId {
  return typeof value === "string" && Object.hasOwn(LAYER_PALETTES, value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function loadAppearance(): SavedAppearance {
  let saved: string | null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    console.error("Could not read saved BraidedStream appearance settings.", error);
    return { ...DEFAULT_APPEARANCE, colors: {} };
  }
  if (!saved) return { ...DEFAULT_APPEARANCE, colors: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(saved);
  } catch (error) {
    console.error("Could not parse saved BraidedStream appearance settings.", error);
    return { ...DEFAULT_APPEARANCE, colors: {} };
  }
  if (!isRecord(parsed)) {
    console.error("Saved BraidedStream appearance settings must be an object.");
    return { ...DEFAULT_APPEARANCE, colors: {} };
  }

  const colors: Record<string, string> = {};
  if (isRecord(parsed.colors)) {
    for (const [key, color] of Object.entries(parsed.colors)) {
      if (isHexColor(color)) colors[key] = color;
      else console.error(`Ignoring invalid saved color for ${key}.`);
    }
  } else {
    console.error("Saved BraidedStream colors must be an object.");
  }
  if (parsed.palette !== undefined && !isPaletteId(parsed.palette)) {
    console.error("Ignoring unknown saved BraidedStream palette.");
  }

  return {
    palette: isPaletteId(parsed.palette) ? parsed.palette : "reference",
    colors,
  };
}

export function createLegendController(callbacks: LegendCallbacks): LegendController {
  const panel = document.getElementById("legend") as HTMLElement;
  const toggle = document.getElementById("ctl-legend") as HTMLInputElement;
  const restore = document.getElementById("btn-legend-restore") as HTMLButtonElement;
  const items = document.getElementById("legend-items") as HTMLDivElement;
  const note = document.getElementById("legend-note") as HTMLDivElement;
  const status = document.getElementById("legend-status") as HTMLDivElement;
  const sortSelect = document.getElementById("ctl-legend-sort") as HTMLSelectElement;
  const paletteSelect = document.getElementById("ctl-legend-palette") as HTMLSelectElement;
  const chartElement = document.getElementById("chart");
  if (!(chartElement instanceof SVGSVGElement)) {
    throw new Error("The chart SVG element is missing.");
  }
  const chart = chartElement;
  const appearance = loadAppearance();
  let sort: LegendSort = "tpid";
  let model: LegendModel | null = null;

  const updateCompactWidth = (): void => {
    const matrix = chart.getScreenCTM();
    if (!matrix) return;
    const plotRight = chart.createSVGPoint();
    plotRight.x = W - M.right;
    plotRight.y = 0;
    const screenRight = plotRight.matrixTransform(matrix).x;
    const gutter = document.documentElement.clientWidth - screenRight;
    panel.style.setProperty("--legend-compact-width", `${Math.max(20, gutter)}px`);
  };
  new ResizeObserver(updateCompactWidth).observe(chart);

  const saveAppearance = (): void => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
      status.textContent = "Appearance saved in this browser.";
    } catch (error) {
      console.error("Could not save BraidedStream appearance settings.", error);
      status.textContent = "Could not save appearance settings locally.";
    }
  };

  const getAppearance = (datasetId: string): LegendAppearance => {
    const prefix = `${datasetId}:`;
    return {
      palette: appearance.palette,
      colorOverrides: Object.fromEntries(
        Object.entries(appearance.colors)
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, color]) => [key.slice(prefix.length), color]),
      ),
    };
  };

  const renderItems = (): void => {
    if (!model) return;
    const currentModel = model;
    const ids = panel.classList.contains("is-minimized")
      ? [...currentModel.layoutOrder].reverse()
      : sort === "tpid"
        ? currentModel.tpidRanking
        : currentModel.layoutOrder;
    const colors = getAppearance(currentModel.datasetId).colorOverrides;
    items.replaceChildren();

    for (const id of ids) {
      const item = document.createElement("div");
      item.className = `legend-item${currentModel.selectedLayerId === id ? " is-selected" : ""}`;

      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.className = "legend-color";
      colorInput.value = colorForLayer(currentModel.layers, id, colors, appearance.palette);
      item.style.setProperty("--layer-color", colorInput.value);
      colorInput.setAttribute("aria-label", `Color for ${id}`);
      const colorKey = `${currentModel.datasetId}:${id}`;
      colorInput.addEventListener("input", () => {
        appearance.colors[colorKey] = colorInput.value;
        item.style.setProperty("--layer-color", colorInput.value);
        callbacks.onAppearanceChange();
      });
      colorInput.addEventListener("change", () => {
        saveAppearance();
        renderItems();
      });

      const label = document.createElement("div");
      label.className = "legend-label";
      const name = document.createElement("button");
      name.className = "legend-select";
      name.type = "button";
      name.setAttribute("aria-label", `Focus layer ${id}`);
      name.title = id;
      name.setAttribute("aria-pressed", String(currentModel.selectedLayerId === id));
      name.addEventListener("click", () => {
        callbacks.onLayerSelect(currentModel.selectedLayerId === id ? null : id);
      });
      const nameText = document.createElement("span");
      nameText.className = "legend-name";
      nameText.textContent = id;
      name.append(nameText);
      const meta = document.createElement("span");
      meta.className = "legend-meta";
      const rank = currentModel.tpidRanking.indexOf(id) + 1;
      meta.textContent = currentModel.tpidDefined
        ? `TPID #${rank} · ${currentModel.tpidDepth[id].toFixed(6)}`
        : "TPID undefined";
      label.append(name, meta);

      const reset = document.createElement("button");
      reset.className = "legend-reset";
      reset.type = "button";
      reset.textContent = "↺";
      reset.title = `Reset ${id} to the selected palette`;
      reset.setAttribute("aria-label", reset.title);
      reset.hidden = !Object.hasOwn(appearance.colors, colorKey);
      reset.addEventListener("click", () => {
        delete appearance.colors[colorKey];
        saveAppearance();
        renderItems();
        callbacks.onAppearanceChange();
      });

      item.append(colorInput, label, reset);
      items.append(item);
    }
  };

  toggle.addEventListener("change", () => {
    panel.hidden = !toggle.checked;
    panel.classList.remove("is-minimized");
    restore.hidden = true;
    renderItems();
  });
  document.getElementById("btn-legend-minimize")!.addEventListener("click", () => {
    updateCompactWidth();
    panel.classList.add("is-minimized");
    restore.hidden = false;
    renderItems();
  });
  document.getElementById("btn-legend-hide")!.addEventListener("click", () => {
    toggle.checked = false;
    panel.hidden = true;
    panel.classList.remove("is-minimized");
    restore.hidden = true;
  });
  restore.addEventListener("click", () => {
    toggle.checked = true;
    panel.hidden = false;
    panel.classList.remove("is-minimized");
    restore.hidden = true;
    renderItems();
  });
  sortSelect.addEventListener("change", () => {
    if (sortSelect.value !== "tpid" && sortSelect.value !== "category") return;
    sort = sortSelect.value;
    callbacks.onLayoutOrderChange();
  });
  paletteSelect.value = appearance.palette;
  paletteSelect.addEventListener("change", () => {
    if (!isPaletteId(paletteSelect.value)) return;
    appearance.palette = paletteSelect.value;
    saveAppearance();
    renderItems();
    callbacks.onAppearanceChange();
  });

  panel.hidden = !toggle.checked;
  restore.hidden = true;

  return {
    getLayoutOrder(layerIds) {
      return sort === "category"
        ? [...layerIds].sort((a, b) => a.localeCompare(b))
        : undefined;
    },
    getAppearance,
    update(nextModel) {
      model = nextModel;
      if (panel.classList.contains("is-minimized")) updateCompactWidth();
      sortSelect.value = sort;
      paletteSelect.value = appearance.palette;
      note.textContent = model.note ?? "";
      renderItems();
    },
  };
}
