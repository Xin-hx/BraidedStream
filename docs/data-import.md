# Custom data import

The app's **Import your data** button opens a three-step, browser-only workflow. No backend, upload endpoint or external parsing service is used. File data is not written to localStorage or IndexedDB.

1. **Choose file:** browse or drop a CSV, XLSX or JSON file. CSV supports automatic/comma/semicolon/tab separators and UTF-8, UTF-16 LE or GB18030 encoding. Starting templates are available in the dialog; CSV templates can be opened in Excel and saved as XLSX.
2. **Map columns:** preview the first eight rows, choose a sheet/header and data type, then define distribution groups, member identities and support values. Choose time ordering and how to handle blanks.
3. **Review & import:** verify the grouping rule, distribution count and members per distribution. Only data warnings are shown. Optionally export normalized JSON, then calculate the layout and switch to the new chart after success.

## Define an ensemble or distribution

**Time + distribution group fields** identify one distribution. Multiple group fields form a composite layer identity, for example `region + scenario`; select none to pool observations into one layer. The column layout adds the selected value column to the layer identity. Composite identities are encoded without delimiter collisions.

For **Ensemble samples**, optionally select one or more **Member ID fields**, such as `model + run` or `patient + sample`. Within one distribution, each selected identity can contribute once. A repeated identity is an error; refine grouping/member fields, or leave member IDs empty to count independent observations. In the member-column layout, column identity also distinguishes members. Values and optional weights determine the empirical measure.

For a **Weighted distribution**, choose support points or intervals, then map a probability-mass/frequency column. Points become weighted atoms; intervals become weighted uniform components. Masses are normalized separately within each distribution. They are masses/counts, not cumulative probabilities or density heights. Pre-aggregated distributions do not invent ensemble sample counts.

## Table layouts

| Layout | Example columns | Interpretation |
| --- | --- | --- |
| One sample per row | `time, category, value, weight` | Each row is one observation. Weight is optional. Repeated layer/time rows form a distribution. |
| One layer per column | `time, A, B, C` | Selected column names become layer IDs. Each row supplies observations for its time. Repeated times add samples. |
| Samples across columns | `time, category, member_1, member_2` | Selected value columns are equally weighted observations of the same layer/time. |

Values must be finite, non-negative numbers. Zero remains an observation. Blank values either become missing observations or stop validation. Blank time, selected group or selected member fields are errors. Empty layer/time cells are `null`, never zeros.

For weighted rows, all supplied weights must be finite and non-negative. Weights are normalized within each layer/time cell; zero-weight observations are excluded and reported in the review notes. Sample counts describe contributing observations before identical atom values merge.

Automatic time ordering sorts numeric labels, `day N` labels and ISO dates. Other text labels retain file order. Calendar/day labels must have increasing, distinct coordinates. Ambiguous date strings are not guessed; use `YYYY-MM-DD`, or native Excel date cells.

The XLSX reader reads stored cell values and dates; it does not execute formulas or macros. Save formula results in Excel before importing. Legacy `.xls` and `.xlsm` files must be saved/exported as `.xlsx` or CSV.

## JSON

JSON can contain an array of flat records, `{ "rows": [...] }`, or the package's standard `InputDataset`:

```json
{
  "times": ["2024-01-01", "2024-01-02"],
  "layers": [{
    "id": "A",
    "measures": [
      {"components": [{"kind": "atom", "value": 10, "mass": 0.5}, {"kind": "atom", "value": 14, "mass": 0.5}]},
      {"components": [{"kind": "uniform", "low": 8, "high": 12, "mass": 1}]}
    ]
  }]
}
```

Unified JSON bypasses column mapping and is checked by the package's `validateInput`. Component masses must sum to one. Such measures do not carry sample counts, so the UI does not invent an observation count. Arbitrary nested JSON needs to be flattened or converted to this schema first.

## Progress, cancellation and session lifetime

- File reads and CSV parsing report measured progress. Workbook parsing and layout analysis use an indeterminate spinner because their underlying operations do not expose a reliable completion percentage.
- Parsing, conversion and imported-data analysis run in cancellable Web Workers. Closing or cancelling the dialog terminates its workers and preserves the current chart. Invalid input never replaces a valid chart.
- After import, algorithm parameter changes for custom data also use a worker; display-only changes reuse the current result.
- One custom dataset can be retained in the current tab and selected alongside the examples. **Remove data** forgets it; refreshing the page also clears it. File names, imported labels, observations and custom layer color keys are not persisted by the app.
- Browser imports are limited to 25 MB, 100,000 data rows, 512 columns, 500,000 table cells and 50,000 layer × time cells. Import a smaller range if a limit is reached. The preview and review contain only a subset; the downloaded unified JSON contains the full converted input.

The importer lives under `app/`. It adapts user files into the existing library contract without adding a backend or modifying the visualization package.
