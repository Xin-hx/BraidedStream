# IEEE VIS/TVCG Publication Readiness Checklist

Use this checklist 2–3 weeks before submission to identify gaps.

## Paper & Manuscript

### Structure
- [ ] Title is concise, descriptive, and includes key innovation
- [ ] Abstract (max 150 words) summarizes problem, contribution, and results
- [ ] Introduction clearly states motivation and research question
- [ ] Related work positions contribution relative to prior art
- [ ] Methods section includes sufficient detail for reproduction
- [ ] Results include both qualitative and quantitative validation
- [ ] Discussion interprets findings, acknowledges limitations, suggests future work
- [ ] Conclusion summarizes contributions and impact
- [ ] All figures/tables referenced in text and have captions

### Writing Quality
- [ ] No orphaned sections; smooth transitions between ideas
- [ ] Technical terminology is consistent (e.g., "optimization" not "optimizer")
- [ ] Acronyms defined on first use
- [ ] Grammar and spelling checked (Grammarly, copyeditor)
- [ ] Passive voice minimized; active voice preferred
- [ ] Hedging language appropriate (avoid absolute claims without evidence)

### Claims & Evidence
- [ ] Every claim is evidence-backed (citation, experiment, or proof)
- [ ] Speculative statements labeled ("We hypothesize...", "Future work may...")
- [ ] No overclaiming (e.g., "best" is only claimed with rigorous comparison)
- [ ] Limitations of approach and datasets are discussed
- [ ] Generalizability of findings is clarified

---

## Figures & Visualization

### Quality
- [ ] All figures are vector graphics (PDF, SVG, or >300 DPI raster)
- [ ] Text in figures is legible; font size ≥8pt in final layout
- [ ] Color palette is colorblind-friendly (tested with simulator)
- [ ] Contrast ratio ≥4.5:1 for text; ≥3:1 for graphical elements
- [ ] No blurry, pixelated, or low-quality images

### Captions & Labels
- [ ] Each caption is self-contained (readers don't need to re-read text)
- [ ] Captions include what, why, and key finding
- [ ] Legends are proximate and well-labeled
- [ ] Axes have labels and units
- [ ] Data ranges and aggregation methods are clear

### Design
- [ ] Visual encoding is effective (position > length > color hue)
- [ ] Figure supports or illustrates main claims (no superfluous details)
- [ ] Subplots are aligned and consistent in scale/style
- [ ] Annotations highlight key findings
- [ ] If showing before/after or comparison, differences are salient

---

## Experimental Validation

### Data
- [ ] Data sources clearly cited with URLs or availability information
- [ ] Data preprocessing steps documented
- [ ] Dataset sizes, dimensionality, and characteristics described
- [ ] Known limitations or biases in data acknowledged
- [ ] Data will be made available (or justification for why not)

### Baselines & Comparisons
- [ ] State-of-the-art baselines included
- [ ] Baseline implementations are from same platform/framework (fair comparison)
- [ ] Parameter choices for baselines are justified or tuned
- [ ] Comparisons use same data and evaluation protocol

### Metrics
- [ ] Metrics are appropriate for the task (e.g., RMSE for regression; F1 for classification)
- [ ] Metrics are standard (enables comparison with other work)
- [ ] Metric definitions provided if non-standard
- [ ] Metric limitations discussed (e.g., RMSE sensitive to outliers)

### Statistical Rigor
- [ ] Error bars, confidence intervals, or significance tests included
- [ ] Sample sizes reported; power analysis discussed if relevant
- [ ] p-values reported (if applicable) with effect sizes
- [ ] Multiple comparisons correction applied (if testing many hypotheses)
- [ ] Reproducible random seeds and variance quantified

### Ablation Studies
- [ ] Each component contribution validated separately
- [ ] Ablations isolate one variable at a time
- [ ] Results show additive effect of components
- [ ] Justification provided for design choices

---

## Code & Reproducibility

### Availability & Documentation
- [ ] Code repository is public (GitHub, Zenodo, or institutional server)
- [ ] README includes installation, dependencies, and usage
- [ ] Build instructions are clear (Makefile, package.json, requirements.txt)
- [ ] All hyperparameters documented (config file, comments, or paper table)

### Environment
- [ ] Dependencies pinned to specific versions
- [ ] Python: requirements.txt, Conda environment.yml, or Poetry.lock
- [ ] Node/TypeScript: package-lock.json or Yarn.lock
- [ ] Container provided (Dockerfile) for complex setups

### Testing & Validation
- [ ] Unit tests for critical functions
- [ ] Test coverage ≥70% (check with coverage.py or similar)
- [ ] Integration tests verify end-to-end pipeline
- [ ] Example datasets provided for testing
- [ ] Instruction to reproduce main results (time estimate provided)

### Performance
- [ ] Runtime and memory usage reported for benchmarks
- [ ] Hardware used for benchmarks documented (CPU, GPU, RAM)
- [ ] Scalability discussed (how does method scale with data size?)
- [ ] Bottlenecks identified; optimization opportunities discussed

---

## Submission Metadata

### Author & Affiliation
- [ ] All authors listed in correct order
- [ ] Affiliations and email addresses complete
- [ ] Corresponding author designated
- [ ] Conflicts of interest disclosed

### Keywords
- [ ] 3–5 keywords that capture core contributions
- [ ] Keywords aligned with conference taxonomy

### Conference/Journal Specific
- [ ] Paper adheres to page limits (e.g., IEEE VIS: 11 pages)
- [ ] Formatting follows template (Overleaf, Word, LaTeX)
- [ ] References follow required style (IEEE, ACM, Chicago, etc.)
- [ ] Supplementary materials follow guidelines (file size, format)
- [ ] Video (.mp4, ≤100MB) demonstrates key features or results

---

## Final Pre-Submission Steps

### Review Checklist (1 week before)
- [ ] Self-review against all above items
- [ ] Ask 1–2 colleagues to review abstract and figures
- [ ] Proofread for typos and formatting inconsistencies
- [ ] Verify all references are complete and cited in text
- [ ] Test reproducibility: can a peer run your code?

### Review Checklist (3 days before)
- [ ] All figures legible in final PDF layout
- [ ] Abstract word count <150 words
- [ ] Author names and affiliations accurate
- [ ] Supplementary files prepared and tested
- [ ] Submission file is final version (no watermarks, draft markers)

### Backup
- [ ] Save all source materials (LaTeX, figures, data)
- [ ] Commit final version to version control with tag
- [ ] Archive submission materials with timestamp
