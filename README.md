# Distribution-aware Braided Streamgraph Demo

This TypeScript/D3 prototype treats every category-time cell as a distribution.
Colored thickness shows its smoothed median; a lighter same-hue tint shows space
allocated from the mean absolute deviation to exterior asymmetry and KDE-derived
low-density separations. Modal basin probability partitions the colored
thickness into branches; a neutral outline marks the complete envelope.

TCM weighted scalar sets and COVID weighted member-quantile mixtures use the
same analysis and geometry pipeline. The only statistical resolution control is
the shared KDE ratio `beta` in `h = beta * standardDeviation(P)`.

```bash
npm install
npm test
npm run dev
npm run build
```

See [METHOD.md](METHOD.md) for the implemented equations and semantic contract.
