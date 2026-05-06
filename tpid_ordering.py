import numpy as np
import pandas as pd
from typing import Tuple, List, Dict, Optional


def prepare_quantile_tensor(df: pd.DataFrame, layer_col='layer_id', time_col='time', quantile_col='quantile', value_col='value'):
    """Return (quantile_tensor, layer_ids, times, tau_levels)
    quantile_tensor shape: (N_layers, N_times, N_tau)
    """
    layers = list(pd.Index(df[layer_col].values).unique())
    times = sorted(df[time_col].unique())
    tau_levels = sorted(df[quantile_col].unique())

    N = len(layers)
    T = len(times)
    L = len(tau_levels)

    layer_index = {l: i for i, l in enumerate(layers)}
    time_index = {t: i for i, t in enumerate(times)}

    qt = np.full((N, T, L), np.nan, dtype=float)

    for _, row in df.iterrows():
        i = layer_index[row[layer_col]]
        k = time_index[row[time_col]]
        try:
            j = tau_levels.index(row[quantile_col])
        except ValueError:
            # skip unexpected tau
            continue
        qt[i, k, j] = float(row[value_col])

    return qt, layers, times, np.array(tau_levels)


def make_y_grid(quantile_tensor: np.ndarray, num_y: int = 256, padding: float = 0.05) -> np.ndarray:
    # Use the 2.5% and 97.5% quantile anchors if available, otherwise min/max across tensor
    # quantile_tensor shape: (N, T, L_tau)
    finite = np.isfinite(quantile_tensor)
    if finite.sum() == 0:
        raise ValueError('Empty quantile tensor')

    vals = quantile_tensor[finite]
    qmin = np.nanpercentile(vals, 2.5)
    qmax = np.nanpercentile(vals, 97.5)
    if qmax == qmin:
        qmin -= 0.5
        qmax += 0.5

    span = qmax - qmin
    qmin -= padding * span
    qmax += padding * span

    y = np.linspace(qmin, qmax, num_y)
    return y


def _ensure_monotonic(q_vals: np.ndarray) -> np.ndarray:
    # enforce non-decreasing quantiles with small jitter for duplicates
    q = np.array(q_vals, dtype=float)
    # replace nan with previous or next if possible
    nan_mask = np.isnan(q)
    if nan_mask.any():
        # forward fill then back fill
        idx = np.where(~nan_mask)[0]
        if idx.size == 0:
            return q
        first, last = idx[0], idx[-1]
        for i in range(first):
            q[i] = q[first]
        for i in range(last + 1, len(q)):
            q[i] = q[last]
        for i in range(first, last + 1):
            if np.isnan(q[i]):
                # linear interp between neighbors
                left = i - 1
                while left >= 0 and np.isnan(q[left]):
                    left -= 1
                right = i + 1
                while right < len(q) and np.isnan(q[right]):
                    right += 1
                if left >= 0 and right < len(q):
                    q[i] = (q[left] + q[right]) / 2.0
                elif left >= 0:
                    q[i] = q[left]
                else:
                    q[i] = q[right]

    # ensure non-decreasing
    for i in range(1, len(q)):
        if q[i] < q[i - 1]:
            q[i] = q[i - 1]

    # fix duplicates by tiny jitter
    diffs = np.diff(q)
    if np.any(diffs == 0):
        eps = max(1e-9, 1e-8 * (np.max(q) - np.min(q) if np.max(q) != np.min(q) else 1.0))
        for i in range(1, len(q)):
            if q[i] <= q[i - 1]:
                q[i] = q[i - 1] + eps

    return q


def build_membership_tensor(quantile_tensor: np.ndarray, tau_levels: np.ndarray, y_grid: np.ndarray, membership_anchor: Optional[Dict[float, float]] = None, a: float = 0.5) -> np.ndarray:
    """Build U: shape (N, T, L_y) mapping values to central-membership in [0,1].

    membership_anchor: dict mapping anchor taus to g values; if None use defaults with 'a'.
    """
    N, T, Ltau = quantile_tensor.shape
    Ly = len(y_grid)
    U = np.zeros((N, T, Ly), dtype=float)

    if membership_anchor is None:
        membership_anchor = {0.025: 0.0, 0.25: a, 0.5: 1.0, 0.75: a, 0.975: 0.0}

    # Prepare g mapping in probability space
    anchor_taus = np.array(sorted(membership_anchor.keys()))
    anchor_g = np.array([membership_anchor[t] for t in anchor_taus])

    for i in range(N):
        for k in range(T):
            q_raw = quantile_tensor[i, k, :]
            # enforce monotonic quantiles in value space
            q = _ensure_monotonic(q_raw)

            # if still nan or degenerate, skip (U remains zeros)
            if not np.all(np.isfinite(q)):
                continue

            # F_hat(y) via interpolation: map y_grid -> tau
            # taus are tau_levels, q are values
            try:
                F_hat = np.interp(y_grid, q, tau_levels, left=0.0, right=1.0)
            except Exception:
                # fallback: if q not strictly increasing, jittered already
                F_hat = np.interp(y_grid, q, tau_levels, left=0.0, right=1.0)

            # Map through g by interpolating in tau space
            g_vals = np.interp(F_hat, anchor_taus, anchor_g)

            # Zero outside the central anchor extents
            low = membership_anchor.keys()
            min_tau = min(anchor_taus)
            max_tau = max(anchor_taus)
            # Determine value bounds for mask using Q( min_tau ) and Q( max_tau )
            q_min_val = np.interp(min_tau, tau_levels, q)
            q_max_val = np.interp(max_tau, tau_levels, q)

            mask = (y_grid >= q_min_val) & (y_grid <= q_max_val)
            u = np.zeros_like(g_vals)
            u[mask] = g_vals[mask]
            u = np.clip(u, 0.0, 1.0)
            U[i, k, :] = u

    return U


def probabilistic_inclusion(u: np.ndarray, v: np.ndarray, weights: Optional[np.ndarray] = None, eps: float = 1e-12) -> float:
    """I(u,v) = sum w * u * v / (sum w * u + eps)"""
    u = np.asarray(u, dtype=float)
    v = np.asarray(v, dtype=float)
    if weights is None:
        weights = np.ones_like(u)
    num = np.sum(weights * u * v)
    den = np.sum(weights * u) + eps
    return float(num / den)


def compute_cross_layer_tpid(U: np.ndarray, method: str = "mean", return_pairwise: bool = False, weights: Optional[np.ndarray] = None, eps: float = 1e-12):
    N, T, Ly = U.shape
    if weights is None:
        weights = np.ones(Ly)

    D_cross = np.zeros((N, T), dtype=float)
    P_tensor = None

    if method == "pairwise":
        P_tensor = np.zeros((T, N, N), dtype=float)
        for k in range(T):
            for i in range(N):
                ui = U[i, k, :]
                for j in range(N):
                    uj = U[j, k, :]
                    P_tensor[k, i, j] = probabilistic_inclusion(ui, uj, weights=weights, eps=eps)

            for i in range(N):
                # IN_in = mean_j != i P_ij
                in_in = np.mean(np.delete(P_tensor[k, i, :], i)) if N > 1 else 0.0
                in_out = np.mean(np.delete(P_tensor[k, :, i], i)) if N > 1 else 0.0
                D_cross[i, k] = min(in_in, in_out)

    elif method == "mean":
        for k in range(T):
            # precompute mean of all U at time k
            U_k = U[:, k, :]
            mean_all = np.mean(U_k, axis=0)
            for i in range(N):
                if N > 1:
                    mean_minus_i = (np.sum(U_k, axis=0) - U_k[i]) / (N - 1)
                else:
                    mean_minus_i = np.zeros(Ly)
                a = probabilistic_inclusion(U_k[i], mean_minus_i, weights=weights, eps=eps)
                b = probabilistic_inclusion(mean_minus_i, U_k[i], weights=weights, eps=eps)
                D_cross[i, k] = min(a, b)
    else:
        raise ValueError('Unknown method: ' + str(method))

    if return_pairwise:
        return D_cross, P_tensor
    return D_cross


def shift_membership_on_grid(u: np.ndarray, y_grid: np.ndarray, delta: float) -> np.ndarray:
    # u defined on y_grid. We want u_shifted(y) = u(y - delta)
    yq = y_grid - delta
    u_shifted = np.interp(y_grid, yq, u, left=0.0, right=0.0)
    return u_shifted


def compute_temporal_self_inclusion(U: np.ndarray, medians: np.ndarray, y_grid: np.ndarray, align: str = "median_shift", weights: Optional[np.ndarray] = None, eps: float = 1e-12):
    # U: (N,T,Ly), medians: (N,T)
    N, T, Ly = U.shape
    if weights is None:
        weights = np.ones(Ly)

    R = np.zeros((N, max(0, T - 1)), dtype=float)
    F_forward = np.zeros_like(R)
    B_backward = np.zeros_like(R)

    for i in range(N):
        for k in range(1, T):
            u_prev = U[i, k - 1, :]
            if align == "median_shift":
                delta = medians[i, k] - medians[i, k - 1]
                u_prev_shifted = shift_membership_on_grid(u_prev, y_grid, delta)
            else:
                u_prev_shifted = u_prev.copy()

            u_curr = U[i, k, :]
            fwd = probabilistic_inclusion(u_curr, u_prev_shifted, weights=weights, eps=eps)
            back = probabilistic_inclusion(u_prev_shifted, u_curr, weights=weights, eps=eps)
            F_forward[i, k - 1] = fwd
            B_backward[i, k - 1] = back
            R[i, k - 1] = min(fwd, back)

    return R, F_forward, B_backward


def aggregate_layer_scores(D_cross: np.ndarray, R_temporal: np.ndarray, layer_ids: List, lambda_cross: float = 0.8, beta_volatility: float = 0.1, use_lexicographic: bool = False) -> pd.DataFrame:
    # D_cross: (N, T)
    # R_temporal: (N, T-1)
    N, T = D_cross.shape
    C = np.mean(D_cross, axis=1)
    V = np.std(D_cross, axis=1)
    if R_temporal.size == 0:
        R = np.zeros(N)
    else:
        R = np.mean(R_temporal, axis=1)

    score = lambda_cross * C + (1 - lambda_cross) * R - beta_volatility * V

    df = pd.DataFrame({
        'layer_id': list(layer_ids),
        'C': C,
        'R': R,
        'V': V,
        'score': score
    })

    if use_lexicographic:
        df = df.sort_values(by=['C', 'R', 'V'], ascending=[False, False, True]).reset_index(drop=True)
    else:
        df = df.sort_values(by='score', ascending=False).reset_index(drop=True)

    df['depth_rank'] = np.arange(len(df))
    return df


def center_out_stack_order(layer_scores: pd.DataFrame) -> List:
    # layer_scores already sorted from most central -> peripheral (descending score)
    ranked = list(layer_scores['layer_id'])
    N = len(ranked)
    positions = [-1] * N
    center = N // 2
    # center-out sequence indices
    seq = [center]
    for d in range(1, N):
        if (center - d) >= 0:
            seq.append(center - d)
        if (center + d) < N:
            seq.append(center + d)

    # assign ranked layers to positions
    for pos, layer in zip(seq, ranked):
        positions[pos] = layer

    # positions list maps position index -> layer_id; bottom is index 0
    # Build stack order bottom-to-top
    stack_order = [positions[i] for i in range(N)]
    return stack_order


def compute_quantile_membership_tpid_ordering(df: pd.DataFrame,
                                              layer_col='layer_id',
                                              time_col='time',
                                              quantile_col='quantile',
                                              value_col='value',
                                              num_y: int = 256,
                                              a: float = 0.5,
                                              method: str = 'mean',
                                              align: str = 'median_shift',
                                              lambda_cross: float = 0.8,
                                              beta_volatility: float = 0.1,
                                              use_lexicographic: bool = False,
                                              tau_prior: Optional[List[float]] = None) -> Dict:
    qt, layers, times, tau_levels = prepare_quantile_tensor(df, layer_col, time_col, quantile_col, value_col)
    if tau_prior is not None:
        tau_levels = np.array(sorted(tau_prior))

    y_grid = make_y_grid(qt, num_y=num_y)
    U = build_membership_tensor(qt, tau_levels, y_grid, membership_anchor=None, a=a)

    weights = np.ones(len(y_grid))
    D_cross = compute_cross_layer_tpid(U, method=method, return_pairwise=False, weights=weights)

    # medians: need to extract Q(0.5)
    # find index of 0.5 in tau_levels
    try:
        mid_idx = list(tau_levels).index(0.5)
    except ValueError:
        # if no 0.5, approximate via linear interpolation along tau axis
        # Not implemented here; raise for now
        raise ValueError('tau_levels must include 0.5 for median alignment')

    N, T, _ = qt.shape
    medians = np.zeros((N, T), dtype=float)
    for i in range(N):
        for k in range(T):
            medians[i, k] = qt[i, k, mid_idx]

    R_temporal, F_forward, B_backward = compute_temporal_self_inclusion(U, medians, y_grid, align=align, weights=weights)

    layer_scores = aggregate_layer_scores(D_cross, R_temporal, layers, lambda_cross=lambda_cross, beta_volatility=beta_volatility, use_lexicographic=use_lexicographic)

    stack_order = center_out_stack_order(layer_scores)

    result = {
        'U': U,
        'y_grid': y_grid,
        'D_cross': D_cross,
        'R_temporal': R_temporal,
        'layer_scores': layer_scores,
        'stack_order': stack_order,
        'F_forward': F_forward,
        'B_backward': B_backward
    }

    # summary prints
    top5 = list(layer_scores['layer_id'].head(5))
    bottom5 = list(layer_scores['layer_id'].tail(5))
    meanC = float(np.mean(layer_scores['C']))
    meanR = float(np.mean(layer_scores['R']))
    meanV = float(np.mean(layer_scores['V']))
    print('Top 5 central layers:', top5)
    print('Bottom 5 peripheral layers:', bottom5)
    print(f'mean C={meanC:.4f}, mean R={meanR:.4f}, mean V={meanV:.4f}')

    return result
