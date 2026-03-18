import type { MetricResult } from "../layout/metrics";

export class MetricsPanel {
  constructor(private readonly host: HTMLElement) {}

  render(result: MetricResult, notes: string[]): void {
    const rows = result.rows
      .map((row) => {
        const trend = row.delta === 0 ? "same" : row.better === "down" ? (row.delta < 0 ? "improved" : "worse") : row.delta > 0 ? "improved" : "worse";
        return `<tr class="metric-${trend}"><td>${row.label}</td><td>${fmt(row.before)}</td><td>${fmt(row.after)}</td><td>${fmt(row.delta, true)}</td><td>${trend}</td></tr>`;
      })
      .join("");

    const invariant = result.invariant.checked
      ? result.invariant.violations.length === 0
        ? "PASS"
        : `FAIL (${result.invariant.violations.length})`
      : "SKIPPED";

    this.host.innerHTML = `
      <div class="metrics-header">
        <strong>Metrics Panel</strong>
        <span>Scope: ${result.scopeText}</span>
        <span>Invariant: ${invariant}</span>
      </div>
      <table>
        <thead>
          <tr><th>Metric</th><th>Before</th><th>After</th><th>Delta</th><th>Status</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="metrics-notes">${notes.length ? notes.join(" | ") : "No preprocessing"}</div>
    `;
  }
}

function fmt(v: number, sign = false): string {
  if (!Number.isFinite(v)) {
    return "-";
  }
  if (Math.abs(v) >= 1000) {
    return sign ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}` : v.toFixed(1);
  }
  const s = v.toFixed(3);
  return sign ? `${v >= 0 ? "+" : ""}${s}` : s;
}
