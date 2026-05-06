import numpy as np
import pandas as pd
from tpid_ordering import compute_quantile_membership_tpid_ordering


def make_synthetic(N_layers=5, T=20):
    taus = [0.025, 0.25, 0.5, 0.75, 0.975]
    rows = []
    layer_names = [f'L{i}' for i in range(N_layers)]

    times = list(range(T))

    for i, lid in enumerate(layer_names):
        for t in times:
            # define median and spread per case
            if i == 0:
                # central stable
                m = 0.0 + 0.05 * np.sin(0.2 * t)
                s = 0.2
            elif i == 1:
                # shifted upward gradually
                m = 1.5 + 0.1 * t
                s = 0.15
            elif i == 2:
                # wide uncertainty
                m = -0.5 + 0.02 * t
                s = 0.8
            elif i == 3:
                # abrupt jumps
                m = 0.8 if t < T // 2 else -1.2
                s = 0.12
            else:
                # peripheral stable negative
                m = -1.0 + 0.03 * t
                s = 0.18

            # create quantile values around median
            q025 = m - 2.0 * s
            q25 = m - s
            q50 = m
            q75 = m + s
            q975 = m + 2.0 * s

            for tau, val in zip(taus, [q025, q25, q50, q75, q975]):
                # small jitter
                v = val + np.random.normal(scale=1e-3)
                rows.append({'layer_id': lid, 'time': t, 'quantile': tau, 'value': float(v)})

    df = pd.DataFrame(rows)
    return df


def main():
    df = make_synthetic()
    res = compute_quantile_membership_tpid_ordering(df)
    print('\nLayer scores:')
    print(res['layer_scores'])
    print('\nStack order (bottom->top):')
    print(res['stack_order'])


if __name__ == '__main__':
    main()
