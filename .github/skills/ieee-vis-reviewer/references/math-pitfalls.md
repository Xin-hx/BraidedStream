# Mathematical Pitfalls in Visualization Papers

Common errors and misconceptions in publications targeting IEEE VIS/TVCG, organized by category.

## Algebra & Derivations

### Pitfall 1: Unmerged Terms
**Problem**: Leaving equations in non-canonical form makes it hard to verify correctness.
```
❌ y = 2x + 3x - 5 + 2     (leaves reader to simplify)
✅ y = 5x - 3               (canonical form; easy to verify)
```

**Check**: Can a peer quickly verify the algebra without paper and pencil?

### Pitfall 2: Hidden Assumptions
**Problem**: Dividing by a variable without ensuring it's non-zero.
```
❌ z = (a + b) / (a - b)                  (what if a == b?)
✅ z = (a + b) / (a - b),  where a ≠ b   (assumption explicit)
```

**Check**: Look for division, square roots, logarithms — add constraints.

### Pitfall 3: Index Confusion
**Problem**: Mixing 0-based and 1-based indexing; unclear notation.
```
❌ for i = 0 to n: x[i] = data[i]        (reader unsure: is n inclusive?)
✅ for i ∈ {0, 1, ..., n-1}: x[i] = data[i]  (explicit set notation)
```

**Check**: Verify loop bounds match array dimensions; use set notation for clarity.

---

## Complexity Analysis

### Pitfall 4: Misleading Complexity Claims
**Problem**: Reporting best-case or average-case as if it's worst-case; ignoring constants.
```
❌ "Our method is O(n log n)"  (without specifying hidden constants)
✅ "Our method is O(n log n) with a constant factor of ~5.2, verified on datasets up to 1M points"
```

**Check**: Include constants in big-O; validate empirically on realistic data sizes.

### Pitfall 5: Ignoring Space Complexity
**Problem**: Claiming an efficient algorithm but hiding large intermediate memory requirements.
```
❌ "Time: O(n), Space: not analyzed"
✅ "Time: O(n), Space: O(n) for distance matrix + O(log n) stack"
```

**Check**: Report both time and space; clarify if space is for algorithm or intermediate data.

---

## Statistics & Metrics

### Pitfall 6: P-value Misuse
**Problem**: Reporting p-values without effect sizes; too many comparisons without correction.
```
❌ "Results were significant (p < 0.05)" [no effect size; multiple comparisons uncorrected]
✅ "Results were significant (p = 0.02, d = 0.85) after Bonferroni correction (α = 0.05 / 12 ≈ 0.004)"
```

**Check**: Always report p-value + effect size + sample size + correction method.

### Pitfall 7: Metric Mismatch
**Problem**: Using a metric that doesn't match the task.
```
❌ Task: Classify abnormal cases | Metric: Accuracy    (fails on imbalanced data)
✅ Task: Classify abnormal cases | Metric: F1 score    (balances precision & recall)
```

**Check**: Justify metric choice relative to task goals (detection, ranking, classification).

### Pitfall 8: Cherry-picked Results
**Problem**: Reporting only the "good" run; hiding variance or negative results.
```
❌ "Best result: RMSE = 0.03 (single run, no error bars)"
✅ "Mean RMSE = 0.15 ± 0.06 across 10 runs; outlier RMSE = 0.03 excluded due to hyperparameter mismatch"
```

**Check**: Report mean ± std; explain outliers or dropped runs transparently.

---

## Experimental Design

### Pitfall 9: Confounded Variables
**Problem**: Changing multiple variables simultaneously; impossible to isolate effects.
```
❌ Test A (dataset X, method M1) vs. Test B (dataset Y, method M2)  [dataset and method both differ]
✅ Test A (dataset X, method M1) vs. Test B (dataset X, method M2)  [only method differs]
```

**Check**: Use ablation studies; vary one independent variable per comparison.

### Pitfall 10: Insufficient Baselines
**Problem**: Comparing only against weak or outdated baselines; no state-of-the-art comparison.
```
❌ "Our method outperforms naive baseline and method from 2010"
✅ "Our method vs. SOTA (2023) [cite 3 recent works], plus naive baseline for sanity check"
```

**Check**: Include 2–3 recent, well-established baselines; explain why included.

### Pitfall 11: Lack of Ablation
**Problem**: Claiming each component contributes without evidence.
```
❌ "Features A + B + C were used. They improve results."
✅ "Ablation: A alone = 0.70, B alone = 0.65, C alone = 0.72, A+B = 0.78, A+C = 0.79, A+B+C = 0.81"
```

**Check**: Show performance for each subset; justify feature combinations.

---

## Visualization-Specific

### Pitfall 12: Lie Factor Violations
**Problem**: Visual encoding doesn't match data; misleading scaling.
```
❌ Data increases 20%, but bar height increases 100% [Lie Factor = 5]
✅ Data increases 20%, bar height increases 20% [Lie Factor = 1]
```

**Check**: Measure graphic size vs. data magnitude; report lie factor if >1.05.

### Pitfall 13: Perceptual Overload
**Problem**: Using too many visual channels for one variable (color + size + opacity = data value).
```
❌ Encoding same quantity in color, size, AND transparency [redundant, confusing]
✅ Position + size for main comparison; color for categorical grouping; opacity for confidence
```

**Check**: Assign one pre-attentive channel per important dimension.

### Pitfall 14: Non-colorblind-Friendly Palette
**Problem**: Red-green distinction primary; fails for 8% of male population.
```
❌ Color palette: red vs. green only
✅ Color palette: blue vs. orange + luminance difference
```

**Check**: Test with ColorOracle or Coblis for all three types of colorblindness.

---

## Boundary Conditions & Edge Cases

### Pitfall 15: Empty Handling
**Problem**: Algorithm behavior on edge cases not specified; crashes possible.
```
❌ Algorithm assumes n ≥ 2; no handling for n ∈ {0, 1}
✅ Algorithm handles n ≥ 0; returns [x] for n=1, [] for n=0
```

**Check**: Explicitly test and document behavior for edge cases (empty input, single element, duplicates).

### Pitfall 16: Numerical Stability
**Problem**: Algorithm fails or produces NaN for specific input ranges.
```
❌ z = (a - b) / (a - b + ε)   [when |a - b| << ε, denominator ≈ ε, dividing very large by very small]
✅ z = 1 - (a - b) / (a - b + ε)  [reformulated to avoid cancellation]
```

**Check**: Test with extreme values; use stable algorithms for sensitive operations (SVD, inversion).

---

## Best Practices for Rigorous Papers

1. **Define before use**: Every symbol, function, and operator must be introduced before first use.
2. **Cite or derive**: If a formula appears, cite its source or show the derivation.
3. **Explain intuition**: After formal definition, explain in plain language what the math achieves.
4. **Empirical validation**: Verify theoretical claims (complexity, correctness) on real data.
5. **Reproducibility**: Provide pseudocode and hyperparameters; reference published implementations where possible.

---

## Quick Audit Checklist

- [ ] All equations are numbered and referenced
- [ ] Variables are defined before first use; notation is consistent
- [ ] Boundary conditions and edge cases are handled
- [ ] Complexity is stated with justification (worst-case, average, or amortized?)
- [ ] Comparisons include baselines + ablations
- [ ] Results report mean, variance, and statistical significance
- [ ] Metrics match the task and are explained
- [ ] Visualizations have lie factor ≈ 1 and use colorblind-friendly palettes
- [ ] Implementation details (pseudocode, hyperparameters) enable reproduction

