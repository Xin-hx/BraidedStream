import type { AppState } from "../state/appState";
import type { PresetMode } from "../core/types";

export function applyPreset(state: AppState, preset: PresetMode): void {
  state.preset = preset;
  if (preset === "Readability") {
    state.baseline = "center";
    state.gapMode = "uncGap";
    state.renderMode = "mean+gapSemantic";
    state.maxExtraHeightPx = 130;
    state.gapAlphaPx = 18;
    state.insetViewMode = "after";
    return;
  }
  if (preset === "Uncertainty") {
    state.baseline = "sineStream";
    state.gapMode = "uncGap";
    state.renderMode = "mean+uncBand";
    state.maxExtraHeightPx = 150;
    state.gapAlphaPx = 22;
    state.insetViewMode = "diff";
    return;
  }
  if (preset === "Compact") {
    state.baseline = "center";
    state.gapMode = "fixedGap";
    state.renderMode = "meanOnly";
    state.maxExtraHeightPx = 70;
    state.gapAlphaPx = 8;
    state.insetViewMode = "before";
    return;
  }
  state.baseline = "center";
  state.gapMode = "uncGap";
  state.renderMode = "mean+gapSemantic";
  state.maxExtraHeightPx = 120;
  state.gapAlphaPx = 16;
  state.insetViewMode = "split";
}
