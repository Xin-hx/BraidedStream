import { clamp } from "../core/utils";
export function pointerToPlot(svg, event, plotArea) {
    const point = clientPointToSvg(svg, event);
    const rawX = point.x - plotArea.left;
    const rawY = point.y - plotArea.top;
    const insideX = rawX >= 0 && rawX <= plotArea.width;
    const insideY = rawY >= 0 && rawY <= plotArea.height;
    return {
        x: clamp(rawX, 0, plotArea.width),
        y: clamp(rawY, 0, plotArea.height),
        insideX,
        insideY,
        inside: insideX && insideY
    };
}
export function nearestIndexByValue(values, target) {
    if (values.length <= 1) {
        return 0;
    }
    let left = 0;
    let right = values.length - 1;
    while (left < right) {
        const mid = Math.floor((left + right) / 2);
        if (values[mid] < target) {
            left = mid + 1;
        }
        else {
            right = mid;
        }
    }
    if (left <= 0) {
        return 0;
    }
    const prev = left - 1;
    return Math.abs(values[left] - target) < Math.abs(values[prev] - target) ? left : prev;
}
export function timeIndexAtPlotX(times, xScale, x) {
    return nearestIndexByValue(times, xScale.invert(x));
}
export function layerIdAtY(timeIndex, yValue, orderedLayers, layout) {
    for (let k = orderedLayers.length - 1; k >= 0; k -= 1) {
        const lo = layout.yBottom[k]?.[timeIndex];
        const hi = layout.yTop[k]?.[timeIndex];
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
            continue;
        }
        if (yValue >= Math.min(lo, hi) && yValue <= Math.max(lo, hi)) {
            return orderedLayers[k].id;
        }
    }
    return null;
}
function clientPointToSvg(svg, event) {
    const matrix = svg.getScreenCTM();
    if (matrix) {
        const point = svg.createSVGPoint();
        point.x = event.clientX;
        point.y = event.clientY;
        const transformed = point.matrixTransform(matrix.inverse());
        return { x: transformed.x, y: transformed.y };
    }
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    const width = viewBox.width || Number(svg.getAttribute("width") ?? rect.width);
    const height = viewBox.height || Number(svg.getAttribute("height") ?? rect.height);
    return {
        x: viewBox.x + ((event.clientX - rect.left) * width) / Math.max(1, rect.width),
        y: viewBox.y + ((event.clientY - rect.top) * height) / Math.max(1, rect.height)
    };
}
