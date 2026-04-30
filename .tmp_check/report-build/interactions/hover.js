export function buildHoverInfo(timeIndex, times, layers, focusLayerId) {
    const clamped = Math.max(0, Math.min(times.length - 1, timeIndex));
    const allValues = layers.map((layer) => ({
        id: layer.id,
        label: formatLayerLabel(layer.id),
        mean: layer.mean[clamped],
        unc: layer.unc?.[clamped] ?? 0
    }));
    const layerValues = focusLayerId ? allValues.filter((item) => item.id === focusLayerId) : allValues;
    return {
        timeIndex: clamped,
        timeValue: times[clamped],
        timeLabel: formatTimeValue(times[clamped]),
        total: allValues.reduce((acc, item) => acc + item.mean, 0),
        focusLayerId: focusLayerId ?? null,
        layerValues
    };
}
export function tooltipText(info, extra) {
    const header = info.focusLayerId
        ? `t=${info.timeLabel} total=${info.total.toFixed(2)} | focused substream`
        : `t=${info.timeLabel} total=${info.total.toFixed(2)}`;
    const top = info.layerValues
        .slice()
        .sort((a, b) => b.mean - a.mean)
        .slice(0, info.focusLayerId ? 1 : 4)
        .map((item) => `${item.label}: ${item.mean.toFixed(2)} (u ${item.unc.toFixed(2)})`);
    if (top.length === 0 && info.focusLayerId) {
        top.push("no substream at cursor");
    }
    return [header, ...top, ...extra].join("\n");
}
function formatTimeValue(value) {
    if (!Number.isFinite(value)) {
        return "-";
    }
    return new Date(value).toISOString().slice(0, 10);
}
function formatLayerLabel(layerId) {
    const match = layerId.match(/^(\d{2})\|h(\d+)$/i);
    if (!match) {
        return layerId;
    }
    const fips = match[1];
    const horizon = Number(match[2]);
    const stateName = STATE_NAME_BY_FIPS[fips] ?? `FIPS ${fips}`;
    return `${stateName} (${fips}) h${horizon}`;
}
const STATE_NAME_BY_FIPS = {
    "01": "Alabama",
    "02": "Alaska",
    "04": "Arizona",
    "05": "Arkansas",
    "06": "California",
    "08": "Colorado",
    "09": "Connecticut",
    "10": "Delaware",
    "11": "District of Columbia",
    "12": "Florida",
    "13": "Georgia",
    "15": "Hawaii",
    "16": "Idaho",
    "17": "Illinois",
    "18": "Indiana",
    "19": "Iowa",
    "20": "Kansas",
    "21": "Kentucky",
    "22": "Louisiana",
    "23": "Maine",
    "24": "Maryland",
    "25": "Massachusetts",
    "26": "Michigan",
    "27": "Minnesota",
    "28": "Mississippi",
    "29": "Missouri",
    "30": "Montana",
    "31": "Nebraska",
    "32": "Nevada",
    "33": "New Hampshire",
    "34": "New Jersey",
    "35": "New Mexico",
    "36": "New York",
    "37": "North Carolina",
    "38": "North Dakota",
    "39": "Ohio",
    "40": "Oklahoma",
    "41": "Oregon",
    "42": "Pennsylvania",
    "44": "Rhode Island",
    "45": "South Carolina",
    "46": "South Dakota",
    "47": "Tennessee",
    "48": "Texas",
    "49": "Utah",
    "50": "Vermont",
    "51": "Virginia",
    "53": "Washington",
    "54": "West Virginia",
    "55": "Wisconsin",
    "56": "Wyoming",
    US: "United States"
};
