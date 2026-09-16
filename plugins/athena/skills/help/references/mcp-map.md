# Athena production MCP tool map

Verified production target: **15 read-only tools** in three families. Reconcile this reference
against the live tool list because entitlements remain account-specific.

## Analytics (4)

ZMP: https://app.zetaglobal.net/reports/insights-studio
Knowledge Base: https://knowledgebase.zetaglobal.com/kb/insights-studio

| Tool | What it does | Access |
| --- | --- | --- |
| `get_datasets` | Lists reporting datasets; `datasets[].id` is the query identifier | Read |
| `get_dataset_schema` | Returns valid dimensions and metrics for a dataset | Read |
| `fetch_metrics_data` | Runs KPI, trend, comparison, and breakdown queries | Read |
| `get_chart_definitions` | Lists available chart types and their field requirements | Read |

Insights Studio report drafting and creation are not exposed. The briefing skill can create a local
self-contained HTML summary on request; it does not save a report into ZMP.

## Customer Pulse (10)

ZMP: https://app.zetaglobal.net/opportunities/customer_pulse?opportunity_type=customer
Knowledge Base: https://knowledgebase.zetaglobal.com/kb/customerpulse

`continuation_data` is shared infrastructure for Opportunity Insights responses. Use it only when
`__metadata.has_more` is true and more rows are needed for the requested answer.

| Tool | What it does | Access |
| --- | --- | --- |
| `customer_pulse_audiences` | Lists Customer Pulse audiences by segment date, including report-friendly `_segment_name` and `vertical_name` | Read |
| `customer_pulse_verticals` | Lists available Customer Pulse verticals | Read |
| `customer_pulse_coverage` | Addressability, reachability, preferred channels, and social-media presence | Read |
| `customer_pulse_demographics` | Ethnicity, state, ZIP, age, gender, and income; supports state and ZIP filters | Read |
| `customer_pulse_psychographics` | Persona values and motivations | Read |
| `customer_pulse_content_consumption` | Behavioral and online-content interests; supports interest filters | Read |
| `customer_pulse_transactions` | Transactional and purchase interests; supports interest filters | Read |
| `customer_pulse_visitation` | Physical visitation interests; supports interest filters | Read |
| `customer_pulse_financial_household` | Financial and household interests; supports interest filters | Read |
| `continuation_data` | Retrieves the next batch of a truncated response using its `continuation_id` | Read |

Call the matching Customer Pulse data tool directly when the user supplies an audience name.
`customer_pulse_audiences` and `customer_pulse_verticals` are discovery or disambiguation helpers,
not mandatory pre-calls. Channel and social-platform rows are returned by
`customer_pulse_coverage`; they are not separate MCP tools.

## Account (1)

ZMP: https://app.zetaglobal.net/home
Knowledge Base: https://knowledgebase.zetaglobal.com/kb/quick-start-guides

| Tool | What it does | Access |
| --- | --- | --- |
| `get_current_user_account` | Returns the active ZMP site ID for this session | Read |

## Not available in this version

The production connector does not expose report drafting or creation, Location Intelligence,
Leading Indicators, CPG Intelligence, executive recommendations, competitive intelligence,
market and audience sizing, visitation trends, ZDI demographics, international behavioral
interest, GEO metrics, or their entity-resolution helpers.

Campaign and media-campaign management, segment and audience management, experience
orchestration, content and template tools, data-flow and upload operations, model workbench and
guidance, warehouse and attribution queries, and mobile-app integrations are also not exposed.

`help` answers ZMP how-to questions through scoped searches of the public Knowledge Base website;
that does not require a Knowledge Base MCP tool.
