// 生成平滑的分层时间序列数据集，包含不确定性带。
export function generateSyntheticDataset(tLength = 180, kLength = 8) {
    const startUtc = Date.UTC(2020, 0, 1);
    const stepMs = 24 * 60 * 60 * 1000;
    const times = Array.from({ length: tLength }, (_, i) => startUtc + i * stepMs);
    const layers = [];
    for (let k = 0; k < kLength; k += 1) {
        const id = `L${k + 1}`;
        const mean = new Array(tLength).fill(0);
        const unc = new Array(tLength).fill(0);
        const lower = new Array(tLength).fill(0);
        const upper = new Array(tLength).fill(0);
        for (let t = 0; t < tLength; t += 1) {
            const x = t / (tLength - 1);
            const phase = k * 0.45;
            const base = 2.2 + 1.3 * Math.sin(2 * Math.PI * x + phase) + 0.8 * Math.sin(6 * Math.PI * x + phase * 0.5);
            const peakA = 3.0 * Math.exp(-Math.pow((x - (0.18 + k * 0.035)) / 0.085, 2));
            const peakB = 2.1 * Math.exp(-Math.pow((x - (0.68 - k * 0.03)) / 0.09, 2));
            const trend = 0.25 * (k + 1) * (0.5 + 0.5 * Math.sin(Math.PI * x));
            const meanValue = Math.max(0.25, base + peakA + peakB + trend);
            const uncertaintyWave = 0.45 + 0.55 * Math.abs(Math.sin(8 * Math.PI * x + k * 0.9));
            const uncValue = Math.max(0.05, 0.11 * meanValue + 0.33 * uncertaintyWave);
            mean[t] = meanValue;
            unc[t] = uncValue;
            lower[t] = Math.max(0, meanValue - uncValue);
            upper[t] = meanValue + uncValue;
        }
        layers.push({ id, mean, unc, lower, upper });
    }
    const order = layers.map((layer) => layer.id);
    return { times, layers, order };
}
