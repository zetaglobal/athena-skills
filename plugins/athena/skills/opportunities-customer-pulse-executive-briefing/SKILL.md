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
   requested missing aspects once, and render the table below. Do not refetch usable aspects.
6. **Shareable, self-contained HTML summary:** reuse the current ledger when available, then follow
   the [shareable HTML summary](#shareable-html-summary) workflow.

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

Call `customer_pulse_coverage` with the exact supplied report name. If it returns usable Coverage,
Reachability, Preferred Channel, or Social Platform rows, or explicitly resolves the exact name,
preserve that name and reuse the response.

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

Never place more than three large Customer Pulse calls in one batch. Never retry automatically.
A timeout, error, empty response, missing optional tool, or oversized presentation degrades only
that section. Compact available rows and continue; do not call an aspect again just to simplify
parsing. Do not paginate for completeness. For a focused request only, use at most one continuation
page when the first page cannot support one takeaway.

For each response immediately record: aspect, usable block families, all displayable rows in a
compact normalized form, strongest supported signals, one to three takeaways, `redirect_url`, and
`usable`, `empty`, or `failed`. Discard counts, raw internal scores, overall matched/not-matched
Coverage, and geography during normalization. This ledger must support the later full-data table
and HTML without refetching.

### Interpret carefully

Parse compact rows as quote-aware CSV. Null is not zero. Use returned order when already ranked.
Prefer the largest supported positive and negative baseline differences, then explain what they
suggest without inventing causation.

- Signed or convertible baseline differences support over/under-index language.
- A standalone non-negative `scaled_zscore` supports ranked-strength language only.
- Counts may inform internal ranking but never appear.
- Preferred Channel percentages describe channel preference, not reach, addressability, or audience
  membership. Use Reachability rows only for reach or addressability claims.
- For Demographics, use Customer Overlap fields for Age, Gender, Income, and Ethnicity. Sort each
  distribution largest to smallest, describe audience composition, and exclude geography.

## Default conversational brief

For a broad request, use the normalized ledger from the default fast path and follow this order:

1. `Executive Audience Brief | <exact report name>`
2. `Executive Summary` — two or three sentences connecting supported findings to a business implication
   without inventing causation
3. `Three distinctive findings`, drawn from different usable aspects when supported
4. `Audience readout`, covering every usable aspect; do not imply that omitted slower aspects were
   fetched or found empty
5. `Recommended actions` — up to three, each linked to evidence in the readout
6. Closing invitation, plus the returned ZMP link when available

Do not include a Provenance section. Do not create HTML, CSV, charts, or another file by default.
For a focused aspect question, answer directly with one category heading and sorted results.

Keep source names, tool names, omitted or failed aspects, and timestamps internal unless the user
asks how the brief was sourced. Never show raw scores or absolute counts. Ranked-strength data
supports ranking language, not over/under-index claims.

For comparisons, align rows by label and preserve one value per report in selection order. Missing
is null, never zero.

## Shareable HTML summary

Create HTML only when the user explicitly asks for a shareable, self-contained, visual, HTML, or
file summary. The existing `template.html` in this skill directory defines the layout and look.
Hand-authored HTML is not a substitute.

Reuse the current normalized ledger and source information. Do not repeat gateway calls for usable
aspects. If the user requests HTML directly without an existing ledger, run the expanded waves
once, then render.

1. Assemble the template data JSON and a source manifest covering every rendered characteristic.
2. Resolve the plugin root as the parent of the `skills` directory containing this skill.
3. Validate before rendering:

   `node <plugin-root>/scripts/validate-data-block.mjs <data.json> --skill customer-pulse --source <source.json>`

4. Correct every validation error and rerun. Never render invalid or hand-entered figures.
5. Replace the complete `<script id="pulse-data">` contents in `template.html` with the validated
   JSON and write a standalone `.html` file.

The HTML must remain self-contained: inline styles, scripts, data, and chart rendering; no CDN or
external asset dependency. Include the exact returned `redirect_url` as the Go to ZMP link. Do not
guess a URL. Do not generate or offer PDF, PowerPoint, or CSV exports.

Deliver the conversational brief first, then deliver the HTML through the first host surface that
can actually render it. In Codex Desktop, open it as a browser target using its `file:///` URL, not
as a file/editor target. Verify the visible page contains rendered charts before claiming success.
A local path or queued open alone is not delivery proof.

## Full returned dataset

When explicitly requested, reuse the ledger and render Markdown tables with exactly these columns:

| Aspect | Data | Takeaways |
| --- | --- | --- |

Use rows in this order: Demographics, Psychographics, Online Content Consumption, Transactions,
Visitation, Financial & Household, CTV, Linear TV. Fold Coverage signals into Demographics; do not
create a Coverage row.

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

After the default brief, end with this invitation or a close equivalent:

> Any aspects you want to dig into deeper? I can show the full returned dataset in an expanded
> table, help you explore this Customer Pulse report further in ZMP, or create a self-contained
> HTML summary you can share.

After a full-data table, do not offer the table again. Offer a deeper aspect readout, ZMP
exploration, or the shareable self-contained HTML summary.

When any response includes `redirect_url`, add `[Open this Customer Pulse report in ZMP]` using the
exact returned URL. Do not construct or guess a report URL, and never navigate automatically.

If every aspect is empty, say no usable insights were returned for the exact report and offer the
report list again. Omit empty headings and rows. Do not narrate retries, tool names, sessions, or
internal errors in the main readout.
