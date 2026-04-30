# Multiscale Parameter Search Report

Generated at: 2026-04-26T16:28:23.601Z

Search policy:
- ROI-first ranking with global guardrail
- Significant improvement threshold: >= 5%
- Regression guardrail: <= 3%
- Core metrics: meanSlope, wiggle, illusion

## Dataset: synthetic

- ROI: [136, 189] (span=54)
- candidates: total=792, pass=0, fail=792
- best: status=FAIL; center=harmonic, weight=0.150, threshold=0.040; ROI max=+2.86%; ROI avg=+0.23%; Global avg=+0.53%; fallback=no; verified=yes; reason=ROI max improvement 2.86% < 5.00%

| Rank | Status | Params | ROI (mean/wiggle/illusion) | Global (mean/wiggle/illusion) | Reason |
|---:|---|---|---|---|---|
| 1 | FAIL | center=harmonic, weight=0.150, threshold=0.040 | +2.86% / -1.72% / -0.45% | +0.88% / +0.84% / -0.15% | ROI max improvement 2.86% < 5.00% |
| 2 | FAIL | center=harmonic, weight=0.150, threshold=0.060 | +2.86% / -1.72% / -0.45% | +0.88% / +0.84% / -0.15% | ROI max improvement 2.86% < 5.00% |
| 3 | FAIL | center=harmonic, weight=0.150, threshold=0.080 | +2.86% / -1.72% / -0.45% | +0.88% / +0.84% / -0.15% | ROI max improvement 2.86% < 5.00% |
| 4 | FAIL | center=harmonic, weight=0.150, threshold=0.100 | +2.86% / -1.72% / -0.45% | +0.88% / +0.84% / -0.15% | ROI max improvement 2.86% < 5.00% |
| 5 | FAIL | center=harmonic, weight=0.150, threshold=0.120 | +2.86% / -1.72% / -0.45% | +0.88% / +0.84% / -0.15% | ROI max improvement 2.86% < 5.00% |

## Dataset: covid

- ROI: [97, 134] (span=38)
- candidates: total=792, pass=0, fail=792
- best: status=FAIL; center=mean, weight=1.200, threshold=0.040; ROI max=-0.45%; ROI avg=-2.29%; Global avg=-12.96%; fallback=no; verified=yes; reason=ROI max improvement -0.45% < 5.00% | ROI meanSlope regressed 5.71% > 3.00% | Global meanSlope regressed 26.41% > 3.00% | Global wiggle regressed 6.61% > 3.00% | Global illusion regressed 5.88% > 3.00%

| Rank | Status | Params | ROI (mean/wiggle/illusion) | Global (mean/wiggle/illusion) | Reason |
|---:|---|---|---|---|---|
| 1 | FAIL | center=mean, weight=1.200, threshold=0.040 | -5.71% / -0.72% / -0.45% | -26.41% / -6.61% / -5.88% | ROI max improvement -0.45% < 5.00% | ROI meanSlope regressed 5.71% > 3.00% | Global meanSlope regressed 26.41% > 3.00% | Global wiggle regressed 6.61% > 3.00% | Global illusion regressed 5.88% > 3.00% |
| 2 | FAIL | center=mean, weight=1.200, threshold=0.060 | -5.71% / -0.72% / -0.45% | -26.41% / -6.61% / -5.88% | ROI max improvement -0.45% < 5.00% | ROI meanSlope regressed 5.71% > 3.00% | Global meanSlope regressed 26.41% > 3.00% | Global wiggle regressed 6.61% > 3.00% | Global illusion regressed 5.88% > 3.00% |
| 3 | FAIL | center=mean, weight=1.200, threshold=0.080 | -5.71% / -0.72% / -0.45% | -26.41% / -6.61% / -5.88% | ROI max improvement -0.45% < 5.00% | ROI meanSlope regressed 5.71% > 3.00% | Global meanSlope regressed 26.41% > 3.00% | Global wiggle regressed 6.61% > 3.00% | Global illusion regressed 5.88% > 3.00% |
| 4 | FAIL | center=mean, weight=1.200, threshold=0.100 | -5.71% / -0.72% / -0.45% | -26.41% / -6.61% / -5.88% | ROI max improvement -0.45% < 5.00% | ROI meanSlope regressed 5.71% > 3.00% | Global meanSlope regressed 26.41% > 3.00% | Global wiggle regressed 6.61% > 3.00% | Global illusion regressed 5.88% > 3.00% |
| 5 | FAIL | center=mean, weight=1.200, threshold=0.120 | -5.71% / -0.72% / -0.45% | -26.41% / -6.61% / -5.88% | ROI max improvement -0.45% < 5.00% | ROI meanSlope regressed 5.71% > 3.00% | Global meanSlope regressed 26.41% > 3.00% | Global wiggle regressed 6.61% > 3.00% | Global illusion regressed 5.88% > 3.00% |
