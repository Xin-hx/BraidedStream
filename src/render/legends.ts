export function buildGapLegendText(renderMode: string, semantic: string): string {
  if (renderMode === "diffOnly") {
    return "Diff mode: colored zones encode boundary displacement and introduced spacing.";
  }
  if (renderMode === "mean+uncBand" || semantic === "uncBand") {
    return "Gap semantic: grayscale uncertainty band inside the introduced spacing.";
  }
  if (semantic === "hatch") {
    return "Gap semantic: hatched zone indicates added semantic gap (not missing data).";
  }
  if (semantic === "ruler") {
    return "Gap semantic: mini ruler marks show local spacing magnitude.";
  }
  return "Gap semantic: heat strip encodes local uncertainty strength.";
}
