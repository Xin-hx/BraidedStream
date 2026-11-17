# Example data

Public examples are stored directly in this directory. Case-specific adapters live in `../converters/`.

TCM clinical records are **local only**. To use them, place your authorized local copy at:

```text
examples/data/private/TCMRecord.csv
```

The entire `private/` directory and every `TCMRecord.csv` filename are ignored by Git. Do not put clinical records in `app/public/`, documentation, fixtures, or package sources. Do not force-add ignored data.

`npm run dev` makes the TCM option available when the file exists and serves it only to loopback clients with caching disabled. Direct Vite filesystem URLs are blocked. Production builds exclude private records and the TCM selector, even when the local file exists.

Without the file, the public application and public tests still work. The two real TCM data checks are skipped; synthetic TCM converter tests continue to run. `npm run figures:tcm` requires the local file and writes derived output only under ignored `artifacts/figures/`.
