# Athena Chat mode

Use the Athena chat already embedded in ZMP as a read-only browser bridge. The user's wording after
"ask Athena", "tell Athena", "have Athena", or "use Athena to" is the query to forward when it is
read-only. Do not turn this into a Knowledge Base search and do not pretend a gateway tool performed
the result.

1. Load `references/zmp-nav.md`, resolve the environment from the account lookup's MCP server,
   and select that environment's existing ZMP tab in the built-in browser. Preserve the tab's
   current page because Athena receives useful page context. If there is no matching tab, open
   `/home` on the resolved host.
2. Follow the authenticated-session and stale-tab recovery contract in `references/zmp-nav.md`.
   Never enter credentials or switch away from a browser the user explicitly selected.
3. Follow that reference's Athena Chat controls to record the current URL, visible page heading,
   and prior response boundary, then open the panel if needed and submit through the freshly
   inspected accessible controls.
4. Forward the user's query faithfully. The explicit request to "ask Athena" authorizes sending
   that query to the embedded assistant. Do not silently add customer data, files, conversation
   history, credentials, or other sensitive context. If sending required context would transmit
   sensitive data not explicitly included for this purpose, stop for confirmation.
5. Wait for completion and read only messages added after the recorded boundary, as specified in
   the reference. Do not relay a partial streaming fragment as the final answer.
6. Athena may ask a clarification or offer numbered choices. Answer autonomously when exactly one
   choice is directly implied by the user's request or by visible page context, and continue until
   Athena completes or needs information only the user can supply. Keep follow-ups narrow and never invent business criteria. Cap autonomous clarification
   at three consecutive follow-ups; then return the unresolved question to the user instead of
   looping.
7. Never approve or carry out create, update, launch, send, publish, delete, overwrite, spend,
   permission, credential, configuration, or other data-changing actions. If Athena proposes one,
   stop, state that the plugin is read-only, and offer instructions or navigation only. Routine
   navigation and read-only exploration may continue without babysitting.
8. After Athena finishes, inspect the live page again. Compare URL, heading, and relevant visible
   state with the pre-submit snapshot. Relay Athena's completed response, then separately report
   the page context and any navigation or read-only result you directly verified. If Athena claims
   a result but the page does not prove it, label it as Athena's claim rather than verified.

Keep the interaction seamless: do not narrate every click, ask the user to keep watching, or hand
back routine clarifications. Leave the final ZMP tab open on the resulting page.
