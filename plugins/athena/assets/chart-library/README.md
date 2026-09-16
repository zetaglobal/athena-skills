# Athena chart library

The canonical, dependency-free chart builders used across the Athena executive
briefing skills. This is a **reference snippet library**: the briefing templates
are single self-contained HTML files (fonts inlined, no external requests, must
print and render offline), so there is no shared runtime bundle. Instead, each
template copies the helper preamble and the builder it needs from here, and we
keep this the source of truth. Update a builder here, then sync the copies in the
templates that use it.

## What's in scope

Three chart forms cover the briefings. Pick by the shape of the data, not by
taste:

| File | Form | Use when | Reference impl in |
| --- | --- | --- | --- |
| `donut.js` | Donut (part-to-whole) | categories are **shares of one whole** and sum to ~100% (channel mix, share of reach) | Customer Pulse `shareDonuts` |
| `bar.js` | Horizontal bar (ranked magnitudes) | many labels **compared against each other** by size (reach by channel, over-index) | Customer Pulse activity and characteristics |
| `line.js` | Area / line (time series) | one measure **moves over time**, axis scaled to the observed range | Insights Studio `drawTrend` |

Everything else (radar, sankey, bubble, gauge, radial, funnel, stacked) is
deliberately **out of scope** until a briefing actually needs it. Add a builder
only when a real skill calls for it, and only in this dependency-free house
style — not by importing a charting framework. The verbose Recharts/D3 dumps and
placeholder imagery from external design kits are intentionally not carried in.

## The rules the builders encode

- **Donut guards its own fit.** If values don't sum to 90–110 it returns `false`
  so the caller falls back to bars. No in-slice numbers — the centre reports the
  leading share, the legend carries the rest.
- **Bars are pre-sorted by the caller** and drawn top-to-bottom as given.
- **Line axes are scaled to the observed range, never anchored at zero**, and
  missing points are left as **gaps, not plotted as zero**.

## Token contract

The host page must define these CSS custom properties (the templates already do,
in light and dark forms):

```
--foreground  --muted-foreground  --border  --primary
--ramp-1  --ramp-2  --ramp-3      /* sequential; lightness falls across it */
```

Categorical series use `chartHelpers().SHARE_HSL` (shares of a whole) or
`SEG_HSL` (one audience vs another). Both are HSL triplets used as
`hsl(<triplet>)`, chosen to stay distinct in greyscale and for colour-blind
viewers.

## Using a builder in a template

1. Copy `chartHelpers()` from `helpers.js` into the template's inline `<script>`
   (or reuse the `el` / `hsl` / `fmt` helpers it already has).
2. Copy the builder function you need.
3. Call it with an empty `<svg>` (bar/line) or a block element (donut) that
   already exists in the page, plus `{ helpers: chartHelpers() }`.

`preview.html` is a self-contained page that renders all three from sample data
in light and dark. Open it after any change to eyeball the result — it is the
library's visual regression check.

## Changelog

- Seeded from the production builders `shareDonuts`, `rankedBars`, and
  `drawTrend` — the existing Athena house style, generalized and parameterized.
