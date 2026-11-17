import { LAYER_PALETTES, type PaletteId } from "braided-stream";
export interface SavedAppearance { palette: PaletteId; colors: Record<string, string> }
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

export function loadAppearance(): SavedAppearance {
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


export function saveAppearance(appearance: SavedAppearance): string {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
    return "Appearance saved in this browser.";
  } catch (error) {
    console.error("Could not save BraidedStream appearance settings.", error);
    return "Could not save appearance settings locally.";
  }
}
