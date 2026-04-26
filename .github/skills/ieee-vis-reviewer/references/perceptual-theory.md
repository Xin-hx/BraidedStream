# Perceptual Theory for Visualization

## Color Perception Fundamentals

### Color Opponent Channels (HCL/Lab Color Space)
- **H (Hue)**: Perceived color (0–360°)
- **C (Chroma)**: Saturation or colorfulness
- **L (Lightness)**: Perceived brightness

**Why it matters**: Linear steps in HCL correspond to perceived color differences better than RGB.

### Just Noticeable Difference (JND)
- Threshold: ΔE ≈ 2–3 in perceptually uniform spaces (CIELAB, Oklab)
- Implication: Ensure color differences are >5 JND for reliable distinction

## Gestalt Principles in Visualization

### Proximity
- Items close together are perceived as related
- Use spacing to distinguish groups

### Similarity
- Similar visual properties (color, shape) are grouped
- Ensure visual consistency within categories

### Continuity
- Eyes follow smooth curves; align elements along lines
- Avoid erratic or jagged patterns that break continuity

### Closure
- Humans complete incomplete shapes mentally
- Useful for sparse glyphs or partial visual encoding

### Figure-Ground Separation
- Distinguish foreground data from background context
- Use contrast, saturation, or layering

## Visual Channels and Data Types

| Channel | Data Type | Effectiveness | Notes |
|---------|-----------|---|---|
| Position (x, y) | Quantitative | Highest | Use for main comparison |
| Length | Quantitative | High | Bars, line lengths |
| Direction | Directional | Medium | Arrows, angles |
| Angle | Quantitative | Medium | Pie slices (avoid) |
| Area | Quantitative | Low | Bubble size (use radius, not area) |
| Hue | Categorical | Medium | ≤7–10 distinct colors |
| Saturation | Ordered categorical | Medium | Sequential data |
| Lightness | Ordered categorical | High | Sequential data; most accessible |
| Texture | Categorical | Low | Supplementary encoding |

## Pre-attentive Processing

Tasks completed in <500ms without conscious effort:
- Detecting a single dissimilar color in a field
- Detecting a single high-contrast line
- Detecting movement

**Implication**: Use one salient pre-attentive channel for the main data dimension; reserve other channels for supporting information.

## Color Blindness (Color Vision Deficiency)

### Types and Prevalence
- **Deuteranopia** (8% of males): Green-blind; confuses green/red
- **Protanopia** (1% of males): Red-blind; confuses red/green  
- **Tritanopia** (0.001%): Blue-yellow confusion (rare)
- **Monochromacy** (0.001%): Complete color blindness (very rare)

### Design Guidelines
- Never rely on red-green distinction alone
- Test with simulation tools (ColorOracle, Coblis)
- Use luminance contrast as primary; color as secondary encoding
- Use blue-yellow, light-dark, or texture as main differentiators

## Quantitative Accuracy vs. Aesthetics

### Lie Factor
**Lie Factor = (Size of effect in graphic) / (Size of effect in data)**

Target: 0.95–1.05 (data-faithful). Values >1 exaggerate; <1 understate.

Example: If data increases 10% but bar height increases 20%, lie factor = 2.0 (misleading).

## Temporal Perception

- **Below 200ms**: Fused as single stimulus
- **200–500ms**: Optimal for perceiving smooth motion
- **0.5–2s**: Narration-synchronized animation
- **>2s**: Risk of losing attention; may require caption

---

## Key References

1. Cleveland, W. S., & McGill, R. (1984). Graphical perception.
2. Ware, C. (2012). Information Visualization (3rd ed.).
3. Healey, C. G., et al. (1996). Perceptually effective visual communication for scientific visualization.
4. Okabe, M., & Ito, K. (2008). Color universal design.
