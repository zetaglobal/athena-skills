# Athena by Zeta - Agent Plugin (Beta)

Athena by Zeta - Agent Plugin (Beta) has two integrated parts:

- **skills** provide out-of-the-box workflows that teach an AI agent how to use Athena tools
  for specific jobs (see [`skills/`](skills/README.md)).
- **Athena by Zeta MCP** exposes the approved Athena tools through the gateway's virtual server.

The bundled skills choose and coordinate the MCP tools, validate their outputs, and structure
the response so users can start with a plain-language request.

## Authentication

The connector authenticates by **browser OAuth** against the gateway (see
[`.mcp.json`](.mcp.json)). On first use the client opens a Zeta sign-in tab; approve
it once and the client remembers you (tokens refresh silently). There is no token to
paste and no connector restart. The gateway derives run-context (site/account) from
your identity, so tools that need a site work without extra setup.

**Claude Desktop needs one manual step first.** Installing this plugin registers the
`athena` connector but cannot authorize it — the **Install** button on the plugin's
Connectors tab is inert. Wire it from a clone of the repo with
`node scripts/add-desktop-connector.mjs`, then restart Desktop; or add it by hand at
Settings -> **Connectors** -> **Add custom connector**, named `athena`, using the
gateway URL from [`.mcp.json`](.mcp.json). Until you do, the skills appear in the
slash-command list but their gateway tools are missing — every briefing skill detects this in
Phase 0 and tells you how to connect rather than producing an empty briefing. Full
walkthrough: [`../../docs/athena-mcp.md`](../../docs/athena-mcp.md#claude-desktop-chat-app).

In Claude Code this is not needed: `/mcp` authenticates `athena` directly.

See [`../../docs/athena-mcp.md`](../../docs/athena-mcp.md#gateway-endpoint) for the
non-interactive / CI fallback and details.

## Install

**Claude Code / Claude Desktop**

```
/plugin marketplace add zetaglobal/athena-skills
/plugin install athena@zetaglobal
```

The public distribution repository is `zetaglobal/athena-skills`.

**Cursor** — add the marketplace from `.cursor-plugin/marketplace.json` (same skills,
same OAuth URL).

**GitHub Copilot CLI**

```
copilot plugin marketplace add zetaglobal/athena-skills
copilot plugin install athena@zetaglobal
copilot plugin list
copilot mcp list
```

**ChatGPT** — configure a custom connector pointed at the same gateway URL; see
[`../../docs/athena-mcp.md`](../../docs/athena-mcp.md#chatgpt-enterprise).

## What it wires

- MCP server `athena` -> the gateway virtual server (`/virtual/athena-mcp/mcp`) over
  streamable HTTP with OAuth. All Athena by Zeta MCP tools exposed to the authenticated account are
  read-only and available through it.
- Two read-only briefing skills that answer in conversation by default and render
  executive-ready HTML only when explicitly requested.
- A read-only `help` skill that catalogs the plugin, navigates ZMP, relays read-only questions
  to Athena Chat, and searches the public Zeta Knowledge Base for grounded how-to answers.
