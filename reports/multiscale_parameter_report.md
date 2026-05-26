# Multiscale Parameter Search Report

Generated at: 2026-05-24T16:12:07.425Z

Search policy:
- ROI-first ranking with global guardrail
- Significant improvement threshold: >= 5%
- Regression guardrail: <= 3%
- Core metrics: meanSlope, wiggle, illusion
- Multiscale waveStrength controls layer-slope wave basis amplitude

## Dataset: synthetic

- ROI: [136, 189] (span=54)
- candidates: total=792, pass=331, fail=461
- best: status=PASS; center=harmonic, wave=0.450, threshold=0.060; ROI max=+94.13%; ROI avg=+53.12%; Global avg=+47.17%; fallback=no; verified=yes; reason=ROI max improvement 94.13% | ROI avg improvement 53.12% | Global avg improvement 47.17%

| Rank | Status | Params | ROI (mean/wiggle/illusion) | Global (mean/wiggle/illusion) | Reason |
|---:|---|---|---|---|---|
| 1 | PASS | center=harmonic, wave=0.450, threshold=0.060 | +3.53% / +94.13% / +61.71% | +1.35% / +88.58% / +51.57% | ROI max improvement 94.13% | ROI avg improvement 53.12% | Global avg improvement 47.17% |
| 2 | PASS | center=harmonic, wave=0.400, threshold=0.060 | +3.52% / +93.70% / +60.71% | +1.57% / +88.37% / +51.35% | ROI max improvement 93.70% | ROI avg improvement 52.64% | Global avg improvement 47.09% |
| 3 | PASS | center=harmonic, wave=1.150, threshold=0.140 | +3.58% / +92.90% / +59.92% | +0.16% / +69.05% / +35.51% | ROI max improvement 92.90% | ROI avg improvement 52.13% | Global avg improvement 34.91% |
| 4 | PASS | center=harmonic, wave=1.150, threshold=0.160 | +3.58% / +92.90% / +59.92% | +0.16% / +69.05% / +35.51% | ROI max improvement 92.90% | ROI avg improvement 52.13% | Global avg improvement 34.91% |
| 5 | PASS | center=harmonic, wave=1.150, threshold=0.180 | +3.58% / +92.90% / +59.92% | +0.16% / +69.05% / +35.51% | ROI max improvement 92.90% | ROI avg improvement 52.13% | Global avg improvement 34.91% |

## Dataset: covid

- ROI: [97, 134] (span=38)
- candidates: total=792, pass=0, fail=792
- best: status=FAIL; center=harmonic, wave=0.200, threshold=0.120; ROI max=+2.59%; ROI avg=+0.13%; Global avg=+12.77%; fallback=no; verified=yes; reason=ROI max improvement 2.59% < 5.00% | ROI meanSlope regressed 3.71% > 3.00%

| Rank | Status | Params | ROI (mean/wiggle/illusion) | Global (mean/wiggle/illusion) | Reason |
|---:|---|---|---|---|---|
| 1 | FAIL | center=harmonic, wave=0.200, threshold=0.120 | -3.71% / +2.59% / +1.50% | +2.64% / +23.63% / +12.05% | ROI max improvement 2.59% < 5.00% | ROI meanSlope regressed 3.71% > 3.00% |
| 2 | FAIL | center=harmonic, wave=0.250, threshold=0.120 | -6.21% / +2.48% / +1.49% | +2.38% / +26.45% / +13.45% | ROI max improvement 2.48% < 5.00% | ROI meanSlope regressed 6.21% > 3.00% |
| 3 | FAIL | center=harmonic, wave=0.150, threshold=0.120 | -1.78% / +2.47% / +1.42% | +2.72% / +21.10% / +10.88% | ROI max improvement 2.47% < 5.00% |
| 4 | FAIL | center=harmonic, wave=0.500, threshold=0.140 | -2.56% / +2.43% / +1.66% | +1.54% / +29.20% / +15.01% | ROI max improvement 2.43% < 5.00% |
| 5 | FAIL | center=harmonic, wave=0.450, threshold=0.140 | -1.94% / +2.42% / +1.63% | +1.77% / +27.29% / +13.95% | ROI max improvement 2.42% < 5.00% |
