<!-- Installed from marketplace plugin: sdlc/confluence -->
<!-- MCP tools are available via the nanoclaw-plugins MCP server. -->
<!-- If a tool is shown as mcp__<server>__<tool>, use mcp__nanoclaw-plugins__<tool> instead. -->
<!-- Marketplace scripts are available at /marketplace/plugins/sdlc/ (e.g. scripts/, skills/, servers/) -->

---
name: confluence
description: Search, read, create, and update Confluence pages. Use for architecture docs, design decisions, runbooks, or ADRs.
argument-hint: "[search query|page title]"
user-invocable: false
---

Search and read Confluence pages using the Confluence MCP tools.

## Arguments

Arguments: $ARGUMENTS

Parse the arguments:
- If empty → ask what to search for
- If text → run `search_pages` with the text as query

## Available Operations

You have access to these Confluence MCP tools:
- `search_pages` — CQL text search across spaces
- `get_page` — get page content as markdown by page ID
- `get_page_by_title` — find page by exact title in a space
- `list_child_pages` — list children of a page
- `get_page_labels` — get labels on a page
- `search_by_label` — find pages by label (e.g., architecture, adr, runbook)
- `resolve_page_path` — resolve a path like "Architecture > API Gateway > Design" to a page ID
- `create_page` — create a new page (by parent ID directly, or use `resolve_page_path` first)
- `update_page` — update an existing page's content

## Tips

- Search by label for broad discovery: `search_by_label "architecture"`
- Use `get_page_by_title` when you know the exact page name
- Use `list_child_pages` to explore a documentation tree
- Page content is returned as markdown — Confluence XHTML is converted automatically
- Write content in markdown — it's automatically converted to Confluence storage format
- When updating, you need the current version number (from `get_page`)
