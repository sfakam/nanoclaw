<!-- Installed from marketplace plugin: sdlc/tcore-suiteseal -->
<!-- MCP tools are available via the nanoclaw-plugins MCP server. -->
<!-- If a tool is shown as mcp__<server>__<tool>, use mcp__nanoclaw-plugins__<tool> instead. -->
<!-- Marketplace scripts are available at /marketplace/plugins/sdlc/ (e.g. scripts/, skills/, servers/) -->

---
name: tcore-suiteseal
description: >
  Use this skill whenever the user wants to create a new SuiteSeal document in Confluence from the template or update an existing SuiteSeal Confluence page by following embedded agent instructions. Triggers include: "fill in the SuiteSeal", "create a new SuiteSeal page", "create a SuiteSeal page from the template", "update the SuiteSeal page", "use the template to make a new SuiteSealpage", or any request involving reading a SuiteSeal Confluence template and producing a populated SuiteSeal page. Also use when the user references a specific Confluence page ID or URL that has SuiteSeal in the page title and wants to create or update content from it. Always use this skill — do not attempt Confluence workflows without it. Also use when the user wants to retire or delete an existing SuiteSeal page, remove its Jira label, or move it to a Retired archive. Triggers include: "retire the SuiteSeal", "delete the SuiteSeal page", "move this SuiteSeal to retired".

argument-hint: "[create|update|delete|retire] <team-name|page-title>"
---
 
# Confluence Template Agent Skill
 
This skill reads a Confluence page that contains embedded `<!-- AGENT: -->` HTML comment
instructions, follows those instructions to populate the page content, and either creates
a new page or updates an existing one.
 
---
 
## Modes
 
Determine mode from user input:
 
| Mode                | Trigger                                                                                                                                                                                                              | MCP call at end                                                                    |
|---------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------|
| **create**          | User provides new page details and parent information, agent infers a title, discovers the parent page_id, and uses the template page at page_id 1398553936 to create a new page                                     | `confluence_create_page_xhtml`                                                     |
| **update**          | User provides an existing title to update in-place, agent reads template (1398553936) for AGENT instructions, and agent discovers the page_id to update; generates page content from template instructions           | `confluence_update_page_xhtml`                                                     |
| **delete / retire** | User provides an existing SuiteSeal page title or page_id to retire; agent reads the page to extract suite_label, strips labels from Jira, removes the status page row, and moves the page to a Retired archive page | `confluence_create_page` (if Retired page doesn't exist), `confluence_update_page` |
 
In **create** mode, the template page is read-only — its instructions guide the new page.
In **create** mode, always proceed as if no related pages exist. Do not search for or reference existing Confluence pages with similar names to anchor the title or parent — the only Confluence lookup is finding the suite context parent page by name (see Step 1). Even if a page named "Orchestration Team Smoke" exists, it has no bearing on creating "Orchestration Team Smoke2".
In **update** mode, the target page carries current content and context for the page version and JQL.
 
---
 
## Step-by-Step TCoRe Workflow
 
### 1. Gather Invocation Parameters
 
Before doing anything, confirm you have:
 
- `source_page_id` — the template page to read instructions from
- `mode` — `create`, `update`, `delete`, or `retire` (see Modes above)
- If no `new_page_title` is provided in create mode, infer one from the user input (see **Title Inference** below) and confirm with the user before proceeding.
- If no `parent_page_id` is provided in create mode, infer the parent from the suite context (see **Parent Inference** below); if still unclear, ask.
- If **create**: `new_page_title`, `parent_page_id` (and optionally `space_key` - use SELO if not provided)
- If **update**: `target_page_id`
- If **update**: and no `jql_query` is provided find the existing page, get the existing JQL, and re-execute it to get the most up-to-date context for the page
- If **delete / retire**: `target_page_id` (or title — resolve to page_id via search if needed); no other inputs required
- Any **context inputs** the user has provided (project name, owner, dates, etc.) — store these; instructions may reference them
- `new_page_title` or `page_title` must always end with ' [PLX QA&A TCoRe]' to ensure proper tagging and discoverability in Confluence
If any required parameter is missing, ask before proceeding.

#### Title Inference (create mode)

The page title is the **name the user gives to the coverage** — extracted from how they describe what the page is called or covers. It is never derived from JQL filter labels.

| Prompt pattern                                                                 | Extracted title (before suffix) |
|--------------------------------------------------------------------------------|---------------------------------|
| "…for Orchestration Team Smoke2 coverage"                                      | `Orchestration Team Smoke2`     |
| "…named Orchestration Team Smoke2…"                                            | `Orchestration Team Smoke2`     |
| "details the DART ALSI suite for Orchestration Team Smoke2 coverage"           | `Orchestration Team Smoke2`     |
| "suiteseal page for dart alsi named Orchestration Team Smoke2 using this JQL…" | `Orchestration Team Smoke2`     |
| "NCFW E2E Sanity Suite"                                                        | `NCFW E2E Sanity Suite`         |

Append ` [PLX QA&A TCoRe]` to produce the full title. Confirm the inferred title with the user if there is any ambiguity.

When in doubt ASK - prompt the user to confirm the title or provide it explicitly. Do not attempt to guess if the prompt is unclear.

#### Parent Page Inference (create mode)

The **suite context** (e.g., "DART ALSI", "NCFW E2E") in the user's prompt identifies the parent page — it is not part of the title.

1. Extract the suite context from the prompt (e.g., "DART ALSI suite" → `DART ALSI`).
2. Search SELO for `{suite context} [PLX QA&A TCoRe]` to get the parent page ID.
3. **Do not** use existing pages with similar team or coverage names as the parent anchor. A page named "Orchestration Team Smoke" is unrelated to a new "Orchestration Team Smoke2" page.
4. When in doubt - ASK. Prompt the user to confirm the parent page or provide a page ID.

Typical hierarchy: `By Suite [PLX QA&A TCoRe]` → `{Suite Context} [PLX QA&A TCoRe]` → new page.

If no suite context is present in the prompt, ask the user for the parent page title or ID before proceeding.

### 2. Read the Source Page

In create mode, read only the template page.
In update mode, read the template page and the target page in parallel — the template provides AGENT instructions, the target provides the current version number and JQL.

Call `confluence_get_page` with `include_storage_format: true` to get the raw Confluence
storage-format HTML. This is essential — the rendered view strips HTML comments.

In both modes:
```
tool: confluence_get_page
args:
  page_id: 1398553936
  include_storage_format: true
```

In update mode, also get the target page in parallel:
```
tool: confluence_get_page
args:
  page_id: <target_page_id>
  include_storage_format: true
```
 
Store the full raw template HTML as `source_html`.
 
### 3. Parse AGENT Comment Blocks

AGENT comments are always parsed from the template page, not the target page.

Scan `source_html` for all comment blocks matching this pattern:
 
```
<!-- AGENT
  section: <section_name>
  field: <field_name>
  required: <true|false>
  source: <user_input|context|lookup|infer>
  lookup_query: <optional: MCP call or search hint>
  prompt: <instruction for Claude>
  format: <optional: plain|rich|table|list|date>
  max_words: <optional integer>
-->
```
 
Build an ordered list of instruction objects. Each one maps to a `section` (a heading or
named region in the page) and a `field` (the specific placeholder within that section).
 
See `references/comment-schema.md` for full field definitions and examples.
 
### 4. Resolve Each Field
 
For each instruction block, in document order:
 
1. Check `source`:
   - `user_input` — use what the user already provided; if absent, ask
   - `context` — infer from conversation context or previously resolved fields
   - `infer` — use Claude's judgment based on surrounding page content
   - `lookup` — call the MCP tool or search indicated in `lookup_query`
2. Follow the `prompt` instruction to generate or retrieve the field value.
3. Respect `format` and `max_words` constraints.
4. If `required: true` and you cannot resolve the value, stop and ask the user.
Track all resolved fields in a `resolved_fields` map: `{ section.field → value }`.
 
### 5. Build the Output HTML

**NEVER use Markdown table syntax (`| col | col |`) in XHTML output. All tables must use `<table><tbody><tr><th>/<td>` HTML tags (see patterns below). Markdown pipe tables are not valid Confluence storage format and will render as raw text.**

Start from `source_html`. For each resolved field:

- Locate all instances of the special placeholder in the HTML:
  ``` __suiteseal_template___
  ```
  And replace with the `new_page_title` or `page_title` provided by the user, ensuring it ends with ' [PLX QA&A TCoRe]'
- Locate its placeholder in the HTML. Placeholders follow this convention:
  ```placeholder_field_name
  ```
- Replace the placeholder with the resolved value, applying the correct Confluence storage-format markup for the field's `format` type.
- When writing the output, omit all <ac:structured-macro ac:name="html"> CDATA blocks from the payload.

#### Table Markup Patterns

Use these patterns whenever a field's `format` is `table` or the resolved value contains tabular data.

**2-column metadata table** (key/value pairs, bold label column — used for report header blocks):
```html
<table><tbody>
  <tr><th><strong>Report Generated On</strong></th><td>2026-05-18</td></tr>
  <tr><th><strong>Report Type</strong></th><td>suite</td></tr>
  <tr><th><strong>Description</strong></th><td>Smoke test suite coverage</td></tr>
</tbody></table>
```

**Multi-column data table** (header row with `<th>`, data rows with `<td>` — used for test case inventories and state summaries):
```html
<table><tbody>
  <tr><th>State</th><th>Count</th></tr>
  <tr><td>QA Accepted Automation</td><td>0</td></tr>
  <tr><td>QA Accepted Manual</td><td>4</td></tr>
</tbody></table>
```

### 6. Create or Update
 
**Create mode:**
```
tool: confluence_create_page_xhtml
args:
  space: <space_key>
  parent_id: <parent_page_id>
  title: <new_page_title>
  content: <output_html>
```
 
**Update mode:**
```
tool: confluence_update_page_xhtml
args:
  page_id: <target_page_id>
  title: <existing or updated title>
  content: <output_html>
  version_number: <version from step 2>
```

### 7. Execute Post-Publish Workflows

After the MCP call in Step 6 succeeds, scan the template page (1398553936) for
`AGENT-WORKFLOW` blocks and execute each one in document order. Each block is
self-contained — its `depends_on` fields reference values already in `resolved_fields`
from Steps 3–5; no re-fetching is needed.

#### 7a. Label Sync

Two `AGENT-WORKFLOW` blocks in the template handle Jira label maintenance using
`resolved_fields` values. Execute them as instructed.

#### 7b. Refresh Test Suite Status Page

A third `AGENT-WORKFLOW` block directs the agent to page 1337100667. The live
page may be recreated by an external service and should not be relied upon to
carry `AGENT` instructions. Instead, read the instructions from the stable
template page (1409218361):

```
tool: confluence_get_page
args:
  page_id: 1409218361
  include_storage_format: true
```

Follow the `AGENT` instructions found there to update and publish page 1337100667.

#### 7c. Confirm and Report

After all workflows complete, report:

- The new/updated SuiteSeal page URL
- Count of Jira issues labeled (and un-labeled, if any)
- Confirmation that the Test Suite Status page was updated
- Any fields that were skipped (not required, no value found) — flagged clearly

### 8. Delete / Retire Workflow (delete / retire mode only)

Skip Steps 2–7. Execute the following sequence instead:

#### 8a. Read the Target Page

```
tool: confluence_get_page
args:
  page_id: <target_page_id>
  include_storage_format: true
```

Extract from the page:
- `suite_label` — from the Suite Label row of the metadata table

If `suite_label` is missing, search the Test Suite Status page (1337100667) for a row whose "Test Suite Name" matches the page title. 
If a matching row is found, use its "Test Suite Label" value as `suite_label`. 
If no matching row is found, skip Jira label removal and Status page update, and proceed to page move.

#### 8b. Remove Label from Jira Issues

Search Jira for all issues carrying `suite_label`:
```
jql: labels in ({suite_label})
```

For each issue returned, call `update_issue` with the full label set minus `suite_label`.
If the search returns 0 results, skip silently.

#### 8c. Remove Row from Test Suite Status Page

Read page 1337100667 (current version + content).

Remove the row where "Test Suite Label" = `suite_label` or "Test Suite Name" matches the page title. 
If no matching row is found, skip to step 8d silently.

Recompute the Totals row and Overview table (Total Suites, Active Suites, % Automated).
Publish via `confluence_update_page_xhtml`.

#### 8d. Move Page to Retired Archive

1. Get the target page to identify its parent:
  ```
  tool: confluence_get_page
  args:
    page_id: <target_page_id>
  ```

If the response includes parent/ancestor metadata, extract the platform `parent_page_id` and `parent_title` (e.g., `DART ALSI [PLX QA&A TCoRe]`). If not, call `confluence_list_child_pages` on the known SuiteSeal root (1256464331) and its platform children to locate which platform page is the direct parent.

2. Derive the platform name by stripping ` [PLX QA&A TCoRe]` from the parent title (e.g., `DART ALSI`).

3. Search for a Retired page under the platform parent:
  ```
  tool: confluence_search_pages
  args:
    query: title = "Retired [PLX QA&A TCoRe {platform}]"
    space: SELO
  ```

- If found: capture its `page_id` as `retired_parent_id`
- If not found: create it as an empty child of the platform page:
  ```
  tool: confluence_create_page
  args:
    space: SELO
    parent_id: <platform_page_id>
    title: "Retired [PLX QA&A TCoRe {platform}]"
    content: ""
  ```
  Use the returned `page_id` as `retired_parent_id`.

4. Move the SuiteSeal page by re-parenting it:
  ```
  tool: confluence_update_page
  args:
    page_id: <target_page_id>
    parent_id: <retired_parent_id>
    title: <existing title, unchanged>
    version_number: <current version>
  ```

Note: if `confluence_update_page` does not support `parent_id`, the move cannot be done via MCP. In that case, provide the Confluence UI link and instruct the user to move it manually to the Retired page.

#### 8e. Confirm and Report

Report:
- Count of Jira issues un-labeled
- Confirmation that the status page row was removed and totals updated
- URL of the Retired page (new or existing)
- Confirmation of page move, or manual move instruction if the MCP does not support parent changes

---

## Error Handling
 
| Situation | Action |
|-----------|--------|
| `confluence_get_page` returns no storage HTML | Abort; tell user to confirm the page ID and that storage format is enabled |
| No `<!-- AGENT` comments found | Warn the user — the page may not be a template; ask to proceed anyway or abort |
| Required field cannot be resolved | Pause workflow, ask user for the value, then resume |
| MCP create/update fails with conflict | Retry once with `version_increment: true`; if still failing, report the error verbatim |
 
---
 
## Reference Files
 
Read these when you need them — don't load them all upfront:
 
- `references/comment-schema.md` — Full field definitions, all valid values, and annotated examples of AGENT comment blocks
- `references/placeholder-substitution.md` — Confluence storage-format markup patterns for each `format` type (rich text, tables, date macros, user mentions, etc.)
- `assets/example-template.html` — A complete example template page in Confluence storage format, with AGENT comments and placeholders, for reference or testing