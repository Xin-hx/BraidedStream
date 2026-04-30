import * as d3 from "d3";
import { layerUncertaintyAt } from "../core/validate.js";
export function recommendRoiWindows(dataset, strategy, windowSize, topK = 6) {
    const span = Math.max(4, Math.min(dataset.times.length - 1, windowSize));
    const scored = [];
    for (let left = 0; left + span < dataset.times.length; left += Math.max(1, Math.floor(span / 4))) {
        const roi = { t0Index: left, t1Index: left + span };
        const score = scoreWindow(dataset, strategy, roi);
        scored.push({ roi, score, label: `${strategy} [${roi.t0Index}, ${roi.t1Index}]` });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}
function scoreWindow(dataset, strategy, roi) {
    if (strategy === "highest uncertainty") {
        let acc = 0;
        for (let t = roi.t0Index; t <= roi.t1Index; t += 1) {
            for (const layer of dataset.layers) {
                acc += layerUncertaintyAt(layer, t);
            }
        }
        return acc;
    }
    if (strategy === "highest mean slope") {
        let acc = 0;
        for (const layer of dataset.layers) {
            for (let t = roi.t0Index + 1; t <= roi.t1Index; t += 1) {
                acc += Math.abs(layer.mean[t] - layer.mean[t - 1]);
            }
        }
        return acc;
    }
    if (strategy === "highest wiggle") {
        let acc = 0;
        for (const layer of dataset.layers) {
            for (let t = roi.t0Index + 2; t <= roi.t1Index; t += 1) {
                const d2 = layer.mean[t] - 2 * layer.mean[t - 1] + layer.mean[t - 2];
                acc += d2 * d2;
            }
        }
        return acc;
    }
    const totals = d3.range(roi.t0Index, roi.t1Index + 1).map((t) => d3.sum(dataset.layers, (layer) => layer.mean[t]) ?? 0);
    let change = 0;
    for (let i = 1; i < totals.length; i += 1) {
        change += Math.abs(totals[i] - totals[i - 1]);
    }
    return change;
}
