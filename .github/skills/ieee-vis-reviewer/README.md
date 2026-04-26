# IEEE VIS/TVCG Reviewer Skill Resources

This skill provides expert-level review for publications targeting IEEE Visualization (VIS) or IEEE Transactions on Visualization and Computer Graphics (TVCG), emphasizing mathematical rigor, visualization design, data analysis, and physics accuracy.

## Quick Start

1. **Identify a specific component or claim** you want reviewed (e.g., an algorithm, visualization design, or experimental setup)
2. **Invoke the skill** with a clear description:
   ```
   /ieee-vis-reviewer Review the color palette in palette.ts for perceptual effectiveness and colorblind accessibility
   ```
3. **Review the feedback** across six dimensions:
   - Mathematical rigor
   - Visualization & computer vision principles
   - Data & experimental design
   - Physics/domain accuracy
   - Code quality & reproducibility
   - Publication standards

## What's Included

### Main Skill File
- **SKILL.md**: Step-by-step review procedure, checklists across six dimensions, example prompts

### Reference Documents
1. **viz-best-practices.md**: Perceptual hierarchy, color accessibility, interaction design, animation, occlusion strategies
2. **perceptual-theory.md**: Color perception, JND, Gestalt principles, visual channels, colorblindness guidelines, temporal perception
3. **publication-checklist.md**: Comprehensive pre-submission checklist (manuscript, figures, experiments, code, metadata)

## Example Use Cases

### Algorithm Validation
```
Review the pidOrdering.ts sorting algorithm. Is the time complexity acceptable for interactive use? 
Are there numerical stability concerns?
```

### Visualization Design
```
Evaluate the scatter plot design in GlobalStreamView.vue against perceptual effectiveness principles. 
Does it use the strongest visual channels for the most important comparisons?
```

### Data & Experimental Rigor
```
Assess the COVID ensemble dataset preprocessing in transforms.ts. Are potential biases acknowledged? 
Do we validate against established epidemiological models?
```

### Publication Readiness
```
Use the publication checklist to audit this paper draft. What publication-critical items are missing 
before we submit to TVCG?
```

## Notes on Custom Review

The skill is designed to be invoked **selectively** for specific components or claims, not as a blanket review of all code. This allows focused, depth-first analysis.

For example:
- ❌ "Review my entire project" (too broad; hard to provide actionable feedback)
- ✅ "Review the ensemble rendering pipeline for correctness and efficiency" (specific; actionable)

---

## References & Further Reading

### IEEE VIS
- Official website: https://ieeevis.org/
- Paper review guidelines: https://ieeevis.org/yearly/
- Author resources: Templates, formatting guides, FAQs

### TVCG Journal
- Official website: https://www.computer.org/csdl/journal/tg
- Submission portal and author guidelines
- Recent accepted papers for style reference

### Visualization & Perception
- **Ware, C.** (2012). *Information Visualization: Perception for Design* (3rd ed.)
- **Cleveland, W. S., & McGill, R.** (1984). Graphical perception and graphical methods for analyzing scientific data.
- **Healey, C. G., et al.** (1996). Perceptually effective visual communication for scientific visualization.

### Reproducibility & Statistics
- **Tukey, J. W.** (1977). *Exploratory Data Analysis*
- **Goodman, S. N.** (2008). A dirty dozen: Twelve p-value misconceptions.
- **Kirstin Kohler et al.** (2019). Towards Visualization Literacy for Digital Humanists.

---

## Contributing Improvements

Found a gap or improvement for this skill? Consider:
- Adding domain-specific checklists (e.g., for flow visualization, scatterplot matrices)
- Expanding the math section with common fallacies in visualization research
- Including examples of excellent/poor submissions for reference
- Adding a section on specific IEEE VIS challenges (InfoVis, Visual Analytics, SciVis)
