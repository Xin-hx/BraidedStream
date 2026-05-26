export async function exportSnapshotSvg(args) {
    const text = composeSvgPanel(args.overviewSvg, args.mainSvg, args.insetSvg);
    saveTextFile("braided-snapshot.svg", text, "image/svg+xml");
}
export async function exportSnapshotPng(args) {
    const svgText = composeSvgPanel(args.overviewSvg, args.mainSvg, args.insetSvg);
    const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("PNG export failed to load snapshot SVG"));
        img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 900;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        URL.revokeObjectURL(url);
        throw new Error("Canvas unavailable for PNG export");
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const pngData = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = pngData;
    a.download = "braided-snapshot.png";
    a.click();
}
export function exportConfigJson(config) {
    saveTextFile("braided-snapshot-config.json", JSON.stringify(config, null, 2), "application/json");
}
function composeSvgPanel(overviewSvg, mainSvg, insetSvg) {
    const serializer = new XMLSerializer();
    const overview = serializer.serializeToString(overviewSvg);
    const main = serializer.serializeToString(mainSvg);
    const inset = serializer.serializeToString(insetSvg);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="900" viewBox="0 0 1280 900">
    <rect x="0" y="0" width="1280" height="900" fill="#ffffff"/>
    <g transform="translate(40,30)">${overview}</g>
    <g transform="translate(40,190)">${main}</g>
    <g transform="translate(40,580)">${inset}</g>
  </svg>`;
}
function saveTextFile(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
