export function exportSvg(svg: SVGElement): void {
  const graphic = svg.cloneNode(true) as SVGElement;
  for (const token of ["ink", "muted", "line", "accent", "accent-soft"]) {
    graphic.style.setProperty(
      `--${token}`,
      getComputedStyle(document.documentElement).getPropertyValue(`--${token}`).trim(),
    );
  }
  graphic.querySelectorAll(".grid, .axis, .axis-label, .hover-line, text, line").forEach((node) => node.remove());
  downloadBlob(
    new Blob([new XMLSerializer().serializeToString(graphic)], {
      type: "image/svg+xml;charset=utf-8",
    }),
    "braided-streamgraph.svg",
  );
}
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
