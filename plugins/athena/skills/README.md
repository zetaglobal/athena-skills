# Athena by Zeta skills

Athena by Zeta skills provide marketing-intelligence workflows run through Athena by Zeta MCP.

| Skill | What it does |
| --- | --- |
| [opportunities-customer-pulse-executive-briefing](opportunities-customer-pulse-executive-briefing/SKILL.md) | Fast Customer Pulse questions, default executive audience briefs, comparisons, full-data tables, and optional self-contained HTML summaries. |
| [analytics-insights-studio-executive-briefing](analytics-insights-studio-executive-briefing/SKILL.md) | Fast Insights Studio questions and conversational executive briefings with bounded live-data calls, period comparisons, one useful trend, one useful breakdown, and optional self-contained HTML. |
| [help](help/SKILL.md) | This: what the skills do, and how-to answers from the Zeta Knowledge Base. |

### Example questions

- "Give me a customer pulse briefing for our recent purchasers segment."
- "Compare these two segments side by side."
- "Where are our customers concentrated, and which markets are underserved?"
- "Where are competitors crowding us out?"
- "Build an Insights Studio briefing for our email engagement dataset."
- "How did revenue trend last month, and break it down by channel?"
- "What can these skills do?"
- "How do I create a campaign in ZMP?"

Briefing skill directories are named `<area>-<product>-<job>`. The plugin-level `help`
router is the documented exception.

More areas are in development.

Each skill directory holds:

- `SKILL.md` — trigger description, tool boundaries, and procedure. Artifact skills also
  document their template placeholder mapping.
- `evals/evals.json` — behavioral evals (prompt + expected tool sequence and output).

Artifact-producing skills also hold `template.html`, a self-contained, print-ready HTML
file with `{{PLACEHOLDER}}` tokens.
