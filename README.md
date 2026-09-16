# Athena by Zeta - Agent Plugin (Beta)

> **This is a Beta.** Athena by Zeta - Agent Plugin (Beta), MCP, and skills may change or be withdrawn without notice. They are provided without warranty and subject to the limitations in [LICENSE](LICENSE).

**Documentation: [docs.zetaglobal.com/docs/athena-mcp](https://docs.zetaglobal.com/docs/athena-mcp)**

**Release notes: [docs.zetaglobal.com/docs/athena-mcp-beta-release-notes](https://docs.zetaglobal.com/docs/athena-mcp-beta-release-notes)**

**Public plugin source: [github.com/zetaglobal/athena-skills](https://github.com/zetaglobal/athena-skills)**

Athena by Zeta - Agent Plugin (Beta) has two integrated parts:

- **Skills** provide ready-to-use workflows that teach an AI agent how to use Athena MCP tools effectively.
- **Athena by Zeta MCP** exposes the approved Athena tools and live Zeta insights those workflows use.

Together, they let you ask questions in plain language without having to select individual MCP
tools or determine the correct calling sequence yourself.

## MCP Server
```
https://gateway.mcp.zetaglobal.net/virtual/athena-mcp/mcp
```

Authentication is **browser OAuth**: the first tool call opens a Zeta Global sign-in tab.

## Access

Zeta Global must grant your ZMP account access to Athena by Zeta MCP. This access is not self-serve.
Zeta enables it per account and decides which tools that account can access. Without it, OAuth still
succeeds and the gateway returns no tools—the skills load but have nothing to call. Ask your
Zeta Global account team to grant access.


## Available skills

| Skill | What it gives you |
| --- | --- |
| [opportunities-customer-pulse-executive-briefing](plugins/athena/skills/opportunities-customer-pulse-executive-briefing/SKILL.md) | Who an audience is and how reachable it is: coverage, reachability by channel, demographics, and what the segment over-indexes on. One segment, or up to four compared side by side. Can export formatted html briefing. |
| [analytics-insights-studio-executive-briefing](plugins/athena/skills/analytics-insights-studio-executive-briefing/SKILL.md) | How a dataset, report, or campaign performed: headline KPIs with period-over-period deltas, trends, and breakdown. Can export formatted html briefing. |
| [help](plugins/athena/skills/help/SKILL.md) | What the skills do, and how-to answers from the Zeta Knowledge Base. Can navigate you to ZMP pages.

### Example questions

Customer Pulse executive briefing:

- "Give me a customer pulse briefing for our recent purchasers segment."
- "Who is our audience, and how reachable is this segment?"
- "Compare these two segments side by side."

Insights Studio executive briefing:

- "Build an Insights Studio briefing for our email engagement dataset."
- "How did our campaigns perform last month compared to this month?"
- "Give me an executive performance summary from Insights Studio."

Help:

- "What can these skills do?"
- "How do I create a campaign in ZMP?"
- "Open my audiences in ZMP."
- "Show me the docs for building an audience."

## Installation

### Claude Code (CLI and desktop app)

```bash
claude plugin marketplace add zetaglobal/athena-skills
claude plugin install athena@zetaglobal
```

Confirm MCP connection with `claude mcp list` —
you should see `plugin:athena:athena` connected. Skills appear immediately
as `/athena:<skill-name>`; the first tool call opens the Zeta Global sign-in tab.

Installing at user scope also covers the **Claude Code desktop app**, which reads the
same registry.

Update later with `/plugin marketplace update zetaglobal`.

### Claude Desktop (chat app)

Desktop needs the skills and the connector wired separately — it installs the plugin's
skills but cannot authorize a plugin-supplied connector, so the skills would otherwise
load with no tools.

1. Settings -> **Customize** -> **Plugins** -> **Add** -> **Add marketplace**.
2. Marketplace: `zetaglobal/athena-skills` (or `https://github.com/zetaglobal/athena-skills.git`).
3. Leave **Sync automatically** on, then **Sync**.
4. Pick the **zetaglobal** marketplace and install **Athena by Zeta - Agent Plugin (Beta)** (`+`).
5. Wire the connector — from a clone of this repo, or from the marketplace clone the
   install just made at `~/.claude/plugins/marketplaces/zetaglobal`:

   ```bash
   node scripts/add-desktop-connector.mjs
   ```

6. Restart Claude Desktop, then approve the Zeta sign-in tab on the first tool call.

If marketplace install is unavailable, `./scripts/package-plugin.sh` builds
`dist/athena-v<version>.zip`, which installs through **Add** -> **Upload local plugin**.
Zip installs do not auto-update.

### Codex Desktop / Codex CLI

Codex installs the plugin, so it gets the skills **and** the MCP. `marketplace add` takes
a git URL directly — no clone needed. Use the `codex` bundled with the ChatGPT desktop app if
that is your installation:

```bash
CODEX="/Applications/ChatGPT.app/Contents/Resources/codex"

$CODEX plugin marketplace add zetaglobal/athena-skills --json
$CODEX plugin add athena@zetaglobal --json
$CODEX mcp add athena --url https://gateway.mcp.zetaglobal.net/virtual/athena-mcp/mcp
$CODEX mcp login athena
```

The explicit `mcp add` is required before `mcp login`: the login command manages Codex's
external MCP registry and does not resolve the plugin-bundled server by name.

Then **restart the ChatGPT / Codex Desktop app** — the CLI checks can all pass while the
running app still does not expose the new skills. Full walkthrough, verification commands,
and the re-authentication path: [`docs/athena-mcp.md`](docs/athena-mcp.md#codex-desktop-and-codex-cli).

### GitHub Copilot CLI

Add the Zeta Global marketplace, install Athena by Zeta - Agent Plugin (Beta), and verify both
the plugin and Athena by Zeta MCP:

```bash
copilot plugin marketplace add zetaglobal/athena-skills
copilot plugin install athena@zetaglobal
copilot plugin list
copilot mcp list
```

To install from a release ZIP instead, download the Claude package
(`athena-claude-v<version>.zip`), unzip it, and pass the extracted `athena` plugin folder to
Copilot. Do not pass the ZIP file itself:

```bash
copilot plugin install <path_to_unzipped_plugin_folder>
copilot plugin list
copilot mcp list
```

If Athena shows `needs-auth`, start Copilot and re-authenticate the MCP server:

```text
copilot
/mcp auth athena
```

### ChatGPT Enterprise

The repository includes the current OpenAI repo marketplace at
[`.agents/plugins/marketplace.json`](.agents/plugins/marketplace.json). A workspace
administrator installs Athena by Zeta - Agent Plugin (Beta) from that marketplace, publishes the plugin from their
Personal plugins into the workspace, and assigns the intended workspace roles. This gives
users the skills and the MCP server together.

### Cursor

The repo ships what Cursor needs — [`.cursor-plugin/marketplace.json`](.cursor-plugin/marketplace.json)
at the root and a `.cursor-plugin/plugin.json` in the plugin, whose `mcpServers` points at the
same `.mcp.json` the other hosts use. How you install it depends on your plan.

**Local install (any plan, recommended here).** Clone the repo and put the plugin where Cursor
looks for local plugins — a symlink keeps it current with `git pull`:

```bash
git clone git@github.com:zetaglobal/athena-skills.git ~/athena-skills
mkdir -p ~/.cursor/plugins/local
ln -s ~/athena-skills/plugins/athena ~/.cursor/plugins/local/athena
```

Restart Cursor. This gives you the skills and the gateway together.

**Team marketplace (Teams and Enterprise only).** An admin goes to Dashboard -> Plugins ->
Team Marketplaces -> Add Marketplace -> Import from Repo. This repository is on GitHub
(`zetaglobal/athena-skills`), which matches Cursor's documented import path. Individual
accounts cannot create a custom marketplace.

**Tools only.** If you just want the gateway without the skills, Settings -> MCP -> Add server,
pointed at the endpoint above with OAuth.

### Other (generic MCP client)

Any MCP client that supports streamable HTTP with OAuth can connect. Point it at the
gateway endpoint above; the client handles the OAuth handshake.

## Athena by Zeta MCP tools

The MCP server exposes **15 tools** in three
families. Your assistant can call them directly.

### Analytics (4)

[Insights Studio](https://app.zetaglobal.net/reports/insights-studio) · [Knowledge Base](https://knowledgebase.zetaglobal.com/kb/insights-studio)

`dataset_id` must be `datasets[].id` from `get_datasets`, never `datasets[].name`. Call
`get_dataset_schema` before querying.

| Tool | What it does | Access |
| --- | --- | --- |
| `get_datasets` | List reporting datasets; source of `datasets[].id` | Read |
| `get_dataset_schema` | Valid dimension and metric names for a dataset | Read |
| `fetch_metrics_data` | Run a read query — KPIs, trends, breakdowns | Read |
| `get_chart_definitions` | Available chart types and required fields | Read |
### Opportunity Insights (10)

Customer intelligence. `continuation_data` is shared across this family:
when a response is truncated, it fetches the next batch using the `continuation_id` from
`__metadata`.

Names resolve server-side, so call the matching data tool directly with the labels you already
use. Audience and vertical discovery are optional fallbacks for selection or disambiguation.

#### Customer Pulse (10)

[Customer Pulse](https://app.zetaglobal.net/opportunities/customer_pulse?opportunity_type=customer) · [Knowledge Base](https://knowledgebase.zetaglobal.com/kb/customerpulse)

First-party customer data. Pass the report-friendly label (`_segment_name` /
`friendly_segment_name`) that the discovery tool returned, verbatim.

| Tool | What it does | Access |
| --- | --- | --- |
| `customer_pulse_audiences` | Customer Pulse audiences by segment date | Read |
| `customer_pulse_verticals` | Available Customer Pulse verticals | Read |
| `customer_pulse_coverage` | Addressability, reachability, preferred channels, social presence | Read |
| `customer_pulse_demographics` | Ethnicity, state, ZIP, age, gender, income | Read |
| `customer_pulse_psychographics` | Persona values, motivations | Read |
| `customer_pulse_transactions` | Purchase and transaction interests | Read |
| `customer_pulse_visitation` | Physical visitation interests | Read |
| `customer_pulse_content_consumption` | Content, topics and online interests customers engage with | Read |
| `customer_pulse_financial_household` | Financial profile and household attributes | Read |
| `continuation_data` | Next batch of a truncated Customer Pulse response | Read |

### Account (1)

[Home](https://app.zetaglobal.net/home) · [Knowledge Base](https://knowledgebase.zetaglobal.com/kb/quick-start-guides)

| Tool | What it does | Access |
| --- | --- | --- |
| `get_current_user_account` | Active ZMP site id for this session | Read |


## Troubleshooting

| What you see                                                               | What it means                                                                                                                                                       |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Could not resolve marketplace, or repository not found`                   | Confirm that `zetaglobal/athena-skills` is available and that your network can reach GitHub, then retry.                                                            |
| `could not read Username for 'https://github.com'`                         | Your local Git is not authenticated to GitHub. Sign in with the GitHub CLI or add an SSH key, then retry.                                                           |
| `Sign-in succeeds, but no tools appear`                                    | Your ZMP account has not been granted Athena by Zeta MCP access. Zeta grants it per account. Contact your Zeta Global account team.                                 |
| Skills installed, but the client says it has no tools                      | Authentication did not finish, or a client-specific connector step was skipped. Complete MCP authentication and follow the setup instructions above.                |
| A skill reports that a tool it needs is missing                            | Your account may not have that tool enabled. Contact Zeta.                                                                                                          |
| Sign-in never completes, or the connection times out                       | Contact Zeta. This is a gateway or OAuth configuration issue, not something you can fix locally.                                                                    |
| An update installed but nothing changed                                    | Confirm the published plugin version was incremented. Plugin managers compare version numbers, not file contents. Restart clients that load plugins only at launch. |
| In Claude Desktop, the plugin installed but its connector will not turn on | Add the gateway separately under **Settings → Connectors**, run the connector helper, and restart the app. An organization administrator may need to approve it.    |
| Insights Studio says it cannot build a useful briefing                     | This is expected when the selected data is empty or unsuitable. Try a different period, business goal, or dataset.                                                  |

## FAQ

| Question                                                                              | Answer                                                                                                                                                                    |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which ZMP account does the plugin, its skills, and Athena by Zeta MCP use?            | The account you most recently accessed in browser-based ZMP is the account Athena by Zeta MCP uses.                                                                       |
| How do I change which ZMP account the plugin, its skills, and Athena by Zeta MCP use? | Use the account switcher in ZMP in a web browser.                                                                                                                         |
| Does an AI model modify Zeta Global's data?                                           | No. The currently exposed tools are read-only. AI models may read aggregated data and insights within your existing ZMP access but cannot modify them.                    |
| What is sent to my AI agent, such as ChatGPT or Claude?                               | Aggregated outputs of Zeta insights, not raw data assets. Analysis remains inside ZMP, and the assistant presents the results without altering them.                      |
| Is this different from using Athena inside ZMP?                                       | The same Zeta data, tools, and models are used. In ZMP, Zeta provides the AI model. With Athena by Zeta MCP, the tools run in your assistant under your provider account. |
| Does my AI provider train its models on my data?                                      | The retention and training terms are governed by your contract with that provider, not Zeta Global's contract.                                                            |
| Can I access another brand's or a competitor's data?                                  | No. Every request is scoped to your account before reaching a data service, and neither you nor the AI model can change that scope.                                       |
| What can my AI assistant actually call?                                               | A fixed, approved subset of Athena tools. Your assistant has no visibility into unexposed reports and cannot call them.                                                   |

## Getting help

Contact your Zeta representative for help with setup, access, and tool availability for your account.

[ZMP home](https://app.zetaglobal.net/home) · [Zeta Knowledge Base](https://knowledgebase.zetaglobal.com/kb/quick-start-guides)
