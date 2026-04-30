import * as d3 from "d3";
export function createRoiBrush(host, extent, onChange, eventNames = "end") {
    let times = [];
    let xScale = d3.scaleLinear().domain([0, 1]).range([extent[0][0], extent[1][0]]);
    let suppressEvent = false;
    const brush = d3
        .brushX()
        .extent(extent)
        .on(eventNames, (event) => {
        if (suppressEvent) {
            return;
        }
        if (!event.selection) {
            onChange(null);
            return;
        }
        if (times.length === 0) {
            return;
        }
        const [rawX0, rawX1] = event.selection;
        const x0 = Math.min(rawX0, rawX1);
        const x1 = Math.max(rawX0, rawX1);
        const v0 = xScale.invert(x0);
        const v1 = xScale.invert(x1);
        const i0 = nearestIndex(times, v0);
        const i1 = nearestIndex(times, v1);
        onChange({
            t0Index: Math.min(i0, i1),
            t1Index: Math.max(i0, i1)
        });
    });
    host.call(brush);
    return {
        updateContext(nextTimes, nextScale) {
            times = nextTimes;
            xScale = nextScale;
        },
        sync(roi) {
            suppressEvent = true;
            if (!roi || times.length === 0) {
                host.call(brush.move, null);
                suppressEvent = false;
                return;
            }
            const left = clamp(roi.t0Index, 0, times.length - 1);
            const right = clamp(roi.t1Index, 0, times.length - 1);
            const x0 = xScale(times[left]);
            const x1 = xScale(times[right]);
            host.call(brush.move, [x0, x1]);
            suppressEvent = false;
        }
    };
}
function nearestIndex(values, target) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < values.length; i += 1) {
        const d = Math.abs(values[i] - target);
        if (d < bestDistance) {
            bestDistance = d;
            bestIndex = i;
        }
    }
    return bestIndex;
}
function clamp(v, low, high) {
    return Math.max(low, Math.min(high, v));
}
