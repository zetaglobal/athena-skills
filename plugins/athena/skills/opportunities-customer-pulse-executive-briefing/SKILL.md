---
name: opportunities-customer-pulse-executive-briefing
description: >
  Answers Customer Pulse audience questions from live Zeta reports and produces a concise,
  source-backed executive briefing in conversation. Use for reachability, demographics,
  psychographics, content consumption, transactions, visitation, financial and household traits,
  channel activity, audience comparisons, or questions about who an audience is and how to reach
  it. Create a full-data table or shareable HTML only when the user explicitly asks for it.
license: SEE LICENSE IN LICENSE
metadata:
  author: Zeta Global
  version: "0.3"
---

# Customer Pulse Executive Briefing (Athena by Zeta)

Give fast, source-backed Customer Pulse insights. A segment-only or broad request defaults to a
concise conversational executive brief. Do not create a file or artifact unless the user asks.

This skill is read-only. Never expose absolute person, customer, or record counts. Never print raw
`index_value`, `index`, `scaled_zscore`, or other internal scores. Translate supported indexed
findings into plain language; percentages and rates may be shown. Do not invent values, substitute
adjacent fields, or treat a missing tool as empty customer data.

In text and HTML briefings, display every percentage and percentage-point difference rounded to
the nearest whole number, with no decimal places (for example, `84.87%` becomes `85%`). This applies
to prose, Highlights, chart labels, legends, and tooltips. Keep full precision in source data,
normalized numeric values, calculations, sorting, and chart geometry; round only for display.

## Route the request

1. **No segment named, including a bare invocation:** call `customer_pulse_audiences`, then follow
   [Report selection](#report-selection) below. Return the first useful verified batch in a
   numbered list; verify more candidates only when needed or requested.
2. **Segment plus a specific aspect:** resolve the report with one Coverage probe, fetch only the
   needed family, and answer immediately.
3. **Segment plus a broad request:** run the default fast brief: Coverage plus Psychographics and
   Transactions only. Return the [default conversational brief](#default-conversational-brief)
   and offer the slower aspects on request.
4. **Full, detailed, comprehensive, or "everything" request:** run the expanded cross-aspect
   workflow before returning the brief.
5. **Full dataset or expanded table:** reuse the current normalized ledger, fetch any explicitly
   requested missing aspects once, and render the table below. Do not refetch usable aspects; for
   an aspect whose ledger recorded `has_more: true`, follow its recorded `continuation_id` instead.
6. **Shareable, self-contained HTML summary:** follow the
   [shareable HTML summary](#shareable-html-summary) workflow, reusing available data and applying the documented dashboard filters.

Infer intent from natural language. Do not ask the user to choose a tool or dimension when their
question is already clear.

| User intent | Data call |
| --- | --- |
| reachability, preferred channel, social platform | `customer_pulse_coverage` |
| age, gender, income, ethnicity | `customer_pulse_demographics` |
| attitudes, interests, lifestyle, persona | `customer_pulse_psychographics` |
| sites, topics, media, what they watch or read | `customer_pulse_content_consumption` |
| purchases, categories, what they buy | `customer_pulse_transactions` |
| places, stores, where they go | `customer_pulse_visitation` |
| finances, household, ownership, life events | `customer_pulse_financial_household` |
| connected TV or CTV | `customer_pulse_ctv`, only when already callable |
| linear or broadcast TV | `customer_pulse_linear_tv`, only when already callable |

Coverage contains Preferred Channel and Social Platform blocks; those are not separate tools.

### Geography is out of scope

This skill does not answer location, geography, state, ZIP, or "where do they live" questions.
The state and ZIP sections of `customer_pulse_demographics` are slow and routinely time out, and
they are the most common cause of a failed demographics call.

- Never route a geographic question to `customer_pulse_demographics`. Say this skill does not
  cover geographic distribution, and offer the Customer Pulse report in ZMP instead.
- Never pass the `states` or `zipcodes` arguments. They narrow a section this skill never shows,
  and they add server-side fuzzy resolution to an already slow call.
- Never request a continuation page, extra ZIP rows, or a retry to obtain geographic rows.
- Discard the returned state and ZIP sections before normalizing. Their presence, absence, or
  emptiness never affects whether Demographics counts as usable: judge that on Age, Gender,
  Income, and Ethnicity alone.
- Preserve the exact report label when naming the source, but do not infer or characterize audience
  geography from words in that label, brand names, or other non-geographic aspect rows. Outside
  the exact source label, do not describe findings as regional, local, East Coast, or geographic.

## Report selection

Use this when the user did not name a report.

### Build the menu progressively

Call `customer_pulse_audiences`. Treat rows containing `_segment_name` and optional
`vertical_name` as candidates. Reject ordinary segment inventory rows such as `segment_name`,
`membership_month`, or `total_people`.

Do not prove the full catalog before responding. Verify candidates progressively with
`customer_pulse_coverage`:

1. Send the first batch of at most three exact labels in one Coverage call.
2. Keep a label only when its response has non-empty Coverage, Reachability, Preferred Channel,
   or Social Platform data.
3. Return the usable labels from that batch immediately. If none are usable, try the next batch and
   stop as soon as one batch produces at least one usable label.
4. Do not recheck a resolved-but-empty candidate during menu building. Treat it as unproven unless
   the user later supplies or selects that exact name.
5. Preserve the next untested candidate position. Verify one additional batch only when the user
   asks for more choices, then append its usable labels to the existing numbered menu.

A mixed Coverage call proves menu eligibility and supplies reusable Coverage data for those exact
labels. When the user selects a verified report from the immediately preceding menu in the same
conversation and account, reuse its Coverage blocks; do not call Coverage again. Call Coverage
with only the selected exact names when the selection did not come from that current verified
menu, its Coverage data is no longer present in context, the account changed, or the user selects
reports that were verified in different batches and cannot be safely separated from the response.

If discovery is unavailable or incompatible, an already authenticated ZMP Customer Pulse selector
may supply candidate labels. Inspect its full option list, not only the selected option, then apply
the same progressive Coverage proof. Do not explain filtering, probes, source choice, or rejected
names.

### Ask the first question

Use `Available Customer Pulse reports:` and a numbered list.

- On the first response, show up to three verified reports from the first useful batch and offer
  more choices.
- When the user asks for more, verify the next batch of at most three and append only usable reports
  while preserving stable numbering.
- Do not state or imply that untested candidates are verified or retrievable.
- Preserve exact labels and duplicates. Use vertical only to disambiguate.
- Accept a number, exact name, or several joined by commas, `and`, or `&`.
- Cap comparisons at four reports.

Ask which report the user wants, then show short examples using actual visible numbers or names:

- `Give me general insights for 3.`
- `What is content consumption like for 3?`
- `What are the demographics for 3?`
- `Compare 2 and 3.`

Do not ask for single-versus-comparison mode; selection count determines it. If every discovered
candidate has been tested and none pass proof, say no reports with retrievable data were found in
this run. If no valid candidates exist from either source, ask for the exact report name shown in
ZMP.

## Fast path

### Preflight only what the request needs

Confirm `customer_pulse_coverage` is callable. For a focused question, also confirm its requested
tool. Use the gateway tool finder once only when that explicitly requested capability is missing.
If it remains missing, give only the current host's reconnect step and stop.

For a default broad readout, inspect Coverage, Psychographics, and Transactions only. For an
expanded readout, inspect visible capabilities once; missing aspect tools are section-level
omissions. Do not search for absent CTV or Linear TV tools. Do not preflight visualization,
templates, exports, or every Customer Pulse tool for an ordinary conversational answer.

### Resolve once

Call `customer_pulse_coverage` with the exact supplied report name in the `audience_names` array
(`{"audience_names": ["<exact name>"]}`), the argument every `customer_pulse_*` data tool uses for
report names. If it returns usable Coverage, Reachability, Preferred Channel, or Social Platform
rows, or explicitly resolves the exact name, preserve that name and reuse the response.

An all-empty response whose block names lack the `_0` suffix (for example
`customer_pulse_reachability` instead of `customer_pulse_reachability_0`) means the call was
malformed, not that the audience is empty: retry once with `audience_names`.

If unresolved, make one retry containing at most three candidates: exact name, date suffix removed,
and spaces/underscores swapped. An all-empty result means unresolved, not an empty audience.

### Fetch the smallest useful brief

For a focused question, make exactly one aspect call after resolution. For a default broad
readout, reuse and normalize Coverage, then call Psychographics and Transactions together in one
tool wave. When the host supports concurrent calls, issue both before waiting for either result;
if the host serializes MCP calls, accept that execution order and never retry either call. Do not
call Demographics, Online Content Consumption, Visitation, Financial & Household, CTV, or Linear
TV unless the user asks for that aspect or asks for a full, detailed, comprehensive, or
"everything" readout.

For an expanded readout, reuse every usable block already in the ledger, then fetch only missing
aspects in these waves:

1. Demographics, Psychographics, and Online Content Consumption in parallel.
2. Normalize all three into a compact ledger.
3. Transactions, Visitation, and Financial & Household in parallel.
4. Normalize all three.
5. CTV and Linear TV only when already callable.

Never place more than three large Customer Pulse calls in one batch. Never retry automatically,
including while building HTML. A failure degrades only that section; name it in
`sourceLimit` for the HTML. A structured error or `data: null` with errors is a failed call even
when the wrapper says `isError: false`; never treat it as empty audience data. An empty response,
missing optional tool, or
oversized presentation also degrades only that section. Compact available rows and continue; do not call an aspect again just to simplify
parsing. For ordinary briefs, do not paginate for completeness. For a focused request only, use at
most one continuation page when the first page cannot support one takeaway. When the user
explicitly asks for the full returned dataset, follow `__metadata.continuation_id` with
`continuation_data` until `has_more` is false or a page fails. Deduplicate continuation rows by
their source identifiers or category plus label. If pagination fails, label the dataset partial and
state which aspect stopped.

For each response immediately record: aspect, usable block families, all displayable rows in a
compact normalized form, strongest supported signals, one to three takeaways, `redirect_url`,
`has_more` and `continuation_id` from `__metadata`, whether pagination completed, and `usable`,
`empty`, or `failed`. Discard counts, raw internal scores, overall matched/not-matched
Coverage, and geography during normalization. This ledger must support the later full-data table
and HTML without refetching.

### Interpret carefully

Parse compact rows as quote-aware CSV. Null is not zero. Use returned order when already ranked.
Prefer the largest supported positive and negative baseline differences, then explain what they
suggest without inventing causation.

- Signed or convertible baseline differences support over/under-index language.
- A standalone non-negative `scaled_zscore` supports ranked-strength language only.
- Counts may inform internal ranking but never appear.
- Interest, persona, and visitation blocks can return values as strings (for example `"26.0"`).
  Parse numeric strings, treat an empty string as null, and treat an `outlier` of `1`, `"1"`, or
  `"1.0"` as an outlier.
- For Psychographics, Online Content Consumption, Transactions, Visitation, and Financial &
  Household, the dashboard prints each signal's `network_baseline_difference` inside the bar.
  Chart that field with `scale: "baseline-delta"`; fall back to `scaled_zscore` as ranked strength
  only when a section returns no differences. Psychographics is the `persona_pulse` block,
  labeled by `value` alone (`Glamorous`, not `Sophistication: Glamorous`); the dashboard does not
  show `persona_pulse2`.
- The MCP block named Preferred Channel supplies the browser's Activity by Channel chart. The
  browser tooltip describes recent engagement among the reachable audience. Use Reachability
  rows only for addressable reach; never relabel Preferred Channel as reach.
- For Demographics, use Customer Overlap fields for Age, Gender, Income, and Ethnicity. Sort each
  distribution largest to smallest, describe audience composition, and exclude geography.

## Default conversational brief

For a broad request, use the normalized ledger from the default fast path and follow this order:

1. `Executive Audience Brief | <exact report name>`
2. `Executive Summary` — two or three sentences connecting supported findings to a business implication
   without inventing causation
3. `Highlights` — three findings, drawn from different usable aspects when supported
4. `Audience readout`, covering every usable aspect; do not imply that omitted slower aspects were
   fetched or found empty
5. `Recommended actions` — up to three, each linked to evidence in the readout
6. Closing invitation, plus the returned ZMP link when available

Do not include a Provenance section. Do not create HTML, CSV, charts, or another file by default.
For a focused aspect question, answer directly with one category heading and sorted results.

Keep source names, tool names, omitted or failed aspects, and timestamps internal unless the user
asks how the brief was sourced. Never show raw scores or absolute counts. Ranked-strength data
supports ranking language, not over/under-index claims.

Before returning, remove every absolute count and the overall match rate: "~2M matched, near-full
coverage (99.9%)" goes entirely.

For comparisons, align rows by label and preserve one value per report in selection order. Missing
is null, never zero.

## Shareable HTML summary

Create HTML only when the user explicitly asks for a shareable, self-contained, visual, HTML, or
file summary. The existing `template.html` in this skill directory defines the layout and look.
Hand-authored HTML is not a substitute.

Reuse the current normalized ledger and source information. A follow-up HTML summary covers the
aspects already retrieved; fetch additional aspects only when the user asks for them or for an
expanded readout. Never repeat a usable aspect to change its output format. If HTML is requested
directly without an existing ledger, fetch the expanded readout once. Name omitted aspects in
`sourceLimit` without treating them as empty data. Apply the dashboard filters from the shared
reference below, with user-specified or browser-observed selections taking precedence. No separate
HTML builder or client-specific response conversion is required.

1. Assemble the existing template's data JSON and a source manifest covering every characteristic
   and Coverage tab, using the section contract below.
2. Resolve the plugin root as the parent of the `skills` directory containing this skill.
3. Validate with the existing validator:

   `node <plugin-root>/scripts/validate-data-block.mjs <data.json> --skill customer-pulse --source <source.json>`

   Run from the directory containing the saved data and source manifest. Inspect the template's
   data block and relevant renderer functions; avoid reading or reproducing its embedded image
   data. Preserve the rest of the template unchanged when inserting the validated JSON.

4. Correct validation errors, then replace the complete `<script id="pulse-data">` contents in
   `template.html` with the validated JSON and save the standalone HTML.

Use the following section contract:

- **Highlights:** exactly three headline metrics when three usable aspects exist, drawn from
  different returned aspects. Use a channel or platform signal, a psychographic signal, and a
  third distinct aspect when available. Each card names its signal and measure; do not use
  match rate or a raw count.
- **Coverage:** one section with tabs in this order: Channel Reachability, Activity by Channel,
  Activity by Social Channel. Feed `reachability` from the Reachability `percentage` field,
  `activityChannel` from Preferred Channel `percentage`, and `activitySocial` from the Social
  Platform `network_baseline_difference`, and name each block in the source manifest; the
  validator rejects any other pairing. Reachability is addressability; Preferred Channel is
  recent channel engagement, not reach. Use the dashboard's labels and order, verified against
  the live dashboard: Reachability as Programmatic Universe, CTV, Permissioned Email (returned as
  `Permissible Email Universe`), Social, Search, Direct Mail, with any other channel after them
  and `Inbox Advertising` dropped; Activity by Channel largest first, with `Mobile`, `Display`,
  and `Email` shown as `Programmatic - Mobile`, `Programmatic - Display`, and
  `Permissioned Email`; Activity by Social Channel in returned order. The dashboard's Overall
  Coverage match rate stays out of the briefing.
- **Audience characteristics:** one Demographics tab containing four charts named Age, Gender,
  Income, and Ethnicity, followed by Psychographics, Online Content Consumption, Transactions,
  Visitation, and Financial & Household. Set `tab: "Demographics"` on all four demographic
  charts, use `scale: "customer-overlap"`, and source Age/Gender/Income from
  `customer_ratio_value` and Ethnicity from `customer_ratio`. Do not chart their index fields.
  In the HTML, keep Age, Income, and Gender rows in returned band order and list Ethnicity
  alphabetically, as the dashboard does. The dashboard shows Financial & Household as one chart
  from one block; if more than one chart is built, give each `tab: "Financial & Household"`.
  Other aspects may use signed baseline differences or ranked strength only when their source
  field supports that scale. Never use a retired section name (Content consumption,
  Transactional interests, Visitation interests, Financial signals, Household and property) as a
  tab; the validator rejects them.
- **Signal charts:** an ordinary HTML summary shows up to ten rows per Psychographics or interest
  chart, after applying the selected filters, sorted by `network_baseline_difference`, largest
  first; ties keep returned order. Include up to 50 only when the user explicitly asks for a
  detailed or expanded view. State the displayed limit in `sourceLimit`. Preserve returned topic
  labels and use the selected category/subcategory filters for approximate alignment. If pages
  remain, describe these as retrieved signals rather than claiming the exact dashboard top 50.
- **Source note:** `sourceLimit` always says that Financial & Household values come from a
  different data block than the dashboard's default view and can differ from it, whenever that
  chart is shown, and names any partial or omitted section and any tie at the displayed cutoff.
- Put the dashboard's info-tooltip wording in each chart's gray `caption`. The Coverage
  tooltips are embedded in the template. The tooltips verified in the live Telecom report are:
  Age — `Age breakdowns by audience segment`; Gender — `Gender breakdowns by audience segment`;
  Income — `Household income breakdowns by audience segment`; Ethnicity —
  `Ethnicity breakdowns by audience segment`; Psychographics —
  `Values, attitudes and lifestyle traits inferred from online content consumption to enhance audience profiling, messaging, and motivation insights by audience segment.`;
  Online Content Consumption —
  `Real-time interest and intent signals derived from online content consumption to understand individual needs, motivations and purchase readiness by audience segment.`;
  Transactions — `Brands individuals transact with by audience segment.`;
  Visitation — `Physical brand locations visited by the audience segment.`;
  Financial & Household — `Financial and Household characteristics by the audience segment.`
  Recheck the live tooltip when available; do not substitute a metric interpretation as the
  tooltip text.

### Match the dashboard's filters

For a readout or HTML summary intended to approximate the dashboard's interest views, read
[references/dashboard-filter-presets.json](references/dashboard-filter-presets.json). This is
shared data for any agent, captured from dashboard configuration on 2026-09-25. It provides
category/subcategory presets for 19 industry verticals across
Online Content Consumption, Transactions, Visitation, and Financial & Household.
Use these defaults for best-effort alignment; preserve returned topic labels and do not add
topic-specific hiding or name replacements to reproduce the dashboard exactly.

Use the selected report's `vertical_name` already available from discovery. Convert underscores
to spaces and title-case the words to find its preset (for example `financial_services` becomes
`Financial Services`). If the vertical is unknown, reuse the current responses without guessing
a preset; do not repeat discovery merely for an ordinary brief. A known vertical with no preset,
such as `generic`, uses no category/subcategory filter. The reference identifies unverified
configurations; disclose those limitations.

Selections supplied by the user or observed during authorized browser access override the saved
preset. Do not open the browser automatically. The MCP does not return default UI selections;
never describe the saved preset as a current browser observation.

Reuse available rows and apply the reference's category/subcategory rules locally. For a missing
aspect, omit `interests` when applying only a saved dashboard preset: saved names can be aliases
that the current MCP does not recognize. When the user explicitly names a topic, pass it verbatim
in `interests` as the tool requires. The current MCP resolves these terms fuzzily across Title,
ParentGroup, and SubGroup; apply exact dashboard selections locally after the call. Do not refetch
a usable aspect to change its format or apply filters. Treat `1`, `"1"`, and `"1.0"` as outliers
when Remove Outliers is enabled, and drop null differences. Sort by `network_baseline_difference` when Sort by Indexing
is selected. Preserve each row's label, group, subgroup, and boolean outlier flag.

For HTML, record `selection.source` as `dashboard-preset` with the applied preset name, or as
`browser-observed` or `user-specified` with the selections actually applied. For a known vertical
without a preset, use its title-cased name and empty category/subcategory lists. If the vertical
and actual selections are unknown, omit `selection` and state that dashboard filters were not
verified. Preserve paging metadata; ordinary summaries do not need complete datasets. A failed
page leaves the section partial and does not justify refetching it.

The MCP interest tools return the `_customer_ratio` blocks, while the dashboard's default
Indexing view charts the matching blocks without that suffix. In the report verified on
2026-09-25 the two agreed for Online Content Consumption, Transactions, Visitation, and
Psychographics but not for Financial & Household (Jazz Music +70% from the MCP, +88% in the
dashboard). When the browser and MCP disagree, use the MCP value with an explicit note in
`sourceLimit`; never overwrite it with the browser figure or claim the views are identical.

The HTML must remain self-contained: inline styles, scripts, data, and chart rendering; no CDN or
external asset dependency. Include the exact returned `redirect_url` as the Go to ZMP link. Do not
guess a URL. Do not generate or offer PDF, PowerPoint, or CSV exports.

Deliver the conversational brief first, then deliver the HTML through the first host surface that
can actually render it. In Codex Desktop, open it as a browser target using its `file:///` URL, not
as a file/editor target. Verify the visible page contains rendered charts before claiming success.
A local path or queued open alone is not delivery proof.

## Full returned dataset

When explicitly requested, reuse the ledger, complete any recorded continuation pages, and render
Markdown tables with exactly these columns:

| Aspect | Data | Takeaways |
| --- | --- | --- |

Use rows in this order: Coverage, Demographics, Psychographics, Online Content Consumption,
Transactions, Visitation, Financial & Household, CTV, Linear TV.

- Coverage: every returned Reachability and Activity rate, sorted; strongest supported Social
  Platform differences.
- Demographics: every returned Customer Overlap value for Age, Gender, Income, and Ethnicity,
  sorted within each distribution.
- Psychographics and behavioral aspects: every displayable normalized row; signed differences
  sorted by magnitude or ranked-strength rows in returned order.
- TV: meaningful subgroups, up to five values per subgroup.
- Use `<br><br>` between sublists and `→` between values. `Takeaways` contains one to three terse
  `•` statements separated by `<br>`.

Never show match rate, raw scores, counts, or geography. Split an unreadably wide result into
consecutive tables with the same columns rather than inventing summary values.

## Closing invitation

After the default brief, end with this invitation or a close equivalent. Never proactively offer
to export or display the full returned dataset in a table:

> Any aspects you want to dig into deeper? I can help you explore this Customer Pulse report
> further in ZMP or create a self-contained HTML summary you can share.

After a full-data table, do not offer the table again. Offer a deeper aspect readout, ZMP
exploration, or the shareable self-contained HTML summary.

When any response includes `redirect_url`, add `[Open this Customer Pulse report in ZMP]` using the
exact returned URL. Do not construct or guess a report URL, and never navigate automatically.

If every aspect is empty, say no usable insights were returned for the exact report and offer the
report list again. Omit empty headings and rows. Do not narrate retries, tool names, sessions, or
internal errors in the main readout.
