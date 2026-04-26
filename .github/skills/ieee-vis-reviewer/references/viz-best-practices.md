# Visualization Best Practices Reference

## Perceptual Effectiveness Hierarchy

Data-to-visual mapping effectiveness (Cleveland & McGill, 1984):
1. **Position** (most effective)
2. **Length**
3. **Direction**
4. **Angle**
5. **Area**
6. **Volume**
7. **Color saturation**
8. **Color hue** (least effective)

### Application
- Use position/length for quantitative comparisons
- Use hue/saturation for categorical distinction
- Avoid encoding quantitative data with angles or volumes

## Color Considerations

### Accessibility
- **Colorblind simulation**: Check designs with Deuteranopia, Protanopia, Tritanopia filters
- **Contrast**: Ensure ≥4.5:1 luminance ratio for text; ≥3:1 for graphical elements
- **Tools**: Use ColorOracle, Coblis, or WebAIM Contrast Checker

### Sequential vs. Categorical
- **Sequential scales**: For ordered data (e.g., density, magnitude) — use single-hue or multi-hue ramps
- **Diverging scales**: For data with meaningful center point (e.g., anomalies, ±differences)
- **Categorical scales**: Distinguish unordered groups — use maximally distinct hues

### Recommended Palettes
- **Viridis family**: Perceptually uniform, colorblind-friendly
- **Colorbrewer2**: Domain-specific schemes; well-tested
- **Oklab**: Newer, perceptually uniform in lightness-chroma-hue

## Interaction Design

### Brushing & Linking
- Highlight selected items across multiple coordinated views
- Use consistent color/opacity for linked selections
- Provide clear feedback on what is selected

### Hover & Tooltips
- Show detail on demand without clutter
- Avoid flickering (debounce hover events)
- Include units, precision appropriate to data

### Filtering & Aggregation
- Allow users to focus on subsets without deletion
- Provide undo/reset mechanisms
- Show current filter state clearly

## Animation & Temporal Encoding

### Effective Use
- **Transitions**: 200-500ms for object movements; slower for complex changes
- **Reveal patterns**: Gradually animate changes to show cause-effect
- **Avoid gratuitous animation**: Only use when communicating information

### Anti-patterns
- Rapid blinking or strobing
- Animations that distract from static content
- Transitions lasting >2 seconds without narrative explanation

## Occlusion & Overplotting Solutions

1. **Transparency/Alpha**: Stack overlapping items; adjust opacity based on density
2. **Jitter**: Slightly offset duplicate or near-duplicate points
3. **Aggregation**: Bin or cluster dense regions; show count or average
4. **Nested views**: Use small multiples or detail-on-demand insets
5. **3D techniques**: Careful use of depth (often increases cognitive load)

## Typography & Labeling

- **Font size**: ≥10pt for printed material; scale for screen based on viewing distance
- **Contrast**: Labels must have sufficient contrast against background
- **Orientation**: Horizontal text is most readable; avoid rotation >45°
- **Density**: Avoid label clutter; use strategically placed annotations
- **Units**: Always include units; use standard notation

## Legends & Axes

- **Self-contained**: Legends should function without external reference
- **Proximity**: Place legends near relevant visual elements
- **Axis labels**: Include unit, scale type (linear/log), and tick interval
- **Data range**: Show min/max clearly; indicate if data is truncated
