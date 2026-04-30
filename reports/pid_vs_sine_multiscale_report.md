# PID-vs-Sine Multiscale Search Report

Generated at: 2026-04-26T17:23:30.498Z

Strategy:
- Control: SineStream layer ordering + SineStream baseline
- Experiment: PID layer ordering + Multiscale uncertainty baseline
- Objective: maximize readability improvement on meanSlope/wiggle/illusion
- Ranking: pass first, then ROI max, ROI avg, Global avg
- Guardrail: no metric regression worse than 3% in ROI/Global

## Dataset: synthetic

- ROI: [136, 189] (span=54)
- control order (Sine): L8, L4, L1, L5, L2, L6, L3, L7
- experiment order (PID): L1, L2, L3, L5, L4, L6, L7, L8
- candidates: total=792, pass=0, fail=792
- best: status=FAIL; center=mean, weight=0.150, threshold=0.040; ROI max=+9.76%; ROI avg=-0.71%; Global avg=-22.43%; fallback=no; verified=yes; reason=ROI wiggle regressed 8.15% > 3.00% | ROI illusion regressed 3.75% > 3.00% | Global meanSlope regressed 20.27% > 3.00% | Global wiggle regressed 31.67% > 3.00% | Global illusion regressed 15.33% > 3.00%

| Rank | Status | Params | ROI (mean/wiggle/illusion) | Global (mean/wiggle/illusion) | Reason |
|---:|---|---|---|---|---|
| 1 | FAIL | center=mean, weight=0.150, threshold=0.040 | +9.76% / -8.15% / -3.75% | -20.27% / -31.67% / -15.33% | ROI wiggle regressed 8.15% > 3.00% | ROI illusion regressed 3.75% > 3.00% | Global meanSlope regressed 20.27% > 3.00% | Global wiggle regressed 31.67% > 3.00% | Global illusion regressed 15.33% > 3.00% |
| 2 | FAIL | center=mean, weight=0.150, threshold=0.060 | +9.76% / -8.15% / -3.75% | -20.27% / -31.67% / -15.33% | ROI wiggle regressed 8.15% > 3.00% | ROI illusion regressed 3.75% > 3.00% | Global meanSlope regressed 20.27% > 3.00% | Global wiggle regressed 31.67% > 3.00% | Global illusion regressed 15.33% > 3.00% |
| 3 | FAIL | center=mean, weight=0.150, threshold=0.080 | +9.76% / -8.15% / -3.75% | -20.27% / -31.67% / -15.33% | ROI wiggle regressed 8.15% > 3.00% | ROI illusion regressed 3.75% > 3.00% | Global meanSlope regressed 20.27% > 3.00% | Global wiggle regressed 31.67% > 3.00% | Global illusion regressed 15.33% > 3.00% |
| 4 | FAIL | center=mean, weight=0.150, threshold=0.100 | +9.76% / -8.15% / -3.75% | -20.27% / -31.67% / -15.33% | ROI wiggle regressed 8.15% > 3.00% | ROI illusion regressed 3.75% > 3.00% | Global meanSlope regressed 20.27% > 3.00% | Global wiggle regressed 31.67% > 3.00% | Global illusion regressed 15.33% > 3.00% |
| 5 | FAIL | center=mean, weight=0.150, threshold=0.120 | +9.76% / -8.15% / -3.75% | -20.27% / -31.67% / -15.33% | ROI wiggle regressed 8.15% > 3.00% | ROI illusion regressed 3.75% > 3.00% | Global meanSlope regressed 20.27% > 3.00% | Global wiggle regressed 31.67% > 3.00% | Global illusion regressed 15.33% > 3.00% |

## Dataset: covid

- ROI: [97, 134] (span=38)
- control order (Sine): FL, IN, NH, SD, AK, KS, UT, PR ... (+48)
- experiment order (PID): TX, NY, NC, MP, PA, MI, VI, AZ ... (+48)
- candidates: total=792, pass=594, fail=198
- best: status=PASS; center=mean, weight=0.150, threshold=0.040; ROI max=+42.36%; ROI avg=+34.04%; Global avg=+33.22%; fallback=no; verified=yes; reason=ROI max improvement 42.36% | ROI avg improvement 34.04% | Global avg improvement 33.22%

| Rank | Status | Params | ROI (mean/wiggle/illusion) | Global (mean/wiggle/illusion) | Reason |
|---:|---|---|---|---|---|
| 1 | PASS | center=mean, weight=0.150, threshold=0.040 | +29.92% / +42.36% / +29.85% | +27.33% / +43.70% / +28.62% | ROI max improvement 42.36% | ROI avg improvement 34.04% | Global avg improvement 33.22% |
| 2 | PASS | center=mean, weight=0.150, threshold=0.060 | +29.92% / +42.36% / +29.85% | +27.33% / +43.70% / +28.62% | ROI max improvement 42.36% | ROI avg improvement 34.04% | Global avg improvement 33.22% |
| 3 | PASS | center=mean, weight=0.150, threshold=0.080 | +29.92% / +42.36% / +29.85% | +27.33% / +43.70% / +28.62% | ROI max improvement 42.36% | ROI avg improvement 34.04% | Global avg improvement 33.22% |
| 4 | PASS | center=mean, weight=0.150, threshold=0.100 | +29.92% / +42.36% / +29.85% | +27.33% / +43.70% / +28.62% | ROI max improvement 42.36% | ROI avg improvement 34.04% | Global avg improvement 33.22% |
| 5 | PASS | center=mean, weight=0.150, threshold=0.120 | +29.92% / +42.36% / +29.85% | +27.33% / +43.70% / +28.62% | ROI max improvement 42.36% | ROI avg improvement 34.04% | Global avg improvement 33.22% |
