#!/usr/bin/env node
// Fail-closed validation of an assembled artifact data block, run at generation time —
// BEFORE the filled HTML is written. Every rule here corresponds to a defect that shipped
// silently: see commits 4b921fb (Customer Pulse) and bb9e0ad (Insights Studio).
//
// Strict by design: an unrecognized key is an error, not a silently dropped field. A chart
// fed a column the gateway does not return is an error. Errors block the write; warnings
// print and allow it.
//
// No external dependencies — Node built-ins only.
//
//   node scripts/validate-data-block.mjs <file.json|filled.html> --source <manifest.json>
//                                        [--skill <id>] [--json]
//
// --source is REQUIRED. Without it there is no way to check that a charted column exists in
// the gateway block that fed it, which is the rule that catches the 4b921fb headline bug.
//   node scripts/validate-data-block.mjs --selftest
//
// Importable:
//   import { validateDataBlock, extractDataBlock, assertDataBlock } from "./validate-data-block.mjs";

import { execFileSync } from "node:child_process";
import { closeSync, constants, existsSync, fstatSync, mkdtempSync, mkdirSync, openSync, readSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/* ==========================================================================
   Verified gateway columns, per block family.
   Sources: each skill's SKILL.md "Reading the response" / "Phase 2" tables, which were
   corrected against live responses in 4b921fb and bb9e0ad. Used to answer "does the field
   this chart is fed actually exist?" when no explicit column list is supplied.
   ========================================================================== */
const BLOCK_FAMILIES = [
  {
    match: /_interest(_customer_ratio)?(_[a-z_]+)?_\d+$/,
    label: "interest block",
    columns: ["Title", "ParentGroup", "SubGroup", "customer_count", "scaled_zscore",
              "network_baseline_difference", "_total"],
    chartField: "scaled_zscore",
    labelField: "Title",
    note: "interest blocks carry no index_value and no Label (4b921fb)",
  },
  {
    match: /_acquisition_(age|gender|income)_\d+$/,
    label: "acquisition demographic block",
    columns: ["Label", "customer_ratio_value", "customer_count", "network_baseline", "_total"],
    chartField: "customer_ratio_value",
    labelField: "Label",
    note: "network_baseline is not on the percentage scale (it was 5 while age bands ran 2-22%)",
  },
  {
    match: /_demographics_ethnicity_\d+$/,
    label: "ethnicity block",
    columns: ["race", "customer_ratio", "customer_count", "index", "_total"],
    chartField: "customer_ratio",
    labelField: "race",
  },
  {
    match: /_demographics_state_segment_\d+$/,
    label: "state block",
    columns: ["id", "index_value", "customer_count", "customer_ratio_value", "_total"],
    chartField: "customer_ratio_value",
    labelField: "id",
  },
  {
    match: /_demographics_zip_code_\d+$/,
    label: "zip block",
    columns: ["postal_code", "city", "state", "index", "lat", "lng", "index_flag_str", "_total"],
    chartField: "index",
    labelField: "postal_code",
  },
  {
    match: /_(coverage|reachability|preferred_channel)(_[a-z_]+)?_\d+$/,
    label: "coverage/reachability block",
    columns: ["field_metric", "count", "total", "percentage", "people_count", "coverage_people", "_total"],
    chartField: "percentage",
    labelField: "field_metric",
    note: "coverage_people is the literal string \"Missing Value\" — never chart it",
  },
  {
    match: /_social_media_platform_\d+$/,
    label: "social platform block",
    columns: ["Label", "index_value", "customer_count", "scaled_zscore", "_total"],
    chartField: "scaled_zscore",
    labelField: "Label",
  },
  {
    match: /^distance_to_store_\d+$/,
    label: "distance block",
    columns: ["zip", "city", "state", "dma", "lat", "lng", "closest_store",
              "competitors_1mi", "competitors_3mi", "competitors_5mi", "competitors_10mi",
              "people_1mi", "people_3mi", "people_5mi", "people_10mi",
              "segment", "site_id", "_total"],
    chartField: "people_5mi",
    labelField: "city",
    note: "closest_store of 0 is ambiguous — never present it as zero miles",
  },
  {
    match: /^competitive_proximity_index_\d+$/,
    label: "proximity block",
    columns: ["dma", "dma_code", "dma_zmp", "total_customers", "comp_intensity",
              "total_customers_ratio", "avg_comp_intensity", "difference_from",
              "lat", "lng", "state", "segment", "site_id", "_total"],
    chartField: "difference_from",
    labelField: "dma",
  },
];

function familyFor(block) {
  return BLOCK_FAMILIES.find((f) => f.match.test(String(block))) || null;
}

/* ==========================================================================
   Hints for the famous wrong keys. A named fix beats "invalid field".
   ========================================================================== */
const KEY_HINTS = {
  index_value:
    "the interest and rate blocks this chart is fed carry no `index_value`; the only magnitude is `scaled_zscore` (0-100). See SKILL.md 'Reading the response' and commit 4b921fb — the template used to centre bars on 1.0 against a 0-100 score.",
  baseline:
    "this chart has no baseline concept — `strengthBars` draws no centreline (4b921fb). Remove the key. The only baselines are top-level `ageBaseline`/`genderBaseline`, and only when the number is on the same scale as the bars.",
  Label:
    "interest blocks have no `Label` column; the label column is `Title` (SKILL.md 'Reading the response').",
  label_field: "use `label`.",
  dir:
    "arrow direction is derived from the sign of (current - prior) inside the template — remove it. Hardcoding it is how card 1 always pointed up regardless of the numbers (bb9e0ad).",
  delta:
    "deltas are computed in the template from raw `current`/`prior`, so a zero prior can render 'No prior-period baseline' instead of NaN (bb9e0ad). Pass `current` and `prior`, not a precomputed delta.",
  network_baseline:
    "`network_baseline` is a baseline for the block's own Value column, not for the distribution (it was 5 while age bands ran 2-22%). Do not pass it; omit `ageBaseline`/`genderBaseline` unless you have a same-scale number.",
  network_baseline_difference:
    "`network_baseline_difference` was null on every observed interest and demographic row — do not depend on it.",
  scaled_zscore: "pass the score as the numeric entry in `values[]`, not as its own key.",
  coverage_people: "`coverage_people` is the literal string \"Missing Value\" — ignore it.",
};

function editDistance(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function unknownKeyMessage(key, allowed) {
  const hint = KEY_HINTS[key];
  let near = null, best = Infinity;
  for (const cand of allowed) {
    const d = editDistance(key.toLowerCase(), cand.toLowerCase());
    if (d < best && d <= Math.max(2, Math.floor(cand.length / 3))) { best = d; near = cand; }
  }
  const parts = [`unknown key '${key}' — the template reads none of it, so it would be silently dropped.`];
  if (hint) parts.push(hint);
  else if (near) parts.push(`Did you mean '${near}'?`);
  parts.push(`Allowed here: ${allowed.join(", ")}.`);
  return parts.join(" ");
}

/* ==========================================================================
   Tiny hand-written strict schema checker.
   Specs: { type, required, doc, enum, range, of, shape, nonEmpty, url }
   type: string | text | boolean | number | numberOrNull | array | object
   ========================================================================== */
function checkValue(v, spec, path, ctx) {
  const t = spec.type;
  if (t === "boolean") {
    if (typeof v !== "boolean") ctx.err("R-TYPE", path, `expected true or false, got ${describe(v)}. ${spec.doc || ""}`.trim());
    return;
  }
  if (t === "string" || t === "text") {
    if (typeof v === "number" && t === "text") return;
    if (typeof v !== "string") {
      ctx.err("R-TYPE", path, `expected a string, got ${describe(v)}. ${spec.doc || ""}`.trim());
      return;
    }
    if (spec.nonEmpty && !v.trim()) ctx.err("R-TYPE", path, `must not be empty. ${spec.doc || ""}`.trim());
    if (spec.enum && !spec.enum.includes(v)) {
      ctx.err("R-TYPE", path, `must be one of ${spec.enum.map((e) => `'${e}'`).join(", ")}, got '${v}'. ${spec.doc || ""}`.trim());
    }
    if (spec.url && !/^https?:\/\//.test(v)) {
      ctx.err("R-TYPE", path, `must be an absolute http(s) URL — the template removes the 'Go to ZMP' button otherwise. Use the tool response's redirect_url.`);
    }
    return;
  }
  if (t === "number" || t === "numberOrNull") {
    if (v === null || v === undefined) {
      if (t === "numberOrNull") return;
      ctx.err("R-TYPE", path, `expected a number, got null. ${spec.doc || ""}`.trim());
      return;
    }
    if (typeof v === "string") {
      ctx.err("R-TYPE", path, `numbers must be JSON numbers, not strings (got ${JSON.stringify(v)}) — the template does the formatting, scaling and comparison. Strip the quotes the gateway put around the value.`);
      return;
    }
    if (typeof v !== "number") {
      ctx.err("R-TYPE", path, `expected a number, got ${describe(v)}. ${spec.doc || ""}`.trim());
      return;
    }
    if (!Number.isFinite(v)) {
      ctx.err("R-NONFINITE", path, `${v} is not a finite number. A NaN or Infinity here comes from dividing by a zero or null baseline — compute nothing and let the template render 'No prior-period baseline' instead (bb9e0ad).`);
      return;
    }
    if (spec.range) {
      const [lo, hi] = spec.range;
      if (v < lo || v > hi) {
        ctx.err("R-DOMAIN", path, `${v} is outside the declared ${spec.domain || `${lo}-${hi}`} scale. ${spec.doc || ""}`.trim());
      }
    }
    return;
  }
  if (t === "array") {
    if (!Array.isArray(v)) {
      ctx.err("R-TYPE", path, `expected an array, got ${describe(v)}. ${spec.doc || ""}`.trim());
      return;
    }
    if (spec.of) v.forEach((item, i) => checkValue(item, spec.of, `${path}[${i}]`, ctx));
    return;
  }
  if (t === "object") {
    checkShape(v, spec.shape, path, ctx);
    return;
  }
  if (t === "map") {
    // An open map whose keys are validated elsewhere (breakdown cells against columns).
    if (v === null || typeof v !== "object" || Array.isArray(v)) {
      ctx.err("R-TYPE", path, `expected an object, got ${describe(v)}. ${spec.doc || ""}`.trim());
      return;
    }
    for (const [k, x] of Object.entries(v)) checkValue(x, spec.values, `${path}.${k}`, ctx);
    return;
  }
  throw new Error(`internal: unknown spec type '${t}' at ${path}`);
}

function checkShape(v, shape, path, ctx) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    ctx.err("R-TYPE", path, `expected an object, got ${describe(v)}.`);
    return;
  }
  for (const [k, spec] of Object.entries(shape)) {
    const kp = path ? `${path}.${k}` : k;
    if (!(k in v)) {
      if (spec.required) {
        ctx.err("R-REQUIRED", kp, `missing required key '${k}'${spec.doc ? ` — ${spec.doc}` : ""}. The template reads it; absent, the section renders blank rather than failing.`);
      }
      continue;
    }
    checkValue(v[k], spec, kp, ctx);
  }
  const allowed = Object.keys(shape);
  for (const k of Object.keys(v)) {
    if (!allowed.includes(k)) {
      ctx.err("R-UNKNOWN", path ? `${path}.${k}` : k, unknownKeyMessage(k, allowed));
    }
  }
}

function describe(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  return typeof v === "object" ? "an object" : `${typeof v} ${JSON.stringify(v)}`;
}

/* ==========================================================================
   Schemas — the ACTUAL keys each template's data block consumes.
   ========================================================================== */
const KPI_TEXT = {
  type: "array",
  required: true,
  doc: "up to three headline cards; Customer Pulse may omit audience size when people_total is unavailable",
  of: {
    type: "object",
    shape: {
      value: { type: "text", required: true, doc: "preformatted display string" },
      label: { type: "string", required: true, nonEmpty: true },
      note: { type: "string", required: true },
    },
  },
};

const LABELLED_VALUES = {
  type: "array",
  doc: "one row per category; `values` has one entry per segment, in `segments` order",
  of: {
    type: "object",
    shape: {
      label: { type: "string", required: true, nonEmpty: true },
      values: { type: "array", required: true, of: { type: "numberOrNull" } },
    },
  },
};

const SCHEMAS = {
  "customer-pulse": {
    blockId: "pulse-data",
    skillDir: "opportunities-customer-pulse-executive-briefing",
    detect: (d) => d && d.product === "Customer Pulse",
    shape: {
      brand: { type: "string", required: true, nonEmpty: true },
      product: { type: "string", required: true, enum: ["Customer Pulse"] },
      account: { type: "string", required: true },
      siteId: { type: "string", doc: "live ZMP site ID for provenance; no gateway call solely for this" },
      asOf: { type: "string", required: true, nonEmpty: true },
      zmpUrl: { type: "string", required: true, url: true },
      segments: {
        type: "array", required: true,
        doc: "one per chosen segment, in display order — this array's length defines every values[] length",
        of: {
          type: "object",
          shape: {
            name: { type: "string", required: true, nonEmpty: true },
            // No `coverage`. The Data Cloud match rate is deliberately not rendered — it is
            // ~100% for every healthy segment. The strict shape makes a stale coverage key
            // an error rather than a silently ignored field.
          },
        },
      },
      headline: { type: "string", required: true, nonEmpty: true },
      kpis: KPI_TEXT,
      sourceLimit: { type: "string", nonEmpty: true, doc: "plain-language limitation when a section could not be built" },
      // Activity by Channel: share-of-activity percentages by channel (preferred_channel).
      activityChannel: LABELLED_VALUES,
      // Activity by Social Channel: signed % index vs the network baseline (social_media_platform).
      activitySocial: LABELLED_VALUES,
      // Characteristics are either signed baseline deltas or ranked-only strengths.
      // Defaults: Demographics, Psychographics, Online Content Consumption. Optional add-ons:
      // Transactions, Visitation, Financial & Household.
      characteristics: {
        type: "array",
        of: {
          type: "object",
          shape: {
            name: { type: "string", required: true, nonEmpty: true },
            caption: { type: "string", required: true },
            default: { type: "boolean", doc: "true for the always-on characteristics; false/omitted for user-selected add-ons" },
            scale: { type: "string", required: true, enum: ["baseline-delta", "ranked-strength"], doc: "baseline-delta is signed % vs network baseline; ranked-strength is a non-negative 0-100 score rendered without labels" },
            rows: {
              type: "array", required: true,
              of: {
                type: "object",
                shape: {
                  label: { type: "string", required: true, nonEmpty: true },
                  values: { type: "array", required: true, of: { type: "numberOrNull" }, doc: "signed baseline deltas or non-negative ranked-strength scores, according to the parent scale" },
                },
              },
            },
          },
        },
      },
      actions: {
        type: "array", required: true,
        of: { type: "object", shape: { title: { type: "string", required: true, nonEmpty: true }, body: { type: "string", required: true, nonEmpty: true } } },
      },
      provenance: { type: "string", required: true, nonEmpty: true },
    },
    semantic: pulseSemantic,
  },

  "insights-studio": {
    blockId: "studio-data",
    skillDir: "analytics-insights-studio-executive-briefing",
    detect: (d) => d && typeof d === "object" && "dataset" in d && "kpis" in d && !("product" in d),
    shape: {
      title: { type: "string", required: true, nonEmpty: true },
      dataset: { type: "string", required: true, nonEmpty: true },
      account: { type: "string", required: true },
      asOf: { type: "string", required: true, nonEmpty: true },
      current: { type: "object", required: true, shape: RANGE_SHAPE() },
      comparison: { type: "object", shape: RANGE_SHAPE() },
      zmpUrl: { type: "string", required: true, url: true },
      summary: { type: "string", required: true, nonEmpty: true },
      kpis: {
        type: "array", required: true,
        doc: "raw numbers only — the template derives the value, the delta and the arrow direction",
        of: {
          type: "object",
          shape: {
            label: { type: "string", required: true, nonEmpty: true },
            unit: { type: "string", required: true, enum: ["count", "rate", "percent", "money"] },
            current: { type: "numberOrNull", required: true },
            prior: { type: "numberOrNull", required: true },
            note: { type: "string", required: true },
          },
        },
      },
      series: {
        type: "object",
        shape: {
          name: { type: "string", required: true, nonEmpty: true },
          unit: { type: "string", required: true, enum: ["count", "rate", "percent", "money"] },
          points: {
            type: "array", required: true,
            of: {
              type: "object",
              shape: {
                t: { type: "string", required: true, nonEmpty: true },
                v: { type: "numberOrNull", required: true, doc: "null means no activity — a genuine gap, not a zero" },
              },
            },
          },
        },
      },
      breakdown: {
        type: "object",
        shape: {
          title: { type: "string", required: true, nonEmpty: true },
          dimension: { type: "string", required: true, nonEmpty: true },
          metric: { type: "string", required: true, nonEmpty: true },
          metricUnit: { type: "string", required: true, enum: ["count", "rate", "percent", "money"] },
          columns: {
            type: "array", required: true,
            of: {
              type: "object",
              shape: {
                key: { type: "string", required: true, nonEmpty: true },
                label: { type: "string", required: true, nonEmpty: true },
                unit: { type: "string", required: true, enum: ["count", "rate", "percent", "money"] },
              },
            },
          },
          rows: {
            type: "array", required: true,
            of: {
              type: "object",
              shape: {
                label: { type: "string", required: true, nonEmpty: true },
                value: { type: "numberOrNull", required: true },
                // Keys are checked against `breakdown.columns` in studioSemantic.
                cells: { type: "map", required: true, values: { type: "numberOrNull" } },
              },
            },
          },
        },
      },
      notes: { type: "array", of: { type: "string", nonEmpty: true } },
      provenance: { type: "string", required: true, nonEmpty: true },
    },
    semantic: studioSemantic,
  },
};

function RANGE_SHAPE() {
  return {
    start: { type: "string", required: true, nonEmpty: true },
    end: { type: "string", required: true, nonEmpty: true },
    label: { type: "string", required: true, nonEmpty: true },
  };
}

/* ==========================================================================
   Cross-cutting rules
   ========================================================================== */
function walk(v, path, fn) {
  fn(path, v);
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, fn));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, fn);
}

const BAD_STRINGS = /^(NaN|-?Infinity|undefined|null|\[object Object\]|Missing Value)$/;

function crossCutting(data, ctx) {
  walk(data, "", (path, v) => {
    if (typeof v === "string") {
      const ph = v.match(/\{\{[^}]*\}\}/);
      if (ph) {
        ctx.err("R-PLACEHOLDER", path || "(root)", `unreplaced template token ${ph[0]} survived into the data block. Fill it with a real value from a tool result, or drop the key — the artifact would print the token verbatim.`);
      }
      if (BAD_STRINGS.test(v.trim())) {
        ctx.err("R-NONFINITE", path || "(root)", `the literal string "${v}" reached the data block. That is a failed computation or an unhandled sentinel stringified — fix it upstream or use null (bb9e0ad; and coverage_people is literally "Missing Value").`);
      }
      if (/\bNaN\b|\bInfinity\b/.test(v)) {
        ctx.err("R-NONFINITE", path || "(root)", `text contains a stringified NaN/Infinity: ${JSON.stringify(v.slice(0, 80))}. A zero or null baseline produced it — render 'No prior-period baseline' instead of dividing (bb9e0ad).`);
      }
    }
    if (typeof v === "number" && !Number.isFinite(v)) {
      ctx.err("R-NONFINITE", path || "(root)", `${v} is not a finite number — a (0-0)/0 style delta. Do not compute a delta against a zero or null prior (bb9e0ad).`);
    }
  });
  (Array.isArray(data && data.kpis) ? data.kpis : []).forEach((k, i) => {
    const shown = k && Object.prototype.hasOwnProperty.call(k, "value") ? k.value : k && k.current;
    if (shown == null || (typeof shown === "string" && /^(not returned|unavailable|missing|n\/a)$/i.test(shown.trim()))) {
      ctx.err("R-KPI-EMPTY", `kpis[${i}]`, "a headline card has no current decision-useful value. Drop or replace the KPI using already-fetched data and disclose the unavailable source in provenance; do not render an empty-status card.");
    }
  });
}

/* Field provenance: does the column this chart is fed actually exist?
   The manifest maps a data-block path to the gateway block that fed it:
     { "interests[0].rows[].values": { "block": "..._transactional_interest_0",
                                       "valueField": "scaled_zscore",
                                       "columns": ["Title", ...]   // optional
                                       "labelField": "Title" } }   // optional
*/
/* Paths whose meaning silently changes if the wrong source column was charted — so the
   manifest MUST declare where each came from. Deliberately not "every array": a manifest
   large enough to be annoying is a manifest people route around, which defeats the gate.
   These are the ones where a wrong column produces a confident, wrong picture. */
const REQUIRED_PROVENANCE = {
  "customer-pulse": [
    // Over-index characteristics are the chart most likely to be fed the wrong column; the
    // value must be the signed % difference from the network baseline, not a raw index/count.
    { probe: (d) => (Array.isArray(d.characteristics) ? d.characteristics.map((_, i) => `characteristics[${i}].rows[].values`) : []),
      why: "characteristic over-index values must come from the block's baseline-difference column, not a raw index or count" },
  ],
  "insights-studio": [
    { probe: (d) => (d.series && Array.isArray(d.series.points) && d.series.points.length ? ["series.points[].v"] : []),
      why: "the trend metric is where a rate/fraction mix-up renders a real 45.9% as 0.459% (bb9e0ad)" },
  ],
};

function requiredProvenance(data, skill, manifest, ctx) {
  const declared = new Set(Object.keys(manifest || {}));
  for (const req of REQUIRED_PROVENANCE[skill] || []) {
    for (const path of req.probe(data)) {
      if (!declared.has(path)) {
        ctx.err("R-FIELD", path,
          `--source declares no provenance for this path, so it could not be checked that the charted column exists in the block that fed it. ${req.why}. ` +
          `Add an entry: {"${path}": {"block": "<gateway block name>", "valueField": "<column>"}}. ` +
          `If the block is not one of the verified families, include its response column list as \`columns\`.`);
      }
    }
  }
}

function fieldProvenance(manifest, ctx) {
  if (!manifest) {
    ctx.err("R-FIELD", "(root)",
      "--source is required. Without a field-provenance manifest there is no way to check that a charted column actually exists in the gateway block that fed it — the rule that catches `index_value` on a block returning only `scaled_zscore` (the 4b921fb headline bug). " +
      "Pass --source with one entry per chart: {\"<path>\": {\"block\": \"<gateway block>\", \"valueField\": \"<column>\"}}.");
    return;
  }
  if (typeof manifest !== "object" || Array.isArray(manifest)) {
    ctx.err("R-FIELD", "(manifest)", "the --source manifest must be a JSON object mapping data-block paths to {block, valueField, columns?, labelField?}.");
    return;
  }
  for (const [path, entry] of Object.entries(manifest)) {
    if (!entry || typeof entry !== "object") {
      ctx.err("R-FIELD", path, "manifest entry must be an object with at least {block, valueField}.");
      continue;
    }
    const allowedKeys = ["block", "valueField", "columns", "labelField"];
    for (const k of Object.keys(entry)) {
      if (!allowedKeys.includes(k)) ctx.err("R-UNKNOWN", `(manifest).${path}.${k}`, unknownKeyMessage(k, allowedKeys));
    }
    const fam = familyFor(entry.block);
    const columns = Array.isArray(entry.columns) && entry.columns.length
      ? entry.columns
      : (fam ? fam.columns : null);
    if (!columns) {
      ctx.warn("R-FIELD-UNVERIFIED", path,
        `block '${entry.block}' matches no verified block family and no explicit \`columns\` were supplied, so its fields could not be checked. Add the response's column list to the manifest entry.`);
      continue;
    }
    for (const [key, label] of [["valueField", "charted value"], ["labelField", "row label"]]) {
      const f = entry[key];
      if (f == null) continue;
      if (typeof f !== "string") { ctx.err("R-FIELD", `${path}.${key}`, `${key} must be a column name string.`); continue; }
      if (!columns.includes(f)) {
        const suggestion = key === "valueField" ? (fam && fam.chartField) : (fam && fam.labelField);
        const hint = KEY_HINTS[f];
        ctx.err("R-FIELD", path,
          `${label} references \`${f}\`, which ${entry.block} does not return; its columns are ${columns.join(", ")}.` +
          (suggestion ? ` Use \`${suggestion}\`.` : "") +
          (hint ? ` ${hint}` : "") +
          (fam && fam.note ? ` (${fam.note})` : "") +
          " See SKILL.md 'Reading the response'.");
      }
    }
  }
}

/* ==========================================================================
   Semantic helpers shared by the skills
   ========================================================================== */
function finiteValues(rows, pick) {
  const out = [];
  for (const r of rows || []) for (const v of pick(r) || []) if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  return out;
}

// Warnings: a chart that renders N equal bars says nothing.
function flatnessChecks(name, path, vals, rowCount, ctx) {
  if (!vals.length || rowCount < 2) return;
  const uniq = new Set(vals);
  if (uniq.size === 1) {
    const only = vals[0];
    if (only === 0) {
      ctx.warn("R-ALL-ZERO", path, `every charted value in ${name} is 0, so the chart renders ${rowCount} zero-length bars. Drop the dimension and say why, or chart a measure that varies (bb9e0ad: 4 of 6 channels sent nothing).`);
    } else {
      ctx.warn("R-FLAT-TIER", path, `every charted value in ${name} is identical (${only}) — a 20-row page landed inside one tie band, which renders as ${rowCount} equal bars and compares nothing. Drop this dimension (4b921fb).`);
    }
  }
}

// The values[]/segments[] alignment rule.
function alignment(rows, rowsPath, segCount, ctx) {
  (rows || []).forEach((r, i) => {
    if (!r || !Array.isArray(r.values)) return;
    if (r.values.length !== segCount) {
      ctx.err("R-LENGTH", `${rowsPath}[${i}].values`,
        `has ${r.values.length} ${r.values.length === 1 ? "entry" : "entries"} but there ${segCount === 1 ? "is" : "are"} ${segCount} segment${segCount === 1 ? "" : "s"}. Every values[] must carry exactly one entry per segment, in \`segments\` order — pad with null where a segment has no row for '${r.label}', never by shifting. A short array silently reassigns bars to the wrong segment.`);
    }
  });
}

// Is the array a distribution (bands that partition the audience)?
function looksLikeDistribution(rows) {
  if (!rows || rows.length < 2) return false;
  const perSeg = [];
  for (const r of rows) (r.values || []).forEach((v, i) => {
    if (typeof v === "number" && Number.isFinite(v)) perSeg[i] = (perSeg[i] || 0) + v;
  });
  return perSeg.some((s) => s > 85 && s < 115);
}

function percentScaleChecks(name, rows, path, ctx) {
  const vals = finiteValues(rows, (r) => r.values);
  if (!vals.length) return;
  const max = Math.max(...vals), min = Math.min(...vals);
  if (min < 0) ctx.err("R-DOMAIN", path, `${name} contains a negative percentage (${min}); the bars are drawn from a zero floor and would render inverted.`);
  if (max > 100) ctx.err("R-DOMAIN", path, `${name} declares a 0-100 percentage scale but the largest value is ${max}. Either it is not a percentage or it was scaled twice.`);
  if (max > 0 && max <= 1 && vals.length >= 2) {
    ctx.err("R-SCALE", path,
      `${name} looks like unscaled fractions — every value is <= 1 (max ${max}) — but the chart labels every bar with '%', so a real ${(max * 100).toFixed(1)}% would render as ${max}%. Multiply by 100 before filling the block: 0.458062 is 45.8%, not 0.458% (bb9e0ad). If these genuinely are all sub-one-percent figures, scale them anyway and say so in \`provenance\`; unscaled they are indistinguishable from the bug.`);
  }
}

function baselineChecks(key, baseline, rows, ctx) {
  if (baseline == null) return;
  if (typeof baseline !== "number" || !Number.isFinite(baseline)) return; // typed elsewhere
  const vals = finiteValues(rows, (r) => r.values);
  if (!vals.length) {
    ctx.err("R-BASELINE", key, `${key} is set but the chart it belongs to has no rows, so a dashed rule would be drawn against nothing. Omit the key.`);
    return;
  }
  const max = Math.max(...vals), min = Math.min(...vals);
  if (looksLikeDistribution(rows)) {
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (baseline < mean / 2 || baseline > mean * 2) {
      ctx.err("R-BASELINE", key,
        `${baseline} is not on the same scale as the bars it would be drawn against (they run ${min}-${max} and a uniform baseline across ${rows.length} bands would be about ${Number(mean.toFixed(1))}). This is the \`network_baseline\` trap: it was 5 while age bands ran 2-22%, because it baselines the block's own Value column, not the distribution. Omit ${key} unless you have a same-scale number — the template then hides the dashed rule and its caption (4b921fb).`);
    }
    return;
  }
  const span = (max - min) || Math.abs(max) || 1;
  if (baseline < min - span || baseline > max + span) {
    ctx.err("R-BASELINE", key,
      `${baseline} falls far outside the range of the series it would be drawn against (${min}-${max}), so the dashed rule lands off the plot or flattens every bar. Omit ${key} unless the baseline is on the bars' own scale (4b921fb).`);
  }
}

/* ==========================================================================
   Per-skill semantic rules
   ========================================================================== */
function pulseSemantic(d, ctx) {
  const segs = Array.isArray(d.segments) ? d.segments : [];
  const segCount = segs.length;
  if (!segCount) {
    ctx.err("R-REQUIRED", "segments", "at least one segment is required — `segments` is what binds each entry of every values[] to an audience, and the title, legend and colours all come from it.");
  }

  // Activity by Channel is a set of share-of-activity percentages (0-100).
  const chan = d.activityChannel;
  if (Array.isArray(chan) && chan.length) {
    alignment(chan, "activityChannel", segCount, ctx);
    percentScaleChecks("activityChannel", chan, "activityChannel", ctx);
    dedupeLabels(chan, "activityChannel", ctx);
  }
  // Activity by Social is a signed % index vs the network baseline (may be negative).
  if (Array.isArray(d.activitySocial) && d.activitySocial.length) {
    alignment(d.activitySocial, "activitySocial", segCount, ctx);
    dedupeLabels(d.activitySocial, "activitySocial", ctx);
  }

  // Characteristics: signed baseline deltas or non-negative ranked strengths.
  (Array.isArray(d.characteristics) ? d.characteristics : []).forEach((dim, i) => {
    const p = `characteristics[${i}]`;
    const rows = Array.isArray(dim && dim.rows) ? dim.rows : [];
    dedupeLabels(rows, `${p}.rows`, ctx);
    alignment(rows, `${p}.rows`, segCount, ctx);
    const vals = finiteValues(rows, (r) => r.values);
    if (dim && dim.scale === "ranked-strength" && vals.some((v) => v < 0)) {
      ctx.err("R-SCALE", `${p}.rows`, "ranked-strength values cannot be negative; negative values are signed baseline deltas and require scale: 'baseline-delta'.");
    }
    if (dim && dim.scale === "baseline-delta" && new Set(vals).size >= 2 && vals.every((v) => v >= 0 && v <= 100)) {
      ctx.err("R-SCALE", `${p}.rows`, "baseline-delta values look like non-negative 0-100 scores. Use scale: 'ranked-strength' unless the source explicitly proves these are signed deltas.");
    }
    if (rows.length && !vals.length) {
      ctx.err("R-DOMAIN", `${p}.rows`, `every value is null, so the chart draws nothing but labels. Drop the characteristic instead of shipping an empty chart.`);
    }
    flatnessChecks(`${p} (${dim && dim.name})`, `${p}.rows`, vals, rows.length, ctx);
  });

  if (Array.isArray(d.kpis) && d.kpis.length > 3) {
    ctx.warn("R-KPI-COUNT", "kpis", `${d.kpis.length} KPI cards; Customer Pulse supports at most three anomaly cards.`);
  }
  // No absolute headcounts anywhere: an anomaly KPI must be a relative/index expression.
  (Array.isArray(d.kpis) ? d.kpis : []).forEach((k, i) => {
    const v = String(k && k.value || "");
    if (/\d{3,}/.test(v.replace(/%/g, "")) && !/%|x|×|index/i.test(v)) {
      ctx.err("R-DOMAIN", `kpis[${i}].value`, `"${v}" looks like an absolute count. Overview cards are top anomalies expressed as a relative over/under-index (e.g. "+240%"), never a headcount.`);
    }
  });
  const banned = /\b\d[\d,]{3,}\b\s*(records|people|profiles|customers)\b|records addressable/i;
  if (banned.test(String(d.provenance || ""))) {
    ctx.err("R-SOURCE", "provenance", "provenance must not include raw record/people totals or \"records addressable\" — name sources and methodology, never volumes.");
  }
}
// Flag repeated labels within a labelled-values array (un-deduplicated continuation rows).
function dedupeLabels(rows, path, ctx) {
  const seen = new Set();
  (rows || []).forEach((row, i) => {
    const label = String(row && row.label || "").trim().toLowerCase();
    if (label && seen.has(label)) {
      ctx.err("R-DUPLICATE", `${path}[${i}].label`, `duplicate label "${row.label}" indicates repeated continuation rows were not deduplicated. Preserve the first ranked occurrence.`);
    }
    if (label) seen.add(label);
  });
}

function unitRangeChecks(unit, values, path, what, ctx) {
  const vals = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (!vals.length) return;
  const max = Math.max(...vals), min = Math.min(...vals);
  if (unit === "rate") {
    // The template multiplies by 100 and appends '%', so a rate must arrive as a fraction.
    if (max > 1.5) {
      ctx.err("R-SCALE", path, `${what} declares unit "rate" but the largest value is ${max}. The template scales rates by 100 and appends '%', so a rate must arrive as the gateway's fraction (open_rate 0.458062 = 45.8%). Passing ${max} renders ${max * 100}%. Use unit "percent" if the value is already scaled (bb9e0ad).`);
    }
    if (min < 0) ctx.err("R-DOMAIN", path, `${what} declares unit "rate" but has a negative value (${min}).`);
  }
  if (unit === "percent") {
    if (max > 0 && max <= 1 && vals.length >= 2) {
      ctx.err("R-SCALE", path, `${what} declares unit "percent" but every value is <= 1 (max ${max}), so a real ${(max * 100).toFixed(1)}% renders as ${max}%. Either scale by 100 or declare unit "rate" and let the template scale in one place (bb9e0ad).`);
    }
    if (max > 100) ctx.err("R-DOMAIN", path, `${what} declares unit "percent" but the largest value is ${max}.`);
  }
  if (unit === "count" && min < 0) {
    ctx.err("R-DOMAIN", path, `${what} declares unit "count" but has a negative value (${min}).`);
  }
}

function studioSemantic(d, ctx) {
  const kpis = Array.isArray(d.kpis) ? d.kpis : [];
  kpis.forEach((k, i) => {
    if (!k || typeof k !== "object") return;
    unitRangeChecks(k.unit, [k.current, k.prior], `kpis[${i}]`, `'${k.label}'`, ctx);
    if (k.current != null && (k.prior === 0 || k.prior === null)) {
      ctx.warn("R-ZERO-BASELINE", `kpis[${i}].prior`,
        `prior is ${k.prior === 0 ? "0" : "null"}, so '${k.label}' will read "${k.prior === 0 ? "No prior-period baseline" : "No comparison available"}" instead of a percentage — (0-0)/0 is NaN. Correct as data; say so in \`notes\` so the blank card is explained (bb9e0ad).`);
    }
  });
  if (kpis.length === 0) {
    ctx.err("R-KPI-EMPTY", "kpis",
      "contains no headline KPI. An Insights Studio artifact with an empty KPI card is not a briefing — return to the live viability interview and select a populated goal, period, or dataset before rendering.");
  } else if (kpis.length !== 3) {
    ctx.warn("R-KPI-COUNT", "kpis", `${kpis.length} KPI cards; the layout is built for 3.`);
  }

  for (const key of ["current", "comparison"]) {
    const r = d[key];
    if (r && typeof r === "object" && typeof r.start === "string" && typeof r.end === "string" && r.start > r.end) {
      ctx.err("R-DOMAIN", key, `start (${r.start}) is after end (${r.end}).`);
    }
  }

  const S = d.series;
  if (S && typeof S === "object") {
    const pts = Array.isArray(S.points) ? S.points : [];
    unitRangeChecks(S.unit, pts.map((p) => p && p.v), "series.points", `series '${S.name}'`, ctx);
    const plotted = pts.filter((p) => p && typeof p.v === "number" && Number.isFinite(p.v));
    if (pts.length && plotted.length < 2) {
      ctx.err("R-DOMAIN", "series.points", `only ${plotted.length} of ${pts.length} points carry a number, and a line needs at least 2. Either fetch a longer range or drop the trend section — do not substitute 0 for a missing day, which draws a cliff to the axis instead of a gap (bb9e0ad).`);
    }
    flatnessChecks("series.points", "series.points", plotted.map((p) => p.v), plotted.length, ctx);
    const ts = pts.map((p) => p && p.t);
    if (new Set(ts).size !== ts.length) {
      ctx.err("R-DUPLICATE", "series.points", `contains duplicate \`t\` values. Ordering by the measure alone at a small page size makes a row appear on two pages while another appears on none — a secondary sort on the dimension is mandatory (bb9e0ad).`);
    }
  }

  const B = d.breakdown;
  if (B && typeof B === "object") {
    const cols = Array.isArray(B.columns) ? B.columns : [];
    const keys = cols.map((c) => c && c.key);
    const rows = Array.isArray(B.rows) ? B.rows : [];
    rows.forEach((r, i) => {
      if (!r || typeof r.cells !== "object" || r.cells === null || Array.isArray(r.cells)) return;
      const have = Object.keys(r.cells);
      for (const k of keys) {
        if (k && !have.includes(k)) {
          ctx.err("R-LENGTH", `breakdown.rows[${i}].cells`, `is missing '${k}', which \`breakdown.columns\` declares. Every row must carry exactly one cell per declared column, or the table prints a value under the wrong heading.`);
        }
      }
      for (const k of have) {
        if (!keys.includes(k)) {
          ctx.err("R-UNKNOWN", `breakdown.rows[${i}].cells.${k}`, unknownKeyMessage(k, keys.filter(Boolean)));
        }
      }
    });
    // Unit checks run per column across every row: a fraction is only distinguishable from
    // a scaled percentage when you can see the whole column.
    for (const c of cols) {
      if (!c || !c.key) continue;
      const colVals = rows.map((r) => r && r.cells && typeof r.cells === "object" ? r.cells[c.key] : undefined);
      unitRangeChecks(c.unit, colVals, `breakdown.cells.${c.key}`, `column '${c.label}'`, ctx);
    }
    const dup = new Set(keys.filter(Boolean));
    if (dup.size !== keys.filter(Boolean).length) ctx.err("R-DUPLICATE", "breakdown.columns", `two columns share a \`key\`; the later one silently overwrites the earlier in every row's \`cells\`.`);
    unitRangeChecks(B.metricUnit, rows.map((r) => r && r.value), "breakdown.rows", `the '${B.metric}' bars`, ctx);
    const vs = rows.map((r) => r && r.value).filter((v) => typeof v === "number" && Number.isFinite(v));
    flatnessChecks(`breakdown '${B.metric}'`, "breakdown.rows", vs, rows.length, ctx);
    const labels = rows.map((r) => r && r.label);
    if (new Set(labels).size !== labels.length) {
      ctx.err("R-DUPLICATE", "breakdown.rows", `contains duplicate labels. At a small page size, ordering by the measure alone put one row on two pages and another on none — add a mandatory secondary sort on the dimension (bb9e0ad).`);
    }
  }
}

/* ==========================================================================
   Entry points
   ========================================================================== */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractDataBlock(text, blockId) {
  const ids = blockId ? [blockId] : ["pulse-data", "studio-data"];

  for (const id of ids) {
    const safeId = escapeRegExp(id);

    const re = new RegExp(
      `<script[^>]*id=["']${safeId}["'][^>]*>([\\s\\S]*?)</script>`,
      "i"
    );

    const m = text.match(re);

    if (m) {
      return {
        id,
        json: m[1].trim()
      };
    }
  }

  return null;
}

export function validateDataBlock(data, opts = {}) {
  const errors = [], warnings = [];
  const ctx = {
    err: (rule, path, message) => errors.push({ rule, path, message }),
    warn: (rule, path, message) => warnings.push({ rule, path, message }),
  };

  let key = opts.skill || null;
  if (key && !SCHEMAS[key]) {
    return { ok: false, skill: null, errors: [{ rule: "R-SKILL", path: "(root)", message: `unknown --skill '${key}'. Known: ${Object.keys(SCHEMAS).join(", ")}.` }], warnings };
  }
  if (!key) key = Object.keys(SCHEMAS).find((k) => SCHEMAS[k].detect(data)) || null;
  if (!key) {
    return {
      ok: false, skill: null, warnings,
      errors: [{ rule: "R-SKILL", path: "(root)", message: `could not tell which skill this data block belongs to. Set \`product\` to "Customer Pulse" or "Insights Studio", or pass --skill (${Object.keys(SCHEMAS).join(", ")}).` }],
    };
  }

  const schema = SCHEMAS[key];
  crossCutting(data, ctx);
  checkShape(data, schema.shape, "", ctx);
  schema.semantic(data, ctx);
  fieldProvenance(opts.source, ctx);
  // An empty or partial manifest must not satisfy a required check — otherwise
  // `--source empty.json` reopens exactly the hole that making it required closed.
  if (opts.source) requiredProvenance(data, key, opts.source, ctx);

  return { ok: errors.length === 0, skill: key, errors, warnings };
}

// Throws on any error. For programmatic use right before writing the artifact.
export function assertDataBlock(data, opts = {}) {
  const r = validateDataBlock(data, opts);
  if (!r.ok) {
    const e = new Error(`data block validation FAILED (${r.errors.length} error${r.errors.length === 1 ? "" : "s"}):\n` +
      r.errors.map((x) => `  - [${x.rule}] ${x.path || "(root)"}: ${x.message}`).join("\n"));
    e.result = r;
    throw e;
  }
  return r;
}

// Confine user-supplied paths to process.cwd() so argv cannot traverse.
// Resolve/normalize, reject encoded ".." segments and null bytes, then require
// the canonical path to stay under the working directory via path.relative
// (not a raw string prefix, which treats /tmp/root-evil as inside /tmp/root).
function hasEncodedParentSegment(userPath) {
  if (userPath.includes("\0")) return true;
  return userPath.split(/[/\\]|%2f|%5c/i).some((seg) => seg.replace(/%2e/gi, ".") === "..");
}

function relInside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
}

function isInsideRoot(root, candidate) {
  root = stripWinNamespace(String(root));
  candidate = stripWinNamespace(String(candidate));
  if (relInside(root, candidate)) return true;
  try {
    if (relInside(realpathSync(root), realpathSync(candidate))) return true;
  } catch { /* 8.3 vs long names: fail closed rather than reopen ancestor names */ }
  return false;
}

function containedFilePath(userPath, rootDir = process.cwd()) {
  if (typeof userPath !== "string" || userPath.length === 0) {
    throw new Error("path must be a non-empty string");
  }
  if (hasEncodedParentSegment(userPath)) {
    throw new Error(`refusing encoded ".." segment or null-byte path: ${userPath}`);
  }
  const logicalRoot = resolve(rootDir);
  const resolved = resolve(logicalRoot, normalize(userPath));
  if (!isInsideRoot(logicalRoot, resolved)) {
    throw new Error(`path is outside the working directory: ${userPath}`);
  }
  // Reject-only snapshot. Do not open this string: a parent can be replaced
  // with a symlink before a later pathname open. Callers hold a root directory
  // fd first and read with readValidatedFd relative to that fd.
  const canonicalRoot = realpathSync(logicalRoot);
  const canonical = realpathSync(resolved);
  if (!isInsideRoot(canonicalRoot, canonical)) {
    throw new Error(`path is outside the working directory: ${userPath}`);
  }
  return canonical;
}

function resolveUnderRoot(userPath, rootDir) {
  const root = resolve(rootDir);
  const resolved = resolve(root, normalize(userPath));
  if (!resolved.startsWith(root)) {
    if (process.platform !== "win32" || !isInsideRoot(root, resolved)) {
      throw new Error(`path is outside the working directory: ${userPath}`);
    }
  }
  const rel = relative(root, resolved);
  if (rel.startsWith(".." + sep) || rel === "..") {
    if (process.platform !== "win32" || !isInsideRoot(root, resolved)) {
      throw new Error(`path is outside the working directory: ${userPath}`);
    }
  }
  return { root, resolved };
}

function openRootDir(rootPath) {
  let flags = constants.O_RDONLY;
  if (constants.O_DIRECTORY) flags |= constants.O_DIRECTORY;
  if (constants.O_CLOEXEC) flags |= constants.O_CLOEXEC;
  return openSync(rootPath, flags);
}

function dirFdAnchor(fd) {
  const proc = `/proc/self/fd/${fd}`;
  if (process.platform !== "win32" && existsSync(proc)) return proc;
  return null;
}

function nameHasPathSep(name) {
  if (name.includes("/") || name.includes("\0")) return true;
  return process.platform === "win32" && name.includes("\\");
}

function lookupAt(dirFd, name, flags) {
  if (typeof name !== "string" || name.length === 0 || nameHasPathSep(name)) {
    throw new Error("path is outside the working directory");
  }
  const anchor = dirFdAnchor(dirFd);
  // Do not path.join the proc-fd anchor: join("/proc/self/fd/3", "..") becomes
  // /proc/self/fd, which is not openat(..). Keep the ".." segment for the kernel.
  if (anchor) return openSync(`${anchor}/${name}`, flags);
  // Fail closed: converting the dir fd to a pathname and reopening it races with
  // rename+symlink of a parent. O_NOFOLLOW only covers the last component.
  throw new Error("path is outside the working directory");
}

function containedRelParts(root, filePath) {
  const rel = relative(resolve(root), resolve(filePath));
  if (rel === "" || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
    throw new Error("path is outside the working directory");
  }
  // Split only on the platform separator. On POSIX, "\\" is a filename
  // character; splitting on both would open a/b.json for a request of a\\b.json.
  const parts = rel.split(sep).filter((p) => p && p !== ".");
  if (parts.length === 0 || parts.some((p) => p === ".." || nameHasPathSep(p))) {
    throw new Error("path is outside the working directory");
  }
  return parts;
}

function isDirFdUnderRootFd(dirFd, rootFd) {
  const want = fstatSync(rootFd);
  if (want.ino === 0) return false;
  let cur = dirFd;
  let owned = false;
  try {
    for (let i = 0; i < 64; i++) {
      const st = fstatSync(cur);
      if (st.dev === want.dev && st.ino === want.ino) return true;
      let parent;
      try {
        let flags = constants.O_RDONLY;
        if (constants.O_DIRECTORY) flags |= constants.O_DIRECTORY;
        parent = lookupAt(cur, "..", flags);
      } catch {
        return false;
      }
      const pst = fstatSync(parent);
      if (pst.dev === st.dev && pst.ino === st.ino) {
        closeSync(parent);
        return false;
      }
      if (owned) closeSync(cur);
      cur = parent;
      owned = true;
    }
    return false;
  } finally {
    if (owned && cur !== dirFd) {
      try { closeSync(cur); } catch { /* already closed */ }
    }
  }
}

function openFileUnderRootFd(rootFd, parts, flags) {
  let dirFd = rootFd;
  const extra = [];
  try {
    for (let i = 0; i < parts.length - 1; i++) {
      let dirFlags = constants.O_RDONLY;
      if (constants.O_DIRECTORY) dirFlags |= constants.O_DIRECTORY;
      if (constants.O_NOFOLLOW) dirFlags |= constants.O_NOFOLLOW;
      const next = lookupAt(dirFd, parts[i], dirFlags);
      if (dirFd !== rootFd) extra.push(dirFd);
      dirFd = next;
    }
    let fileFlags = flags;
    if (constants.O_NOFOLLOW) fileFlags |= constants.O_NOFOLLOW;
    const fileFd = lookupAt(dirFd, parts[parts.length - 1], fileFlags);
    try {
      // Open first, then verify the parent dir fd still reaches rootFd. A
      // check-then-open window lets a rename move dirFd outside the root
      // before lookupAt.
      if (!isDirFdUnderRootFd(dirFd, rootFd)) {
        throw new Error("path is outside the working directory");
      }
      return fileFd;
    } catch (e) {
      closeSync(fileFd);
      throw e;
    }
  } finally {
    for (const fd of extra) {
      try { closeSync(fd); } catch { /* */ }
    }
    if (dirFd !== rootFd) {
      try { closeSync(dirFd); } catch { /* */ }
    }
  }
}

function stripWinNamespace(p) {
  if (p.startsWith("\\\\?\\UNC\\") || p.startsWith("\\??\\UNC\\")) return "\\\\" + p.slice(8);
  if (p.startsWith("\\\\?\\") || p.startsWith("\\??\\")) return p.slice(4);
  return p;
}

// Same 32 MiB cap on every platform. POSIX opens nonblocking, requires a
// regular file, and reads in bounded chunks so a FIFO or a file that grows
// after fstat cannot hang or exceed the cap. Oversize is never a path failure.
const MAX_VALIDATOR_BYTES = 32 * 1024 * 1024;
const READ_CHUNK = 64 * 1024;

function tooLargeError() {
  return new Error(`input file exceeds ${MAX_VALIDATOR_BYTES / (1024 * 1024)} MiB`);
}

function notRegularFileError() {
  return new Error("input is not a regular file");
}

function readFdBounded(fd) {
  const st = fstatSync(fd);
  if (!st.isFile()) throw notRegularFileError();
  if (st.size > MAX_VALIDATOR_BYTES) throw tooLargeError();
  const chunks = [];
  let total = 0;
  const buf = Buffer.alloc(READ_CHUNK);
  for (;;) {
    const want = Math.min(buf.length, MAX_VALIDATOR_BYTES - total + 1);
    let n;
    try {
      n = readSync(fd, buf, 0, want, null);
    } catch (e) {
      if (e && (e.code === "EAGAIN" || e.code === "EWOULDBLOCK")) throw notRegularFileError();
      throw e;
    }
    if (n === 0) break;
    total += n;
    if (total > MAX_VALIDATOR_BYTES) throw tooLargeError();
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

function isStdioMaxBuffer(err) {
  return Boolean(err) && (err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || /maxBuffer/i.test(String(err.message)));
}

// Open each relative component from the trusted root handle (NtCreateFile
// RootDirectory), then contain using GetFinalPathNameByHandle on those same
// handles. Do not CreateFileW a pathname built from a rootFinal snapshot:
// a rename+replace of the root between that snapshot and the open would
// still look "inside" the stale string.
const WIN_HANDLE_SCRIPT = String.raw`
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;
public static class VdbWin {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern IntPtr CreateFileW(string lpFileName, uint dwDesiredAccess, uint dwShareMode, IntPtr lpSecurityAttributes, uint dwCreationDisposition, uint dwFlagsAndAttributes, IntPtr hTemplateFile);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern uint GetFinalPathNameByHandleW(IntPtr hFile, StringBuilder lpszFilePath, uint cchFilePath, uint dwFlags);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern uint GetLongPathNameW(string lpszShortPath, StringBuilder lpszLongPath, uint cchBuffer);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern uint GetShortPathNameW(string lpszLongPath, StringBuilder lpszShortPath, uint cchBuffer);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool GetFileInformationByHandle(IntPtr hFile, out BY_HANDLE_FILE_INFORMATION info);
  [DllImport("kernel32.dll")]
  static extern uint GetFileType(IntPtr hFile);
  [DllImport("msvcrt.dll", CallingConvention=CallingConvention.Cdecl)]
  static extern IntPtr _get_osfhandle(int fd);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool CloseHandle(IntPtr hObject);
  [DllImport("ntdll.dll")]
  static extern int NtCreateFile(out IntPtr FileHandle, uint DesiredAccess, ref OBJECT_ATTRIBUTES ObjectAttributes, ref IO_STATUS_BLOCK IoStatusBlock, IntPtr AllocationSize, uint FileAttributes, uint ShareAccess, uint CreateDisposition, uint CreateOptions, IntPtr EaBuffer, uint EaLength);
  [StructLayout(LayoutKind.Sequential)]
  struct UNICODE_STRING {
    public ushort Length;
    public ushort MaximumLength;
    public IntPtr Buffer;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct OBJECT_ATTRIBUTES {
    public int Length;
    public IntPtr RootDirectory;
    public IntPtr ObjectName;
    public uint Attributes;
    public IntPtr SecurityDescriptor;
    public IntPtr SecurityQualityOfService;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct IO_STATUS_BLOCK {
    public IntPtr Status;
    public IntPtr Information;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct BY_HANDLE_FILE_INFORMATION {
    public uint dwFileAttributes;
    public uint ftCLo, ftCHi, ftALo, ftAHi, ftWLo, ftWHi;
    public uint dwVolumeSerialNumber;
    public uint nFileSizeHigh, nFileSizeLow, nNumberOfLinks;
    public uint nFileIndexHigh, nFileIndexLow;
  }
  const uint GENERIC_READ = 0x80000000;
  const uint SYNCHRONIZE = 0x00100000;
  const uint SHARE = 0x00000003;
  const uint OPEN_EXISTING = 3;
  const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
  const uint FILE_OPEN = 1;
  const uint FILE_DIRECTORY_FILE = 0x00000001;
  const uint FILE_SYNCHRONOUS_IO_NONALERT = 0x00000020;
  const uint FILE_NON_DIRECTORY_FILE = 0x00000040;
  const uint FILE_OPEN_REPARSE_POINT = 0x00200000;
  const uint OBJ_CASE_INSENSITIVE = 0x00000040;
  const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
  static string StripNs(string p) {
    if (p.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) return @"\\" + p.Substring(8);
    if (p.StartsWith(@"\\?\", StringComparison.OrdinalIgnoreCase)) return p.Substring(4);
    if (p.StartsWith(@"\??\UNC\", StringComparison.OrdinalIgnoreCase)) return @"\\" + p.Substring(8);
    if (p.StartsWith(@"\??\", StringComparison.OrdinalIgnoreCase)) return p.Substring(4);
    return p;
  }
  static string Expand(string p, bool lng) {
    string[] tries = new string[] { StripNs(p), p };
    foreach (string t in tries) {
      if (string.IsNullOrEmpty(t)) continue;
      StringBuilder sb = new StringBuilder(32768);
      uint n = lng ? GetLongPathNameW(t, sb, (uint)sb.Capacity) : GetShortPathNameW(t, sb, (uint)sb.Capacity);
      if (n > 0 && n < (uint)sb.Capacity) return sb.ToString().TrimEnd('\\', '/');
    }
    return StripNs(p).TrimEnd('\\', '/');
  }
  static string Canonical(string p) { return Expand(p, true); }
  const uint VOLUME_NAME_NT = 2;
  static string FinalPath(IntPtr h, uint flags) {
    StringBuilder sb = new StringBuilder(32768);
    uint n = GetFinalPathNameByHandleW(h, sb, (uint)sb.Capacity, flags);
    if (n == 0 || n > (uint)sb.Capacity) {
      if (flags != 0) return "";
      throw new IOException("GetFinalPathNameByHandle failed");
    }
    return sb.ToString();
  }
  static bool InsideOne(string root, string candidate) {
    if (string.IsNullOrEmpty(root) || string.IsNullOrEmpty(candidate)) return false;
    if (string.Equals(root, candidate, StringComparison.OrdinalIgnoreCase)) return true;
    if (candidate.Length <= root.Length) return false;
    if (!candidate.StartsWith(root, StringComparison.OrdinalIgnoreCase)) return false;
    char next = candidate[root.Length];
    return next == '\\' || next == '/';
  }
  static bool Inside(string root, string candidate) {
    string[] rs = new string[] { Expand(root, true), Expand(root, false), StripNs(root).TrimEnd('\\', '/') };
    string[] cs = new string[] { Expand(candidate, true), Expand(candidate, false), StripNs(candidate).TrimEnd('\\', '/') };
    foreach (string r in rs) {
      foreach (string c in cs) {
        if (InsideOne(r, c)) return true;
      }
    }
    return false;
  }
  static bool InsideHandles(IntPtr rootH, IntPtr fileH) {
    string rootFinal = FinalPath(rootH, 0);
    string fileFinal = FinalPath(fileH, 0);
    if (Inside(rootFinal, fileFinal)) return true;
    string rootNt = FinalPath(rootH, VOLUME_NAME_NT).TrimEnd('\\', '/');
    string fileNt = FinalPath(fileH, VOLUME_NAME_NT).TrimEnd('\\', '/');
    return InsideOne(rootNt, fileNt);
  }
  static void RejectReparse(IntPtr h) {
    BY_HANDLE_FILE_INFORMATION info;
    if (!GetFileInformationByHandle(h, out info)) throw new IOException("open failed");
    if ((info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
      throw new IOException("path is outside the working directory");
  }
  static IntPtr OpenRelative(IntPtr root, string name, uint options) {
    IntPtr buf = Marshal.StringToHGlobalUni(name);
    IntPtr usPtr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(UNICODE_STRING)));
    try {
      UNICODE_STRING us = new UNICODE_STRING();
      us.Length = (ushort)(name.Length * 2);
      us.MaximumLength = us.Length;
      us.Buffer = buf;
      Marshal.StructureToPtr(us, usPtr, false);
      OBJECT_ATTRIBUTES oa = new OBJECT_ATTRIBUTES();
      oa.Length = Marshal.SizeOf(typeof(OBJECT_ATTRIBUTES));
      oa.RootDirectory = root;
      oa.ObjectName = usPtr;
      oa.Attributes = OBJ_CASE_INSENSITIVE;
      IO_STATUS_BLOCK iosb = new IO_STATUS_BLOCK();
      IntPtr h;
      int st = NtCreateFile(out h, GENERIC_READ | SYNCHRONIZE, ref oa, ref iosb, IntPtr.Zero, 0, SHARE, FILE_OPEN, options, IntPtr.Zero, 0);
      if (st < 0 || h == IntPtr.Zero || h == new IntPtr(-1)) throw new IOException("open failed");
      return h;
    } finally {
      Marshal.FreeHGlobal(usPtr);
      Marshal.FreeHGlobal(buf);
    }
  }
  static IntPtr OpenUnderRoot(IntPtr rootH, string rel) {
    if (string.IsNullOrEmpty(rel)) throw new IOException("path is outside the working directory");
    string[] segs = rel.Split(new char[] { '/', '\\' });
    IntPtr cur = rootH;
    System.Collections.Generic.List<IntPtr> extra = new System.Collections.Generic.List<IntPtr>();
    try {
      for (int i = 0; i < segs.Length; i++) {
        string seg = segs[i];
        if (string.IsNullOrEmpty(seg) || seg == "." || seg == ".." || seg.IndexOf('\0') >= 0)
          throw new IOException("path is outside the working directory");
        bool last = i == segs.Length - 1;
        uint opt = (last ? FILE_NON_DIRECTORY_FILE : FILE_DIRECTORY_FILE) | FILE_SYNCHRONOUS_IO_NONALERT | FILE_OPEN_REPARSE_POINT;
        IntPtr next = OpenRelative(cur, seg, opt);
        try { RejectReparse(next); }
        catch { CloseHandle(next); throw; }
        if (cur != rootH) extra.Add(cur);
        cur = next;
      }
      return cur;
    } catch {
      if (cur != rootH) CloseHandle(cur);
      throw;
    } finally {
      foreach (IntPtr h in extra) { try { CloseHandle(h); } catch { } }
    }
  }
  static void CopyBounded(FileStream fs, Stream stdout) {
    const long cap = 32L * 1024 * 1024;
    if (fs.CanSeek && fs.Length > cap) throw new IOException("input file exceeds 32 MiB");
    byte[] buf = new byte[65536];
    long total = 0;
    while (true) {
      int want = (int)Math.Min((long)buf.Length, cap - total + 1);
      if (want <= 0) throw new IOException("input file exceeds 32 MiB");
      int n = fs.Read(buf, 0, want);
      if (n == 0) break;
      total += n;
      if (total > cap) throw new IOException("input file exceeds 32 MiB");
      stdout.Write(buf, 0, n);
    }
  }
  static bool IsDirectoryHandle(IntPtr h) {
    if (h == IntPtr.Zero || h == new IntPtr(-1)) return false;
    if (GetFileType(h) != 1) return false;
    BY_HANDLE_FILE_INFORMATION info;
    if (!GetFileInformationByHandle(h, out info)) return false;
    return (info.dwFileAttributes & 0x10) != 0;
  }
  static IntPtr OpenRootHandle(string root, out bool own) {
    string fdStr = Environment.GetEnvironmentVariable("VDB_ROOT_FD");
    int rfd;
    if (!string.IsNullOrEmpty(fdStr) && int.TryParse(fdStr, out rfd) && rfd >= 0) {
      IntPtr h = _get_osfhandle(rfd);
      if (!IsDirectoryHandle(h)) throw new IOException("open root failed");
      own = false;
      return h;
    }
    own = true;
    return CreateFileW(root, GENERIC_READ, SHARE, IntPtr.Zero, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, IntPtr.Zero);
  }
  public static void Emit(string path, string root) {
    bool ownRoot;
    IntPtr rootH = OpenRootHandle(root, out ownRoot);
    if (rootH == new IntPtr(-1) || rootH == IntPtr.Zero) throw new IOException("open root failed");
    using (new SafeFileHandle(rootH, ownRoot)) {
      string rel = Environment.GetEnvironmentVariable("VDB_REL");
      IntPtr raw = string.IsNullOrEmpty(rel)
        ? CreateFileW(path, GENERIC_READ, SHARE, IntPtr.Zero, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, IntPtr.Zero)
        : OpenUnderRoot(rootH, rel);
      if (raw == new IntPtr(-1) || raw == IntPtr.Zero) throw new IOException("open failed");
      using (FileStream fs = new FileStream(new SafeFileHandle(raw, true), FileAccess.Read)) {
        if (GetFileType(raw) != 1) throw new IOException("input is not a regular file");
        BY_HANDLE_FILE_INFORMATION fi;
        if (!GetFileInformationByHandle(raw, out fi) || (fi.dwFileAttributes & 0x10) != 0)
          throw new IOException("input is not a regular file");
        if ((fi.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
          throw new IOException("path is outside the working directory");
        if (!InsideHandles(rootH, raw))
          throw new IOException("path is outside the working directory");
        string rootFinal = FinalPath(rootH, 0);
        string fileFinal = FinalPath(raw, 0);
        Stream stdout = Console.OpenStandardOutput();
        byte[] header = Encoding.UTF8.GetBytes("VDB\n" + Canonical(rootFinal) + "\n" + Canonical(fileFinal) + "\n");
        stdout.Write(header, 0, header.Length);
        CopyBounded(fs, stdout);
      }
    }
  }
}
'@
[VdbWin]::Emit($env:VDB_PATH, $env:VDB_ROOT)
`.trim();

function powershellBins() {
  const bins = [];
  for (const root of [process.env.SystemRoot, process.env.WINDIR].filter((root) => root && isAbsolute(root))) {
    bins.push(join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"));
  }
  for (const root of [process.env.ProgramFiles, process.env.ProgramW6432].filter((root) => root && isAbsolute(root))) {
    bins.push(join(root, "PowerShell", "7", "pwsh.exe"));
  }
  return [...new Set(bins.filter((bin) => isAbsolute(bin)))];
}

// Node has no openat. Linux uses /proc/self/fd as openat. macOS has neither
// /proc nor /dev/fd lookup, so inherit the trusted root directory fd and walk
// VDB_REL (JSON array of components). Prefer /usr/bin/perl (stock macOS,
// syscall SYS_openat) so python3 is not required. python3 remains a fallback
// — absolute paths only, including Homebrew — isolated -I so PYTHONPATH cannot
// plant a module. JSON keeps POSIX "\\" in a name as one component.
const OPENAT_SCRIPT = String.raw`
import errno, json, os, stat, sys
CAP = 32 * 1024 * 1024
CHUNK = 65536
OUTSIDE = "path is outside the working directory"
NOTFILE = "input is not a regular file"
TOOLARGE = "input file exceeds 32 MiB"

def fail(msg, code):
    sys.stderr.write(msg + "\n")
    sys.exit(code)

root_fd = 3
try:
    parts = json.loads(os.environ.get("VDB_REL", "[]"))
except Exception:
    fail(OUTSIDE, 2)
if (not isinstance(parts, list) or not parts or
    any(not isinstance(p, str) or p in ("", ".", "..") or "/" in p or "\0" in p for p in parts)):
    fail(OUTSIDE, 2)

def under_root(dir_fd, root_fd):
    want = os.fstat(root_fd)
    if want.st_ino == 0:
        return False
    cur = dir_fd
    own = False
    try:
        for _ in range(64):
            st = os.fstat(cur)
            if st.st_dev == want.st_dev and st.st_ino == want.st_ino:
                return True
            try:
                flags = os.O_RDONLY | os.O_CLOEXEC
                if hasattr(os, "O_DIRECTORY"):
                    flags |= os.O_DIRECTORY
                parent = os.open("..", flags, dir_fd=cur)
            except OSError:
                return False
            pst = os.fstat(parent)
            if pst.st_dev == st.st_dev and pst.st_ino == st.st_ino:
                os.close(parent)
                return False
            if own:
                os.close(cur)
            cur = parent
            own = True
        return False
    finally:
        if own:
            try:
                os.close(cur)
            except OSError:
                pass

dir_fd = root_fd
extra = []
file_fd = None
try:
    for part in parts[:-1]:
        flags = os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_DIRECTORY
        nfd = os.open(part, flags, dir_fd=dir_fd)
        if dir_fd != root_fd:
            extra.append(dir_fd)
        dir_fd = nfd
    flags = os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW
    if hasattr(os, "O_NONBLOCK"):
        flags |= os.O_NONBLOCK
    file_fd = os.open(parts[-1], flags, dir_fd=dir_fd)
    if not under_root(dir_fd, root_fd):
        fail(OUTSIDE, 2)
    st = os.fstat(file_fd)
    if not stat.S_ISREG(st.st_mode):
        fail(NOTFILE, 3)
    if st.st_size > CAP:
        fail(TOOLARGE, 4)
    total = 0
    while True:
        want = min(CHUNK, CAP - total + 1)
        if want <= 0:
            fail(TOOLARGE, 4)
        try:
            chunk = os.read(file_fd, want)
        except OSError as e:
            if e.errno in (errno.EAGAIN, errno.EWOULDBLOCK):
                fail(NOTFILE, 3)
            fail(OUTSIDE, 2)
        if not chunk:
            break
        total += len(chunk)
        if total > CAP:
            fail(TOOLARGE, 4)
        sys.stdout.buffer.write(chunk)
except SystemExit:
    raise
except Exception:
    fail(OUTSIDE, 2)
finally:
    if file_fd is not None:
        try:
            os.close(file_fd)
        except OSError:
            pass
    if dir_fd != root_fd:
        try:
            os.close(dir_fd)
        except OSError:
            pass
    for fd in extra:
        try:
            os.close(fd)
        except OSError:
            pass
`.trim();

// Darwin SYS_openat. Stock macOS ships /usr/bin/perl; it does not ship a
// guaranteed python3, and Homebrew python3 lives under /opt/homebrew.
const PERL_OPENAT_SCRIPT = String.raw`
use strict;
use Errno qw(EAGAIN EWOULDBLOCK);
use Fcntl qw(O_RDONLY O_NOFOLLOW);
use POSIX ();
use JSON::PP;
my $CAP = 32 * 1024 * 1024;
my $CHUNK = 65536;
my $OUTSIDE = "path is outside the working directory";
my $NOTFILE = "input is not a regular file";
my $TOOLARGE = "input file exceeds 32 MiB";
my $O_DIRECTORY = 0x100000;
my $O_CLOEXEC = 0x1000000;
my $O_NONBLOCK = 0x4;
my $SYS_openat = 463;
my $S_IFMT = 0170000;
my $S_IFREG = 0100000;
sub fail { my ($msg, $code) = @_; print STDERR $msg, "\n"; exit $code; }
my $parts = eval { JSON::PP->new->decode($ENV{VDB_REL} || "[]") };
fail($OUTSIDE, 2) unless $parts && ref($parts) eq "ARRAY" && @$parts;
for my $p (@$parts) {
  fail($OUTSIDE, 2) if !defined $p || ref($p) || $p eq "" || $p eq "." || $p eq ".." || index($p, "/") >= 0 || index($p, "\0") >= 0;
}
sub openat {
  my ($dirfd, $name, $flags) = @_;
  return syscall($SYS_openat, $dirfd + 0, $name, $flags + 0, 0);
}
sub fd_dev_ino {
  my ($fd) = @_;
  open(my $h, "<&", $fd) or return (0, 0);
  my @s = stat($h);
  close($h);
  return @s ? ($s[0] + 0, $s[1] + 0) : (0, 0);
}
sub under_root {
  my ($dir_fd, $root_fd) = @_;
  my ($want_dev, $want_ino) = fd_dev_ino($root_fd);
  return 0 if $want_ino == 0;
  my $cur = $dir_fd;
  my $own = 0;
  my $hit = 0;
  for (my $i = 0; $i < 64; $i++) {
    my ($dev, $ino) = fd_dev_ino($cur);
    if ($dev == $want_dev && $ino == $want_ino) { $hit = 1; last; }
    my $parent = openat($cur, "..", O_RDONLY | $O_CLOEXEC | $O_DIRECTORY);
    last if $parent < 0;
    my ($pdev, $pino) = fd_dev_ino($parent);
    if ($pdev == $dev && $pino == $ino) {
      POSIX::close($parent);
      last;
    }
    POSIX::close($cur) if $own;
    $cur = $parent;
    $own = 1;
  }
  POSIX::close($cur) if $own;
  return $hit;
}
my $root_fd = 3;
my $dir_fd = $root_fd;
my @extra;
my $file_fd;
my $ok = eval {
  for my $i (0 .. $#$parts - 1) {
    my $nfd = openat($dir_fd, $parts->[$i], O_RDONLY | O_NOFOLLOW | $O_DIRECTORY | $O_CLOEXEC);
    die $OUTSIDE if $nfd < 0;
    push @extra, $dir_fd if $dir_fd != $root_fd;
    $dir_fd = $nfd;
  }
  $file_fd = openat($dir_fd, $parts->[-1], O_RDONLY | O_NOFOLLOW | $O_CLOEXEC | $O_NONBLOCK);
  die $OUTSIDE if $file_fd < 0;
  die $OUTSIDE unless under_root($dir_fd, $root_fd);
  open(my $fh, "<&=", $file_fd) or die $OUTSIDE;
  my @st = stat($fh);
  die $NOTFILE unless @st && (($st[2] & $S_IFMT) == $S_IFREG);
  die $TOOLARGE if $st[7] > $CAP;
  my $total = 0;
  while (1) {
    my $want = $CHUNK;
    $want = $CAP - $total + 1 if $want > $CAP - $total + 1;
    die $TOOLARGE if $want <= 0;
    my $r = sysread($fh, my $chunk, $want);
    if (!defined $r) {
      die $NOTFILE if $!{EAGAIN} || $!{EWOULDBLOCK};
      die $OUTSIDE;
    }
    last if $r == 0;
    $total += $r;
    die $TOOLARGE if $total > $CAP;
    print $chunk;
  }
  1;
};
my $err = $ok ? "" : ($@ || $OUTSIDE);
if (defined $file_fd) { eval { POSIX::close($file_fd) }; }
if ($dir_fd != $root_fd) { eval { POSIX::close($dir_fd) }; }
for my $fd (@extra) { eval { POSIX::close($fd) }; }
if ($err) {
  fail($NOTFILE, 3) if $err =~ /not a regular file/;
  fail($TOOLARGE, 4) if $err =~ /exceeds/;
  fail($OUTSIDE, 2);
}
`.trim();

function perlBins() {
  return ["/usr/bin/perl", "/usr/local/bin/perl"].filter((bin) => isAbsolute(bin) && existsSync(bin));
}

function pythonBins() {
  return [
    "/usr/bin/python3",
    "/usr/local/bin/python3",
    "/opt/homebrew/bin/python3",
    "/opt/homebrew/opt/python3/bin/python3",
    "/opt/local/bin/python3",
    "/Library/Frameworks/Python.framework/Versions/Current/bin/python3",
  ].filter((bin) => isAbsolute(bin) && existsSync(bin));
}

function helperUnavailableError() {
  return new Error("path open helper unavailable (need /usr/bin/perl or python3 with os.open dir_fd)");
}

function readValidatedFdOpenat(filePath, root, rootFd) {
  if (relative(resolve(root), resolve(filePath)) === "") throw notRegularFileError();
  const parts = containedRelParts(root, filePath);
  if (typeof rootFd !== "number" || rootFd < 0) {
    throw new Error("path is outside the working directory");
  }
  const env = {
    ...process.env,
    VDB_REL: JSON.stringify(parts),
    PYTHONPATH: "",
    PYTHONHOME: "",
    PYTHONNOUSERSITE: "1",
    PERL5LIB: "",
    PERLLIB: "",
    PERL_USE_UNSAFE_INC: "0",
  };
  const opts = {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: MAX_VALIDATOR_BYTES + 64 * 1024,
    env,
    stdio: ["ignore", "pipe", "pipe", rootFd],
  };
  const runs = [];
  if (process.platform === "darwin") {
    for (const bin of perlBins()) runs.push({ bin, args: ["-e", PERL_OPENAT_SCRIPT] });
  }
  for (const bin of pythonBins()) runs.push({ bin, args: ["-I", "-c", OPENAT_SCRIPT] });
  if (runs.length === 0) throw helperUnavailableError();
  let helperRan = false;
  for (const run of runs) {
    try {
      return execFileSync(run.bin, run.args, opts);
    } catch (e) {
      if (e && e.code === "ENOENT") continue;
      helperRan = true;
      const detail = `${e && e.message ? e.message : ""} ${e && e.stderr ? e.stderr : ""}`;
      if (/not a regular file/i.test(detail)) throw notRegularFileError();
      if (isStdioMaxBuffer(e) || /exceeds \d+ MiB/i.test(detail)) throw tooLargeError();
    }
  }
  if (!helperRan) throw helperUnavailableError();
  throw new Error("path is outside the working directory");
}

function runWinHandleHelper(filePath, root, rootFd, rel) {
  const encoded = Buffer.from(WIN_HANDLE_SCRIPT, "utf16le").toString("base64");
  const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded];
  const baseEnv = { ...process.env, VDB_PATH: filePath, VDB_ROOT: root, VDB_REL: rel || "" };
  const attempts = [];
  if (typeof rootFd === "number" && rootFd >= 0) {
    // Keep the trusted root handle. A pathname retry of VDB_ROOT after this
    // fails would open a renamed-and-replaced working directory.
    attempts.push({ env: { ...baseEnv, VDB_ROOT_FD: "3" }, stdio: ["ignore", "pipe", "pipe", rootFd] });
  } else {
    attempts.push({ env: baseEnv, stdio: ["ignore", "pipe", "pipe"] });
  }
  const opts = {
    encoding: "utf8",
    timeout: 30000,
    windowsHide: true,
    maxBuffer: MAX_VALIDATOR_BYTES + 64 * 1024,
  };
  let out = "";
  let ok = false;
  for (const shell of powershellBins()) {
    for (const attempt of attempts) {
      try {
        out = execFileSync(shell, args, { ...opts, ...attempt });
        if (String(out).indexOf("VDB\n") >= 0) {
          ok = true;
          break;
        }
      } catch (e) {
        const detail = `${e && e.message ? e.message : ""} ${e && e.stderr ? e.stderr : ""}`;
        if (/not a regular file/i.test(detail)) throw notRegularFileError();
        if (isStdioMaxBuffer(e) || /exceeds \d+ MiB/i.test(detail)) throw tooLargeError();
      }
    }
    if (ok) break;
  }
  if (!ok) throw new Error("path is outside the working directory");
  const marker = "VDB\n";
  const start = out.indexOf(marker);
  if (start < 0) throw new Error("path is outside the working directory");
  const rest = out.slice(start + marker.length);
  const nl1 = rest.indexOf("\n");
  if (nl1 < 1) throw new Error("path is outside the working directory");
  const openedRoot = stripWinNamespace(rest.slice(0, nl1).replace(/\r$/, ""));
  const rest2 = rest.slice(nl1 + 1);
  const nl2 = rest2.indexOf("\n");
  if (nl2 < 1) throw new Error("path is outside the working directory");
  const openedPath = stripWinNamespace(rest2.slice(0, nl2).replace(/\r$/, ""));
  if (!isInsideRoot(openedRoot, openedPath)) {
    throw new Error("path is outside the working directory");
  }
  return rest2.slice(nl2 + 1);
}

function readValidatedFdWin32(filePath, root, rootFd) {
  try { filePath = realpathSync(filePath); } catch { /* keep */ }
  try { root = realpathSync(root); } catch { /* keep */ }
  if (relative(resolve(root), resolve(filePath)) === "") throw notRegularFileError();
  let rel = "";
  try {
    rel = containedRelParts(root, filePath).join(sep);
  } catch {
    /* 8.3 vs long: relative() looks like an escape. Open VDB_PATH and contain by handle paths. */
  }
  return runWinHandleHelper(filePath, root, rootFd, rel);
}

// Hold the trusted root as a directory fd/handle first, then open the input
// relative to that identity so a renamed-and-replaced working directory cannot
// supply bytes that only match the old pathname.
function readValidatedFd(filePath, root, rootFd = null) {
  filePath = resolve(filePath);
  if (!filePath.startsWith(root)) {
    if (process.platform !== "win32" || !isInsideRoot(root, filePath)) {
      throw new Error("path is outside the working directory");
    }
  }
  const rel = relative(root, filePath);
  if (rel.startsWith(".." + sep) || rel === "..") {
    if (process.platform !== "win32" || !isInsideRoot(root, filePath)) {
      throw new Error("path is outside the working directory");
    }
  }
  // Exercised by validate-windows in .github/workflows/validate.yml: packaged
  // --selftest on windows-latest, including in-root read and junction escape.
  let owned = false;
  if (rootFd == null) {
    rootFd = openRootDir(root);
    owned = true;
  }
  try {
    if (process.platform === "win32") {
      return readValidatedFdWin32(filePath, root, rootFd);
    }
    if (relative(resolve(root), resolve(filePath)) === "") throw notRegularFileError();
    // Linux: /proc/self/fd/<fd>/<name> is openat. Elsewhere (macOS), do not reopen a
    // pathname from the dir fd — that races with rename+symlink of a parent.
    // Exercised by validate-macos in .github/workflows/validate.yml.
    if (!dirFdAnchor(rootFd)) {
      return readValidatedFdOpenat(filePath, root, rootFd);
    }
    const parts = containedRelParts(root, filePath);
    let flags = constants.O_RDONLY;
    if (constants.O_NONBLOCK) flags |= constants.O_NONBLOCK;
    const fd = openFileUnderRootFd(rootFd, parts, flags);
    try {
      if (!fstatSync(fd).isFile()) throw notRegularFileError();
      return readFdBounded(fd);
    } finally {
      closeSync(fd);
    }
  } finally {
    if (owned) closeSync(rootFd);
  }
}

export function validateFile(filePath, opts = {}) {
  const cwd = resolve(process.cwd());
  // Open "." so the fd is this process's cwd inode, not a pathname that can
  // be replaced between process.cwd() and open.
  const rootFd = openRootDir(".");
  try {
    containedFilePath(filePath);
    const { root: ROOT, resolved } = resolveUnderRoot(filePath, cwd);
    const raw = readValidatedFd(resolved, ROOT, rootFd);
    let json = raw, blockId = null;
    if (/^\s*</.test(raw) || /<script/i.test(raw)) {
      const found = extractDataBlock(raw, opts.blockId);
      if (!found) {
        return { ok: false, skill: null, warnings: [], errors: [{ rule: "R-PARSE", path: filePath, message: `no <script id="pulse-data"> or <script id="studio-data"> block found. Point the validator at the assembled JSON, or at the filled HTML after the block has been replaced.` }] };
      }
      json = found.json; blockId = found.id;
    }
    let data;
    try {
      data = JSON.parse(json);
    } catch (e) {
      return { ok: false, skill: null, warnings: [], errors: [{ rule: "R-PARSE", path: blockId ? `<script id="${blockId}">` : filePath, message: `the data block is not valid JSON (${e.message}). The contract is pure JSON — no {{TOKENS}} inside it, no trailing commas, no comments.` }] };
    }
    return validateDataBlock(data, opts);
  } finally {
    closeSync(rootFd);
  }
}

/* ==========================================================================
   Self-test — one known-good and one known-bad case per rule.
   ========================================================================== */
function goodPulse() {
  return {
    brand: "Segment 1",
    product: "Customer Pulse",
    account: "Test Account",
    siteId: "example-site-0001",
    asOf: "as of 4 Aug 2026",
    zmpUrl: "https://app.zetaglobal.net/opportunities/customer_pulse",
    segments: [{ name: "Segment 1" }, { name: "Segment 2" }],
    headline: "Streaming and social discovery run hot while email lags. Lead with Social + Streaming creative and treat email as retention-only.",
    kpis: [
      { value: "+240%", label: "Streaming-TV consumption", note: "vs network baseline; strong over-index" },
      { value: "+116%", label: "Pinterest activity", note: "vs baseline; top social platform" },
      { value: "-38%", label: "Email responsiveness", note: "vs baseline; under-indexes" },
    ],
    activityChannel: [
      { label: "Programmatic - Mobile", values: [24, 22] },
      { label: "Permissioned Email", values: [17, 19] },
      { label: "Social", values: [13, 15] },
    ],
    activitySocial: [
      { label: "Pinterest", values: [16, 12] },
      { label: "YouTube", values: [11, 9] },
      { label: "Instagram", values: [-4, 3] },
    ],
    characteristics: [
      {
        name: "Transactions", caption: "Merchant over-index vs baseline.", default: false, scale: "baseline-delta",
        rows: [
          { label: "Merchant A", values: [180, 96] },
          { label: "Merchant B", values: [120, 97] },
          { label: "Merchant C", values: [86, null] },
        ],
      },
    ],
    actions: [
      { title: "Lead with Social + Streaming", body: "Shift discovery budget to the platforms this audience over-indexes on." },
      { title: "Deprioritize email nurture", body: "Email under-indexes; treat as retention-only, not acquisition." },
      { title: "Test outdoor/gaming creative", body: "Lifestyle skews suggest lifestyle-led messaging." },
    ],
    provenance: "Two segments; customer_pulse_preferred_channel, _social_media_platform, _demographics, _psychographics, _content_consumption, _transactions; page one only.",
  };
}

function goodStudio() {
  return {
    title: "Customer Marketing performance",
    dataset: "Customer Marketing (crm)",
    account: "Test Account",
    asOf: "as of 4 Aug 2026",
    current: { start: "2026-07-01", end: "2026-07-31", label: "July 2026" },
    comparison: { start: "2026-06-01", end: "2026-06-30", label: "June 2026" },
    zmpUrl: "https://app.zetaglobal.net/reports/insights-studio",
    summary: "Sending was cut by more than half month over month while engagement held.",
    kpis: [
      { label: "Sent", unit: "count", current: 3000, prior: 6500, note: "Messages attempted" },
      { label: "Open rate", unit: "rate", current: 0.1, prior: 0.09, note: "Unique opens over delivered" },
      { label: "Click rate", unit: "rate", current: 0.03, prior: 0.02, note: "Unique clicks over delivered" },
    ],
    series: {
      name: "Open rate", unit: "rate",
      points: [
        { t: "2026-07-01", v: 0.15 }, { t: "2026-07-02", v: 0.07 },
        { t: "2026-07-03", v: 0.125 }, { t: "2026-07-04", v: null },
        { t: "2026-07-05", v: 0.1 }, { t: "2026-07-06", v: 0 },
      ],
    },
    breakdown: {
      title: "Sent by channel", dimension: "Channel", metric: "Sent", metricUnit: "count",
      columns: [
        { key: "delivered", label: "Delivered", unit: "count" },
        { key: "open_rate", label: "Open rate", unit: "rate" },
      ],
      rows: [
        { label: "email", value: 2950, cells: { delivered: 2950, open_rate: 0.1 } },
        { label: "webhook", value: 50, cells: { delivered: 50, open_rate: 0 } },
      ],
    },
    notes: ["Rates are reported as fractions of delivered and shown as percentages."],
    provenance: "crm, July vs June 2026; get_datasets, get_dataset_schema, fetch_metrics_data x4.",
  };
}

const CASES = [
  // ---- known good
  { name: "good Customer Pulse block", rule: null, verdict: "pass", data: goodPulse },
  { name: "good Insights Studio block", rule: null, verdict: "pass", data: goodStudio },
  {
    name: "good Customer Pulse block with a dropped-characteristic notice",
    rule: null, verdict: "pass",
    data: () => {
      const d = goodPulse();
      d.sourceLimit = "Psychographics returned no rows for this segment and is omitted.";
      return d;
    },
  },
  {
    name: "R-SOURCE: raw record count in provenance is rejected",
    rule: "R-SOURCE", verdict: "error",
    data: () => { const d = goodPulse(); d.provenance = "Activity and characteristics from 5,244,663 records / 2,000,165 people; page one only."; return d; },
  },
  {
    name: "R-DUPLICATE: repeated continuation row is rejected",
    rule: "R-DUPLICATE", verdict: "error",
    data: () => { const d = goodPulse(); d.activityChannel.push({ ...d.activityChannel[0] }); return d; },
  },
  {
    name: "good field manifest (network_baseline_difference on a characteristic block)",
    rule: null, verdict: "pass", data: goodPulse,
    source: { "characteristics[0].rows[].values": { block: "customer_pulse_acquisition_transactional_interest_0", valueField: "network_baseline_difference", labelField: "Title" } },
  },

  // ---- R-FIELD: a declared field that does not exist in the source
  {
    name: "R-FIELD: index_value on a block that does not return it",
    rule: "R-FIELD", verdict: "error", data: goodPulse,
    source: { "characteristics[0].rows[].values": { block: "customer_pulse_acquisition_transactional_interest_0", valueField: "index_value" } },
  },
  {
    name: "R-FIELD: Label on an interest block whose label column is Title",
    rule: "R-FIELD", verdict: "error", data: goodPulse,
    source: { "characteristics[0].rows[].label": { block: "customer_pulse_acquisition_behavioral_interest_0", valueField: "network_baseline_difference", labelField: "Label" } },
  },

  // ---- R-UNKNOWN: strictness
  {
    name: "R-UNKNOWN: baseline on a chart with no baseline concept",
    rule: "R-UNKNOWN", verdict: "error",
    data: () => { const d = goodPulse(); d.characteristics[0].baseline = 1.0; return d; },
  },
  {
    name: "R-UNKNOWN: hardcoded arrow direction on a KPI",
    rule: "R-UNKNOWN", verdict: "error",
    data: () => { const d = goodStudio(); d.kpis[0].dir = "up"; return d; },
  },
  {
    name: "R-UNKNOWN: cell key not declared in breakdown.columns",
    rule: "R-UNKNOWN", verdict: "error",
    data: () => { const d = goodStudio(); d.breakdown.rows[0].cells.clicks = 80; return d; },
  },

  // ---- R-LENGTH: comparison alignment
  {
    name: "R-LENGTH: values[] shorter than segments[]",
    rule: "R-LENGTH", verdict: "error",
    data: () => { const d = goodPulse(); d.activityChannel[1].values = [17]; return d; },
  },
  {
    name: "R-SCALE: ranked strength cannot be negative",
    rule: "R-SCALE", verdict: "error",
    data: () => { const d = goodPulse(); d.characteristics[0].scale = "ranked-strength"; d.characteristics[0].rows[0].values[0] = -4; return d; },
  },
  {
    name: "R-SCALE: baseline delta must not masquerade as ranked scores",
    rule: "R-SCALE", verdict: "error",
    data: () => { const d = goodPulse(); d.characteristics[0].rows = [{ label: "A", values: [94, 79] }, { label: "B", values: [76, 71] }]; return d; },
  },
  {
    name: "R-LENGTH: breakdown row missing a declared column",
    rule: "R-LENGTH", verdict: "error",
    data: () => { const d = goodStudio(); delete d.breakdown.rows[1].cells.open_rate; return d; },
  },

  // ---- R-SCALE: a fraction rendered with unit '%'
  {
    name: "R-SCALE: rate values already scaled to percent",
    rule: "R-SCALE", verdict: "error",
    data: () => { const d = goodStudio(); d.kpis[1].current = 45.8; d.kpis[1].prior = 43.1; return d; },
  },
  {
    name: "R-SCALE: unit percent carrying fractions",
    rule: "R-SCALE", verdict: "error",
    data: () => {
      const d = goodStudio();
      d.breakdown.columns[1].unit = "percent";
      d.breakdown.rows[0].cells.open_rate = 0.098527;
      d.breakdown.rows[1].cells.open_rate = 0.4;
      return d;
    },
  },
  {
    name: "R-SCALE: pulse percentages left as fractions",
    rule: "R-SCALE", verdict: "error",
    data: () => { const d = goodPulse(); d.activityChannel = [{ label: "Programmatic - Mobile", values: [0.24, 0.22] }, { label: "Social", values: [0.13, 0.15] }]; return d; },
  },

  // ---- R-NONFINITE: zero-baseline delta
  {
    name: "R-NONFINITE: NaN reached the block",
    rule: "R-NONFINITE", verdict: "error",
    data: () => { const d = goodStudio(); d.kpis[0].current = NaN; return d; },
  },
  {
    name: "R-NONFINITE: stringified Infinity in a KPI value",
    rule: "R-NONFINITE", verdict: "error",
    data: () => { const d = goodPulse(); d.kpis[0].value = "Infinity%"; return d; },
  },
  {
    name: "R-KPI-EMPTY: Insights Studio missing current value",
    rule: "R-KPI-EMPTY", verdict: "error",
    data: () => { const d = goodStudio(); d.kpis[0].current = null; return d; },
  },
  {
    name: "R-ZERO-BASELINE: zero prior is a warning, not an error",
    rule: "R-ZERO-BASELINE", verdict: "warning",
    data: () => { const d = goodStudio(); d.kpis[0].current = 0; d.kpis[0].prior = 0; return d; },
  },
  {
    name: "R-KPI-EMPTY: Insights Studio cannot render an empty briefing",
    rule: "R-KPI-EMPTY", verdict: "error",
    data: () => { const d = goodStudio(); d.kpis = []; return d; },
  },

  // ---- flat tier / identical bars (warnings)
  {
    name: "R-FLAT-TIER: every characteristic row on the same value",
    rule: "R-FLAT-TIER", verdict: "warning",
    data: () => { const d = goodPulse(); d.characteristics[0].rows = d.characteristics[0].rows.map((r) => ({ label: r.label, values: [97, 97] })); return d; },
  },
  {
    name: "R-ALL-ZERO: every breakdown bar is zero",
    rule: "R-ALL-ZERO", verdict: "warning",
    data: () => { const d = goodStudio(); d.breakdown.rows.forEach((r) => { r.value = 0; }); return d; },
  },

  // ---- R-PLACEHOLDER
  {
    name: "R-PLACEHOLDER: unreplaced token survived",
    rule: "R-PLACEHOLDER", verdict: "error",
    data: () => { const d = goodPulse(); d.headline = "{{HEADLINE}}"; return d; },
  },
  {
    name: "R-PLACEHOLDER: token nested in an array",
    rule: "R-PLACEHOLDER", verdict: "error",
    data: () => { const d = goodPulse(); d.actions[2].body = "{{ACTION_BODY}}"; return d; },
  },

  // ---- R-DOMAIN: declared scale vs observed range
  {
    // Coverage was removed from the contract on 5 Aug 2026. This case guards the removal:
    // a template or skill that still emits it must fail, not be silently ignored.
    name: "R-UNKNOWN: a stale segments[].coverage key is rejected",
    rule: "R-UNKNOWN", verdict: "error",
    data: () => { const d = goodPulse(); d.segments[0].coverage = 100; return d; },
  },
  {
    name: "R-DOMAIN: an activity share above 100",
    rule: "R-DOMAIN", verdict: "error",
    data: () => { const d = goodPulse(); d.activityChannel[0].values = [342, 22]; return d; },
  },
  {
    name: "R-DOMAIN: a trend line with one plottable point",
    rule: "R-DOMAIN", verdict: "error",
    data: () => { const d = goodStudio(); d.series.points = d.series.points.map((p, i) => ({ t: p.t, v: i === 0 ? 0.1 : null })); return d; },
  },

  // ---- ordering, types, required keys
  {
    name: "R-TYPE: a number arrived as a quoted string",
    rule: "R-TYPE", verdict: "error",
    data: () => { const d = goodPulse(); d.activityChannel[0].values[0] = "24"; return d; },
  },
  {
    name: "R-TYPE: unit outside the allowed set",
    rule: "R-TYPE", verdict: "error",
    data: () => { const d = goodStudio(); d.kpis[1].unit = "%"; return d; },
  },
  {
    name: "R-REQUIRED: provenance dropped",
    rule: "R-REQUIRED", verdict: "error",
    data: () => { const d = goodStudio(); delete d.provenance; return d; },
  },
  {
    name: "R-DUPLICATE: same dimension value on two breakdown rows",
    rule: "R-DUPLICATE", verdict: "error",
    data: () => { const d = goodStudio(); d.breakdown.rows[1].label = "email"; return d; },
  },
  {
    name: "R-SKILL: unrecognizable block",
    rule: "R-SKILL", verdict: "error",
    data: () => ({ hello: "world" }),
  },
  // --source is mandatory, and a manifest that declares nothing must not satisfy it.
  {
    name: "R-FIELD: no --source manifest at all is an error",
    rule: "R-FIELD", verdict: "error",
    noSource: true,
    data: () => goodPulse(),
  },
  {
    name: "R-FIELD: an empty manifest does not satisfy the requirement",
    rule: "R-FIELD", verdict: "error",
    source: {},
    data: () => goodPulse(),
  },
  {
    name: "R-FIELD: a manifest covering only some characteristics is an error",
    rule: "R-FIELD", verdict: "error",
    source: { "characteristics[0].rows[].values": { block: "customer_pulse_acquisition_transactional_interest_0", valueField: "network_baseline_difference" } },
    data: () => {
      const d = goodPulse();
      d.characteristics.push({ name: "Visitation", caption: "c", default: false, rows: [{ label: "Grocery", values: [93, 91] }] });
      return d;
    },
  },
];

/* --source is required, so every case that is not specifically testing provenance needs a
   manifest. This supplies a correct one for whichever skill the fixture is, keyed off the
   same shape hints validateDataBlock detects on. Cases that set `source` themselves — or set
   `noSource` to assert the requirement — are left alone. */
function defaultSource(data) {
  if (Array.isArray(data.characteristics)) {
    const m = {};
    data.characteristics.forEach((_, i) => {
      m[`characteristics[${i}].rows[].values`] = {
        block: "customer_pulse_acquisition_transactional_interest_0",
        valueField: "network_baseline_difference", labelField: "Title",
      };
    });
    return m;
  }
  if (data.series && Array.isArray(data.series.points)) {
    return { "series.points[].v": { block: "fetch_metrics_data:engagement_date", valueField: "open_rate",
                                    columns: ["engagement_date", "sent", "open_rate", "click_rate"] } };
  }
  return {};
}

function selftest() {
  let failed = 0;
  for (const c of CASES) {
    const data = c.data();
    const source = c.noSource ? undefined : (c.source || defaultSource(data));
    const r = validateDataBlock(data, { source });
    // pass    -> no errors at all
    // error   -> blocked, and the expected rule is among the errors
    // warning -> NOT blocked, and the expected rule is among the warnings
    let ok;
    if (c.verdict === "pass") ok = r.ok;
    else if (c.verdict === "error") ok = !r.ok && r.errors.some((f) => f.rule === c.rule);
    else ok = r.ok && r.warnings.some((f) => f.rule === c.rule);

    if (!ok) {
      failed++;
      console.error(`  FAIL  ${c.name}`);
      console.error(`        expected ${c.verdict}${c.rule ? ` [${c.rule}]` : ""}, got ${r.errors.length} error(s), ${r.warnings.length} warning(s)`);
      for (const e of r.errors) console.error(`        error   [${e.rule}] ${e.path}`);
      for (const w of r.warnings) console.error(`        warning [${w.rule}] ${w.path}`);
    } else {
      console.log(`  ok    ${c.name}`);
    }
  }
  const pathCases = [
    { name: "path: reject parent traversal", path: "..", reject: true },
    { name: "path: reject nested traversal", path: "foo/../../../../../../../../etc/passwd", reject: true },
    { name: "path: reject absolute escape", path: "/etc/passwd", reject: true },
    { name: "path: reject encoded traversal", path: "%2e%2e/%2e%2e/etc/passwd", reject: true },
    { name: "path: reject null byte", path: "foo\0.json", reject: true },
    { name: "path: allow working directory", path: ".", reject: false },
  ];
  const insideCases = [
    { name: "path: reject prefix sibling", root: "/tmp/root", candidate: "/tmp/root-evil/secret.json", inside: false },
    { name: "path: allow nested file", root: "/tmp/root", candidate: "/tmp/root/file.json", inside: true },
    { name: "path: allow root itself", root: "/tmp/root", candidate: "/tmp/root", inside: true },
  ];
  const encodedCases = [
    { name: "path: allow percent in filename", path: "report%2Ejson", encoded: false },
    { name: "path: reject encoded parent segment", path: "%2e%2e/%2e%2e/etc/passwd", encoded: true },
    { name: "path: reject mixed encoded parent", path: ".%2e", encoded: true },
    { name: "path: reject encoded parent after slash", path: "foo%2f%2e%2e", encoded: true },
  ];
  const winNsCases = [
    { name: "path: strip \\\\?\\ prefix", input: "\\\\?\\C:\\repo\\a.json", want: "C:\\repo\\a.json" },
    { name: "path: strip \\\\?\\UNC\\ prefix", input: "\\\\?\\UNC\\server\\share\\a.json", want: "\\\\server\\share\\a.json" },
    { name: "path: strip \\??\\ prefix", input: "\\??\\C:\\repo\\a.json", want: "C:\\repo\\a.json" },
  ];
  for (const c of insideCases) {
    const got = isInsideRoot(c.root, c.candidate);
    if (got !== c.inside) {
      failed++;
      console.error(`  FAIL  ${c.name}`);
      console.error(`        expected ${c.inside ? "inside" : "outside"}, got ${got ? "inside" : "outside"}`);
    } else {
      console.log(`  ok    ${c.name}`);
    }
  }
  for (const c of encodedCases) {
    const got = hasEncodedParentSegment(c.path);
    if (got !== c.encoded) {
      failed++;
      console.error(`  FAIL  ${c.name}`);
      console.error(`        expected ${c.encoded ? "encoded parent" : "ok"}, got ${got ? "encoded parent" : "ok"}`);
    } else {
      console.log(`  ok    ${c.name}`);
    }
  }
  for (const c of winNsCases) {
    const got = stripWinNamespace(c.input);
    if (got !== c.want) {
      failed++;
      console.error(`  FAIL  ${c.name}`);
      console.error(`        expected ${c.want}, got ${got}`);
    } else {
      console.log(`  ok    ${c.name}`);
    }
  }
  for (const c of pathCases) {
    let threw = false;
    try {
      containedFilePath(c.path);
    } catch {
      threw = true;
    }
    if (threw !== c.reject) {
      failed++;
      console.error(`  FAIL  ${c.name}`);
      console.error(`        expected ${c.reject ? "reject" : "allow"}, got ${threw ? "reject" : "allow"}`);
    } else {
      console.log(`  ok    ${c.name}`);
    }
  }
  {
    const self = fileURLToPath(import.meta.url);
    let ok = true;
    try {
      const canonical = containedFilePath(basename(self), dirname(self));
      if (canonical !== realpathSync(self)) ok = false;
      const raw = readValidatedFd(canonical, realpathSync(dirname(self)));
      if (!raw.includes("containedFilePath")) ok = false;
    } catch {
      ok = false;
    }
    if (!ok) {
      failed++;
      console.error("  FAIL  path: resolve relative to rootDir");
    } else {
      console.log("  ok    path: resolve relative to rootDir");
    }
  }
  {
    const base = mkdtempSync(join(realpathSync(tmpdir()), "vdb-"));
    let inRootOk = false;
    let escapeOk = false;
    try {
      const root = join(base, "root");
      const outside = join(base, "outside");
      mkdirSync(root);
      mkdirSync(outside);
      writeFileSync(join(outside, "secret.json"), "{}\n");
      writeFileSync(join(root, "inside.json"), "{\"ok\":true}\n");
      symlinkSync(outside, join(root, "link"), process.platform === "win32" ? "junction" : "dir");
      const rootReal = realpathSync(root);
      try {
        const insidePath = realpathSync(join(root, "inside.json"));
        const containRoot = realpathSync(dirname(insidePath));
        const inside = readValidatedFd(insidePath, containRoot);
        inRootOk = inside.includes("\"ok\"") && isInsideRoot(containRoot, insidePath);
      } catch (e) {
        inRootOk = false;
        console.error(`        in-root read: ${e && e.message ? e.message : e}`);
      }
      let containedRejected = false;
      let fdRejected = false;
      try {
        containedFilePath(join("link", "secret.json"), root);
      } catch {
        containedRejected = true;
      }
      try {
        readValidatedFd(join(rootReal, "link", "secret.json"), rootReal);
      } catch {
        fdRejected = true;
      }
      escapeOk = containedRejected && fdRejected;
    } catch {
      /* setup failed; leave both flags false */
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
    if (!inRootOk) {
      failed++;
      console.error("  FAIL  path: in-root read");
    } else {
      console.log("  ok    path: in-root read");
    }
    if (!escapeOk) {
      failed++;
      console.error("  FAIL  path: reject symlink escape");
    } else {
      console.log("  ok    path: reject symlink escape");
    }
  }
  {
    const base = mkdtempSync(join(realpathSync(tmpdir()), "vdb-"));
    let dirOk = false;
    let fifoOk = process.platform === "win32";
    try {
      const rootReal = realpathSync(base);
      try {
        readValidatedFd(rootReal, rootReal);
      } catch (e) {
        dirOk = /not a regular file/i.test(String(e && e.message));
      }
      if (process.platform !== "win32") {
        const fifo = join(base, "pipe");
        let made = false;
        for (const bin of ["/usr/bin/mkfifo", "/bin/mkfifo"]) {
          try {
            execFileSync(bin, [fifo], { timeout: 2000, stdio: "ignore" });
            made = true;
            break;
          } catch { /* try next */ }
        }
        if (made) {
          try {
            readValidatedFd(fifo, rootReal);
          } catch (e) {
            fifoOk = /not a regular file/i.test(String(e && e.message));
          }
        }
      }
    } catch {
      /* setup failed */
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
    if (!dirOk) {
      failed++;
      console.error("  FAIL  path: reject directory");
    } else {
      console.log("  ok    path: reject directory");
    }
    if (!fifoOk) {
      failed++;
      console.error("  FAIL  path: reject fifo");
    } else {
      console.log("  ok    path: reject fifo");
    }
  }
  {
    const base = mkdtempSync(join(realpathSync(tmpdir()), "vdb-"));
    let replaceOk = false;
    try {
      const root = join(base, "root");
      const evil = join(base, "evil");
      const moved = join(base, "orig-moved");
      mkdirSync(root);
      mkdirSync(evil);
      writeFileSync(join(root, "inside.json"), "{\"src\":\"orig\"}\n");
      writeFileSync(join(evil, "inside.json"), "{\"src\":\"evil\"}\n");
      const rootFd = openRootDir(root);
      try {
        try {
          renameSync(root, moved);
          renameSync(evil, root);
        } catch (e) {
          if (process.platform === "win32") {
            console.log("  skip  path: reject root replacement");
            replaceOk = null;
          } else {
            throw e;
          }
        }
        if (replaceOk !== null) {
          let data = "";
          let threw = false;
          try {
            data = String(readValidatedFd(join(root, "inside.json"), root, rootFd));
          } catch {
            threw = true;
          }
          replaceOk = (threw || data.includes("orig")) && !data.includes("evil");
        }
      } finally {
        closeSync(rootFd);
      }
    } catch (e) {
      replaceOk = false;
      console.error(`        root replacement: ${e && e.message ? e.message : e}`);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
    if (replaceOk === null) {
      /* skipped: Windows would not rename a directory this process still has open */
    } else if (!replaceOk) {
      failed++;
      console.error("  FAIL  path: reject root replacement");
    } else {
      console.log("  ok    path: reject root replacement");
    }
  }
  {
    const base = mkdtempSync(join(realpathSync(tmpdir()), "vdb-"));
    let nestedOk = false;
    try {
      const root = join(base, "root");
      mkdirSync(join(root, "sub"), { recursive: true });
      writeFileSync(join(root, "sub", "input.json"), "{\"nested\":true}\n");
      const rootReal = realpathSync(root);
      const nested = readValidatedFd(join(rootReal, "sub", "input.json"), rootReal);
      nestedOk = nested.includes("nested");
    } catch (e) {
      nestedOk = false;
      console.error(`        nested file: ${e && e.message ? e.message : e}`);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
    if (!nestedOk) {
      failed++;
      console.error("  FAIL  path: nested file");
    } else {
      console.log("  ok    path: nested file");
    }
  }
  {
    const base = mkdtempSync(join(realpathSync(tmpdir()), "vdb-"));
    let swapOk = false;
    try {
      const root = join(base, "root");
      const outside = join(base, "outside");
      const gate = join(root, "gate");
      mkdirSync(gate, { recursive: true });
      mkdirSync(outside);
      writeFileSync(join(gate, "file.json"), "{\"src\":\"orig\"}\n");
      writeFileSync(join(outside, "file.json"), "{\"src\":\"evil\"}\n");
      const rootReal = realpathSync(root);
      const canonical = realpathSync(join(gate, "file.json"));
      const rel = containedRelParts(rootReal, canonical).join(sep);
      const rootFd = openRootDir(rootReal);
      try {
        renameSync(gate, join(base, "gate-moved"));
        symlinkSync(outside, gate, process.platform === "win32" ? "junction" : "dir");
        const swapped = realpathSync(join(gate, "file.json")) === realpathSync(join(outside, "file.json"));
        let data = "";
        let threw = false;
        try {
          data = process.platform === "win32"
            ? String(runWinHandleHelper(canonical, rootReal, rootFd, rel))
            : String(readValidatedFd(canonical, rootReal, rootFd));
        } catch {
          threw = true;
        }
        swapOk = swapped && threw && !data.includes("evil");
      } finally {
        closeSync(rootFd);
      }
    } catch (e) {
      swapOk = false;
      console.error(`        swap after canonicalize: ${e && e.message ? e.message : e}`);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
    if (!swapOk) {
      failed++;
      console.error("  FAIL  path: reject swap after canonicalize");
    } else {
      console.log("  ok    path: reject swap after canonicalize");
    }
  }
  {
    const base = mkdtempSync(join(realpathSync(tmpdir()), "vdb-"));
    let slashNameOk = process.platform === "win32";
    try {
      if (process.platform !== "win32") {
        const root = join(base, "root");
        mkdirSync(join(root, "a"), { recursive: true });
        writeFileSync(join(root, "a", "b.json"), "{\"via\":\"nested-dir\"}\n");
        const backslashName = "a\\b.json";
        writeFileSync(join(root, backslashName), "{\"via\":\"literal-backslash\"}\n");
        const rootReal = realpathSync(root);
        const target = join(rootReal, backslashName);
        const parts = containedRelParts(rootReal, target);
        const got = readValidatedFd(target, rootReal);
        slashNameOk = parts.length === 1 && parts[0] === backslashName
          && got.includes("literal-backslash") && !got.includes("nested-dir");
      }
    } catch (e) {
      slashNameOk = false;
      console.error(`        backslash filename: ${e && e.message ? e.message : e}`);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
    if (!slashNameOk) {
      failed++;
      console.error("  FAIL  path: backslash filename");
    } else {
      console.log("  ok    path: backslash filename");
    }
  }

  const total = CASES.length + pathCases.length + insideCases.length + encodedCases.length + winNsCases.length + 9;
  if (failed) {
    console.error(`\nselftest FAILED: ${failed} of ${total} cases`);
    process.exit(1);
  }
  console.log(`\nselftest OK: ${total} cases (${new Set(CASES.map((c) => c.rule).filter(Boolean)).size} rules exercised)`);
}

/* ==========================================================================
   CLI
   ========================================================================== */
function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--selftest")) return selftest();
  if (!args.length || args.includes("--help") || args.includes("-h")) {
    console.log(`usage: node scripts/validate-data-block.mjs <file.json|filled.html> [options]
       node scripts/validate-data-block.mjs --selftest

Validates an assembled artifact data block before the HTML is written. Exits 1 on any
error; warnings print and exit 0.

  --skill <id>       one of ${Object.keys(SCHEMAS).join(", ")} (otherwise inferred from \`product\`)
  --source <file>    REQUIRED. field-provenance manifest: {"<path>": {block, valueField, columns?, labelField?}}
  --json             print the findings as JSON`);
    return args.length ? undefined : process.exit(2);
  }

  const opts = {};
  let file = null, asJson = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--skill") opts.skill = args[++i];
    else if (a === "--source") opts.sourcePath = args[++i];
    else if (a === "--json") asJson = true;
    else if (a.startsWith("--")) { console.error(`unknown option ${a}`); process.exit(2); }
    else file = a;
  }
  if (!file) { console.error("no input file given"); process.exit(2); }
  if (opts.sourcePath) {
    const sourceArg = opts.sourcePath;
    const cwd = resolve(process.cwd());
    const rootFd = openRootDir(".");
    try {
      containedFilePath(sourceArg);
      const { root: ROOT, resolved } = resolveUnderRoot(sourceArg, cwd);
      opts.source = JSON.parse(readValidatedFd(resolved, ROOT, rootFd));
    } catch (e) {
      console.error(`cannot read --source ${sourceArg}: ${e.message}`);
      process.exit(2);
    } finally {
      closeSync(rootFd);
    }
  }

  let result;
  try {
    result = validateFile(file, opts);
  } catch (e) {
    console.error(`cannot read ${file}: ${e.message}`);
    process.exit(2);
  }

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  for (const w of result.warnings) console.error(`  warning [${w.rule}] ${w.path || "(root)"}: ${w.message}`);
  if (result.errors.length) {
    console.error(`data block validation FAILED (${result.errors.length}${result.skill ? `, ${result.skill}` : ""}) — do not write the artifact:`);
    for (const e of result.errors) console.error(`  - [${e.rule}] ${e.path || "(root)"}: ${e.message}`);
    process.exit(1);
  }
  console.log(`data block OK (${result.skill})${result.warnings.length ? ` with ${result.warnings.length} warning(s)` : ""}`);
}

if (process.argv[1]) {
  const self = fileURLToPath(import.meta.url);
  const argv = resolve(process.argv[1]);
  const isMain = process.platform === "win32" ? self.toLowerCase() === argv.toLowerCase() : self === argv;
  if (isMain) main(process.argv);
}
