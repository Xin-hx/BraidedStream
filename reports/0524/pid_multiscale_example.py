from pathlib import Path

import numpy as np

try:
    import matplotlib.pyplot as plt
except ImportError as exc:
    raise SystemExit("This example needs matplotlib. Install it with: pip install matplotlib") from exc


EPS = 1e-12


def normalize01(values):
    values = np.asarray(values, dtype=float)
    lo = np.nanmin(values)
    hi = np.nanmax(values)
    if not np.isfinite(lo) or not np.isfinite(hi) or abs(hi - lo) <= EPS:
        return np.zeros_like(values)
    return (values - lo) / (hi - lo)


def moving_average(values, window):
    values = np.asarray(values, dtype=float)
    out = np.zeros_like(values)
    half = window // 2
    for i in range(len(values)):
        left = max(0, i - half)
        right = min(len(values), i + half + 1)
        out[i] = np.mean(values[left:right])
    return out


def make_layers():
    t = np.arange(12)
    centers = np.array(
        [
            2.0 + 0.35 * np.sin(t / 1.6),
            2.1 + 0.20 * np.cos((t - 2) / 1.8),
            1.2 + 0.12 * t + 0.25 * np.sin((t + 1) / 2.0),
        ]
    )
    widths = np.array(
        [
            0.45 + 0.08 * np.cos(t / 2.0),
            0.35 + 0.20 * np.exp(-((t - 6) ** 2) / 8),
            0.55 + 0.06 * np.sin(t / 2.2),
        ]
    )
    lows = centers - widths
    highs = centers + widths
    ids = ["A", "B", "C"]
    return t, ids, centers, lows, highs


def interval_pid(centers, lows, highs, penalty_power=1.0):
    n, t_len = centers.shape
    depth_series = np.full((n, t_len), np.nan)
    for i in range(n):
        for t in range(t_len):
            widths = []
            for j in range(n):
                if i == j:
                    continue
                widths.append(max(EPS, highs[j, t] - lows[j, t]))
            width_ref = max(EPS, np.median(widths))

            covered = 0.0
            total = 0.0
            for j in range(n):
                if i == j:
                    continue
                width = max(EPS, highs[j, t] - lows[j, t])
                weight = 1.0 / ((1.0 + width / width_ref) ** penalty_power)
                total += weight
                if lows[j, t] <= centers[i, t] <= highs[j, t]:
                    covered += weight
            depth_series[i, t] = covered / max(EPS, total)
    return depth_series, np.nanmean(depth_series, axis=1)


def triangular_mask(center, low, high, y_grid):
    left = np.clip((y_grid - low) / max(EPS, center - low), 0, 1)
    right = np.clip((high - y_grid) / max(EPS, high - center), 0, 1)
    return np.minimum(left, right)


def contour_pid_mean(centers, lows, highs, y_bins=160):
    n, t_len = centers.shape
    y_min = float(np.min(lows) - 0.2)
    y_max = float(np.max(highs) + 0.2)
    y_grid = np.linspace(y_min, y_max, y_bins)
    masks = np.zeros((n, y_bins, t_len))
    for i in range(n):
        for t in range(t_len):
            masks[i, :, t] = triangular_mask(centers[i, t], lows[i, t], highs[i, t], y_grid)

    mean_mask = np.mean(masks, axis=0)
    area_mean = np.sum(mean_mask)
    depths = []
    for i in range(n):
        area = np.sum(masks[i])
        overlap = np.sum(masks[i] * mean_mask)
        in_score = overlap / max(EPS, area)
        out_score = overlap / max(EPS, area_mean)
        depths.append(min(in_score, out_score))
    return y_grid, masks, mean_mask, np.array(depths)


def haar_bands(signal):
    signal = np.asarray(signal, dtype=float)
    n = len(signal)
    padded_len = 1
    while padded_len < n:
        padded_len *= 2
    current = np.full(padded_len, signal[-1])
    current[:n] = signal

    bands = []
    level = 1
    while len(current) >= 2:
        next_values = []
        details = []
        for i in range(0, len(current), 2):
            a = current[i]
            b = current[i + 1]
            next_values.append((a + b) / np.sqrt(2))
            details.append((a - b) / np.sqrt(2))
        details = np.asarray(details)
        scale = 2**level
        saliency = np.zeros(padded_len)
        for idx, value in enumerate(details):
            saliency[idx * scale : min(padded_len, (idx + 1) * scale)] = abs(value)
        bands.append({"scale": scale, "energy": float(np.sum(details**2)), "saliency": saliency[:n]})
        current = np.asarray(next_values)
        level += 1
    return bands


def multiscale_baseline(centers):
    n, t_len = centers.shape
    total = np.sum(centers, axis=0)

    # A deliberately bumpy anchor centerline for the small visual example.
    time = np.arange(t_len)
    anchor_centerline = 0.18 * np.sin(time / 1.5)
    anchor_centerline[5] += 0.75
    anchor_centerline[6] -= 0.45
    anchor_baseline = anchor_centerline - 0.5 * total
    anchor_derivative = np.r_[0, np.diff(anchor_centerline)]

    raw_slope = np.zeros(t_len)
    for t in range(1, t_len):
        numerator = np.sum(np.abs(centers[:, t] - centers[:, t - 1]))
        denominator = np.sum(0.5 * (centers[:, t] + centers[:, t - 1]))
        raw_slope[t] = numerator / max(EPS, denominator)
    variation = np.r_[0, np.abs(np.diff(raw_slope))]
    signal = 0.75 * normalize01(raw_slope) + 0.25 * normalize01(variation)

    bands = haar_bands(signal)
    total_energy = sum(b["energy"] for b in bands)
    for b in bands:
        b["ratio"] = b["energy"] / max(EPS, total_energy)
    selected = sorted(bands, key=lambda b: b["ratio"], reverse=True)[:2]

    shift = np.zeros(t_len)
    for band in selected:
        saliency = 0.5 * normalize01(band["saliency"]) + 0.5 * signal
        local_derivative = saliency * anchor_derivative
        smooth_derivative = moving_average(local_derivative, int(max(3, 2 * band["scale"] + 1)))
        derivative_basis = smooth_derivative - local_derivative
        derivative_basis[1:] -= np.mean(derivative_basis[1:])
        basis_shift = np.cumsum(0.55 * derivative_basis)
        basis_shift -= np.mean(basis_shift)
        shift += basis_shift

    multiscale_baseline = anchor_baseline + shift
    multiscale_centerline = multiscale_baseline + 0.5 * total
    return signal, selected, anchor_centerline, multiscale_centerline


def main():
    out_dir = Path(__file__).resolve().parent
    out_path = out_dir / "pid_multiscale_example.png"

    t, ids, centers, lows, highs = make_layers()
    depth_series, interval_scores = interval_pid(centers, lows, highs)
    y_grid, masks, mean_mask, contour_scores = contour_pid_mean(centers, lows, highs)
    signal, selected, anchor_centerline, multiscale_centerline = multiscale_baseline(centers)

    fig, axes = plt.subplots(2, 2, figsize=(13, 8), constrained_layout=True)
    colors = ["#2563eb", "#dc2626", "#16a34a"]

    ax = axes[0, 0]
    for i, layer_id in enumerate(ids):
        ax.fill_between(t, lows[i], highs[i], color=colors[i], alpha=0.16)
        ax.plot(t, centers[i], color=colors[i], linewidth=2.2, label=f"Layer {layer_id}")
    ax.set_title("Synthetic layers: center line and uncertainty band")
    ax.set_xlabel("time")
    ax.set_ylabel("value")
    ax.legend(loc="upper left")

    ax = axes[0, 1]
    for i, layer_id in enumerate(ids):
        ax.plot(t, depth_series[i], color=colors[i], marker="o", label=f"{layer_id}: avg={interval_scores[i]:.2f}")
    ax.set_ylim(-0.05, 1.05)
    ax.set_title("Interval PID depth over time")
    ax.set_xlabel("time")
    ax.set_ylabel("depth")
    ax.legend(loc="lower right")

    ax = axes[1, 0]
    image = ax.imshow(mean_mask, origin="lower", aspect="auto", extent=[t[0], t[-1], y_grid[0], y_grid[-1]], cmap="magma")
    ax.plot(t, centers[np.argmax(contour_scores)], color="cyan", linewidth=2.0, label="deepest by PID-Mean")
    ax.set_title("Contour PID-Mean: average fuzzy mask")
    ax.set_xlabel("time")
    ax.set_ylabel("value grid")
    ax.legend(loc="upper left")
    fig.colorbar(image, ax=ax, fraction=0.046, pad=0.04)

    ax = axes[1, 1]
    ax.plot(t, anchor_centerline, color="#dc2626", linewidth=2.4, label="anchor centerline")
    ax.plot(t, multiscale_centerline, color="#16a34a", linewidth=2.8, label="multiscale centerline")
    ax.fill_between(t, 0, signal, color="#64748b", alpha=0.18, label="slope signal")
    subtitle = ", ".join(f"scale {b['scale']} ({b['ratio']:.2f})" for b in selected)
    ax.set_title(f"Multiscale redistribution; selected {subtitle}")
    ax.set_xlabel("time")
    ax.set_ylabel("centerline / signal")
    ax.legend(loc="upper left")

    fig.suptitle("PID and multiscale toy example", fontsize=15)
    fig.savefig(out_path, dpi=180)
    print(f"Saved {out_path}")


if __name__ == "__main__":
    main()

