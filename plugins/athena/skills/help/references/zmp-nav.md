# ZMP navigation map (production)

Verified 2026-08-19 by walking the logged-in production left nav and clicking each
Opportunities card at `https://app.zetaglobal.net`. Every path below is a real `href` or a
real post-click URL, not a guess.

Navigation-tested the same day, each loading without redirect: `/reports/insights-studio`
(renders "Insights Studio"), `/campaigns/broadcast` (renders "Broadcast Campaigns"),
`/unified_segments` (renders "Segments & Lists"), and `/opportunities`.

Athena Chat was re-verified 2026-09-02 in an authenticated production segment editor. The
embedded assistant received the current page context, accepted a prompt through the accessible
composer, returned a multi-paragraph response, and left the page unchanged when instructed not
to make changes.

## Resolve the environment before opening anything

"Open the ZMP", "take me to ZMP", and every path in this file are **relative to the
environment this plugin build is connected to**. Never mix hosts.

Resolve the host from the gateway backing the MCP server that answered
`get_current_user_account` in this invocation:

| Gateway | ZMP host |
| --- | --- |
| `gateway.mcp.zetaglobal.net/virtual/athena-mcp/mcp` (production) | `https://app.zetaglobal.net` |
| A preprod or named-branch virtual server | The matching preprod host, e.g. `https://phoenix.app.zetaglobal.net` |

Paths are shared across environments; hosts are not. This file's paths were verified on
production only — on any other environment, treat them as likely-but-unconfirmed and fall back
to the left nav when one misses.

If a tool response or Knowledge Base page returns an absolute URL on a different ZMP host than
the resolved one, rewrite the host and keep the path.

Nav labels and available items differ by role, account, and entitlement. If a requested screen
is missing here, open `/home` and read the left nav. Do not invent paths.

## Main nav

| Left nav | Path | When to open |
| --- | --- | --- |
| Home | `/home` | Account switcher, Athena chat, activity feed — start here |
| Opportunities | `/opportunities` | Card wall of every Opportunity product |
| Calendar | `/calendar` | Campaign calendar |
| Settings | `/settings/profile` | Profile, permissions, connections, channel setup |

## Athena Chat browser contract

Athena Chat is an overlay embedded across authenticated ZMP pages, not a separate route. Reuse
the current ZMP page whenever possible so the assistant can reason over its page context.

Verified accessible controls and state:

| Purpose | Accessible browser signal |
| --- | --- |
| Open or identify panel | Click the button named `Athena` in the left header |
| Compose query | Textbox with placeholder `Ask me anything...` |
| Submit ready query | Button named `arrow-up` |
| Generation in progress | Submit changes to button named `Stop Loading` |
| Completed assistant content | New paragraph/list content before `Copy response`, `Thumbs up`, and `Thumbs down` controls |

The panel may already be open. Inspect before clicking; when it is closed, the `Athena` button in
the left header opens it. Snapshot the current URL, page heading, and existing message boundary
before submission; wait until `Stop Loading` disappears; then read only the new response and
inspect the page again. Do not rely on timestamps, CSS classes, element order across the entire
app, or the screenshot's pixel coordinates.

Authentication is proven by the normal app shell: left navigation plus an account/site label,
page content, or the Athena control. A login screen, access error, or absent app shell requires a
user login handoff in the same browser. Never enter credentials.

An unresponsive claimed tab is not proof that ZMP is signed out or that Athena is unavailable.
Discard the stale tab binding, reacquire the current matching tab from the same browser, and retry
one cheap inspection. When the user did not explicitly select an external browser, try the in-app
browser once after that retry fails. Ask for a reload or sign-in only after the in-app attempt is
also unavailable or visibly unauthenticated. Never ask the user to reload Chrome unless Chrome was
their explicit browser choice.

Home, Opportunities, Calendar, and Settings are direct links. Campaigns, Experiences,
Audiences, AI Studio, Data, Content, and Analytics are collapsible groups whose children are
listed below.

## Opportunities

`/opportunities` is a single hub in production — a card wall split into a **Market** column
(third-party and competitive) and a **Customer** column (first-party). There are no
`/opportunities/explore`, `/prospects`, `/customers`, or `/competitors` routes.

Product deep links use the shape `/opportunities/<slug>?opportunity_type=market|customer`.
Keep the `opportunity_type` parameter on a product URL — it is part of the observed link.

On the bare `/opportunities` hub the parameter is a **no-op**: navigating to
`/opportunities?opportunity_type=customer` was tested on 2026-08-19 and still rendered both the
Market and Customer columns. Do not present it as a filtered view. For a first-party starting
point, link Customer Pulse instead.

Always render these as full absolute URLs including the host, so they are clickable.

| Product | Path | Production MCP capability |
| --- | --- | --- |
| CustomerPulse℠ | `/opportunities/customer_pulse?opportunity_type=customer` | Customer intelligence (menu tool only — see below) |
| Leading Indicators | `/opportunities/leading_indicators?opportunity_type=customer` | Customer intelligence |
| CPG Intelligence | `/opportunities/cpg_intelligence?opportunity_type=customer` | Customer intelligence |
| CompetitorPulse℠ | `/opportunities/competitor_pulse?opportunity_type=market` | Competitive intelligence |
| PersonaPulse | `/opportunities/persona_pulse?opportunity_type=market` | Competitive intelligence |
| MarketPulse | `/opportunities/market_pulse?opportunity_type=market` | Market and audience sizing |
| Explore Zeta Audience Solutions | `/opportunities/audience_solutions?opportunity_type=market` | Market and audience sizing |
| AudiencePulse℠ | `/opportunities/audience_pulse?opportunity_type=market` | Visitation and behavioral trends |
| Demographic Intelligence | `/opportunities/demographic_intelligence?opportunity_type=market` | Visitation and behavioral trends |
| Discussion Index by Brand | `/opportunities/discussion_index_brand?opportunity_type=market` | Visitation and behavioral trends |

### Cards with account-specific URLs — never hardcode

Some Opportunity cards are account-provisioned dashboards whose route is a numeric id, not a
slug. On the verified account these were GeoExplorer, International Sizing, Sentiment
Intelligence, and Omni-Channel Attribution. **Those ids differ per account and must never be
written into a URL.** For any of them, open `/opportunities` and name the card to click.

The same applies to any Opportunity product not listed in the slug table above. Open the hub;
do not guess a slug.

## Campaigns

| Item | Path |
| --- | --- |
| Broadcast | `/campaigns/broadcast` |
| Triggered | `/campaigns/triggered` |
| Website In-Page | `/website_in_page` |
| Website Overlay | `/website-overlay` |
| Paid | `/campaigns?type=acquisition` |

Default: `/campaigns/broadcast`. Production has no `/campaigns/media` route.

## Experiences

| Item | Path |
| --- | --- |
| Builder | `/experiences` |
| Behaviors | `/v1/behaviors` |
| Events | `/activities` |
| Live Marketer | `/live-marketer` |

Default: `/experiences`.

## Audiences

| Item | Path |
| --- | --- |
| Segments & Lists | `/unified_segments` |
| People | `/audiences/subscribers` |
| Identity Manager | `/audiences/identity-manager` |
| Exports | `/audiences/automated_exports` |

Default: `/unified_segments`.

## AI Studio

| Item | Path |
| --- | --- |
| Agent Studio | `/models/list` |
| Workflows | `/workflows` |

Default: `/models/list`.

## Data

| Item | Path |
| --- | --- |
| Connectivity | `/files/connectivity` |
| Data Flows | `/files/data_explorer` |
| Data Mappings | `/files/import_data_mapping` |
| Clean Room | `/files/clean_room` |
| Files | `/data/files` |

Default: `/files/data_explorer`.

## Content

| Item | Path |
| --- | --- |
| Resources | `/resources` |
| Asset Library | `/asset-library` |
| Visual Composer | `/visual-composer` |
| Email Templates | `/marketing_templates` |
| Snippets | `/snippets` |
| Feeds | `/feeds` |
| Web Pages | `/web-pages` |

Default: `/resources`. Production has no `/content_templates` route; Email Templates is
`/marketing_templates`.

## Analytics

| Item | Path |
| --- | --- |
| Insights Studio | `/reports/insights-studio` |
| Templates | `/reports/templates` |
| Query Lab | `/reports/query-lab` |
| Attribution | `/analytics/attribution` |
| Content | `/reports/content` |
| Prime Time | `/reports/primetime` |
| Embedded Reports | `/reports/embedded-reports` |

Default: `/reports/insights-studio`. This is the screen behind every Comprehensive reporting
tool and the Insights Studio briefing skill.

## Account switch

Change accounts in the account selector on `/home`. Athena MCP follows that selection, so the
site id returned by `get_current_user_account` changes only after the user switches there.
`get_current_user_account` is read-only and cannot switch accounts.
