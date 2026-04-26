---
name: ieee-vis-reviewer
description: 'Critical review for IEEE VIS/TVCG publication quality. Expert in math, computer vision, data visualization, and physics. Use for: validating mathematical rigor, ensuring visualization best practices, verifying computational correctness, assessing experimental design, identifying publication gaps, and improving submission-readiness.'
argument-hint: 'Describe the component, method, or claim to review (e.g., "sceneBuilder rendering pipeline" or "the PID ordering algorithm")'
user-invocable: true
---

# IEEE VIS/TVCG Critical Reviewer

Expert-level review targeting publication standards for IEEE Visualization or IEEE Transactions on Visualization and Computer Graphics. This skill systematically validates technical rigor across mathematics, computer vision, data visualization, and domain physics.

## When to Use

- **Pre-submission validation** – Before finalizing any conference/journal submission
- **Algorithm review** – Verify mathematical correctness and computational complexity
- **Visualization design** – Assess perceptual effectiveness and best practices
- **Experimental validation** – Check study design, baselines, and statistical rigor
- **Physics/domain accuracy** – Validate real-world correctness of models or datasets
- **Code reproducibility** – Ensure implementation matches claims and papers are reproducible
- **Publication gaps** – Identify missing ablations, comparisons, or analysis

## Core Review Dimensions

### 1. Mathematical Rigor

**Checklist:**
- [ ] All equations are formally defined (notation, domain, range, edge cases)
- [ ] Derivations are shown or cited; no mathematical jumps
- [ ] Algorithm complexity is stated (time, space)
- [ ] Numerical stability analyzed (especially for iterative methods)
- [ ] Bounds, convergence criteria, or termination conditions are explicit
- [ ] Assumptions (e.g., convexity, linearity) are stated clearly
- [ ] Special cases or degenerate inputs are handled

**Questions to ask:**
- Are there potential division-by-zero, overflow, or underflow risks?
- Is the algorithm guaranteed to converge? If so, what is the convergence rate?
- How does the method behave at boundary conditions?

---

### 2. Visualization & Computer Vision

**Checklist:**
- [ ] Visual encoding is perceptually effective (color, size, position, texture align with data magnitude)
- [ ] Color palette passes accessibility standards (colorblind-friendly, sufficient contrast)
- [ ] Interaction paradigms are intuitive and reduce cognitive load
- [ ] Occlusion and overplotting are addressed (e.g., transparency, brushing, aggregation)
- [ ] Perceptual channels are not overloaded (e.g., not using color + size + opacity for same dimension)
- [ ] Visual hierarchy guides attention to key findings
- [ ] Temporal or animated transitions are smooth and meaningful
- [ ] Legends, axes, labels are clear and complete

**Questions to ask:**
- Would a simpler visual encoding better communicate the data?
- Does the visualization reveal or hide important patterns compared to alternatives?
- Are users able to extract quantitative readings accurately (e.g., compare bar heights)?

---

### 3. Data & Experimental Rigor

**Checklist:**
- [ ] Datasets are clearly described (source, size, preprocessing steps, availability)
- [ ] Data provenance and potential biases are acknowledged
- [ ] Baselines are state-of-the-art and fairly compared (same implementation language/platform)
- [ ] Metrics are appropriate for the task (e.g., RMSE for regression; precision/recall for classification)
- [ ] Experimental design is sound (controls, independent variables, statistical power)
- [ ] Results include error bars, confidence intervals, or significance tests
- [ ] Ablation studies isolate contributions of each component
- [ ] Reproducibility: code, data, and hyperparameters are public or available upon request

**Questions to ask:**
- Are comparisons apples-to-apples (same data, same setup)?
- What is the sample size? Is it sufficient for statistical claims?
- Could the results be due to chance? (p-value, effect size)

---

### 4. Physics & Domain Accuracy

**Checklist:**
- [ ] Domain concepts are correctly applied (terminology, units, physical laws)
- [ ] Synthetic or theoretical data generation is physically plausible
- [ ] Assumptions about the domain are valid and stated
- [ ] Real-world constraints are respected (e.g., energy conservation, causality)
- [ ] Simplifications are justified and their impact is discussed
- [ ] Comparisons with real data or expert judgment validate correctness

**Questions to ask:**
- Does the simulation or model violate any physical principles?
- Are parameters realistic? (Can you cite real measurements?)
- How do results compare to established domain knowledge?

---

### 5. Code Quality & Reproducibility

**Checklist:**
- [ ] Code is well-commented and organized; functions are single-responsibility
- [ ] All hyperparameters and magic numbers are documented
- [ ] Random seeds are set; results are deterministic or variance is quantified
- [ ] Dependencies are pinned to specific versions
- [ ] Build/run instructions are clear (README, Makefile, Docker)
- [ ] Tests (unit, integration) verify critical functions
- [ ] Performance benchmarks are included (runtime, memory)
- [ ] Edge cases and error handling are implemented

**Questions to ask:**
- Can a colleague reproduce results in 30 minutes with the provided instructions?
- Are there undocumented assumptions in the code?
- Would a different random seed significantly change conclusions?

---

### 6. Publication Standards (IEEE VIS/TVCG)

**Checklist:**
- [ ] Paper scope is within conference/journal boundaries (visualization-focused)
- [ ] Figures are high-quality (vector graphics preferred; raster ≥300 DPI)
- [ ] Captions are self-contained and descriptive
- [ ] Claims are evidence-backed; speculative statements are labeled as such
- [ ] Related work properly positions contribution (not overstated)
- [ ] Limitations and future work are honestly discussed
- [ ] Writing is clear, concise, and uses appropriate technical vocabulary
- [ ] References are complete and properly formatted
- [ ] Supplementary materials (videos, code, data) follow conference guidelines

**Questions to ask:**
- Is the main contribution novel or incremental?
- Are prior works fairly cited and distinguished?
- Could a reader implement the method from the paper alone?

---

## Review Procedure

### Step 1: Prepare Context
Provide the skill with a specific component, algorithm, or visualization to review. Examples:
- "Review the `pidOrdering.ts` algorithm for mathematical correctness"
- "Evaluate the scatter plot encoding in GlobalStreamView.vue against viz best practices"
- "Validate the ensemble COVID dataset preprocessing in transforms.ts"

### Step 2: Run the Review
The reviewer will systematically assess against the six dimensions above, using targeted questions and a critical eye toward publication standards.

### Step 3: Collect Findings
Expect:
- ✅ Strengths and well-executed aspects
- ⚠️ Warnings about ambiguities or potential issues
- ❌ Critical blockers that must be fixed before publication
- 🔧 Suggestions for improvement

### Step 4: Iterate
Address critical issues first. Re-request reviews of revised sections to verify fixes.

---

## Example Prompts

- "Review the `braid.ts` core algorithm. Is the mathematical approach sound? Are there edge cases not handled?"
- "Audit the color palette in `palette.ts`. Is it colorblind-accessible and perceptually effective for our data ranges?"
- "Evaluate the experimental design: do we compare against sufficient baselines? Are metrics appropriate?"
- "Validate the physics model in synthetic data generation. Are real-world parameters realistic?"
- "Check if our code satisfies IEEE VIS reproducibility standards. What's missing?"

---

## References

- [IEEE VIS Reviewer Guidelines](https://ieeevis.org/)
- [TVCG Submission Standards](https://www.computer.org/csdl/journal/tg)
- [Visualization Best Practices](./references/viz-best-practices.md)
- [Perceptual Theory for Color and Encoding](./references/perceptual-theory.md)
- [Publication Checklist](./references/publication-checklist.md)
