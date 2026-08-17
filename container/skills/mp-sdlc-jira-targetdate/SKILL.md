<!-- Installed from marketplace plugin: sdlc/jira-targetdate -->
<!-- MCP tools are available via the nanoclaw-plugins MCP server. -->
<!-- If a tool is shown as mcp__<server>__<tool>, use mcp__nanoclaw-plugins__<tool> instead. -->
<!-- Marketplace scripts are available at /marketplace/plugins/sdlc/ (e.g. scripts/, skills/, servers/) -->

---
name: jira-targetdate
description: Review open epics' target dates and progress indicators, flag overdue/missing, and interactively update them
allowed-tools: mcp__plugin_platform-common_akamai-jira__search_issues, mcp__plugin_platform-common_akamai-jira__update_issue
---

# Jira Target Date Review

Review all open epics assigned to the current user, flag overdue or missing target dates, and interactively update them.

## Step 1 — Fetch Epics

Use `search_issues` with:
- **jql**: `assignee = currentUser() AND issuetype = Epic AND status not in (Closed, Done, Resolved, Cancelled) ORDER BY key ASC`
- **fields**: `summary,status,customfield_10300,customfield_16603`
- **maxResults**: 50

## Step 2 — Present Table

Build a markdown table with these columns:

| Key | Epic Name | Status | Progress | Target End | Flag |
|-----|-----------|--------|----------|------------|------|

For each epic in the results:
- **Key**: `issue.key`
- **Epic Name**: `fields.summary`
- **Status**: `fields.status.name`
- **Progress**: Extract from `fields.customfield_10300`. If present, use `customfield_10300.value` — strip any HTML tags to get the plain value (e.g., "Green", "Yellow", "Red"). If null, show "—".
- **Target End**: `fields.customfield_16603` (date string like "2026-03-31"). If null, show "—".
- **Flag**: Determine using today's date from the `currentDate` context variable:
  - **`OVERDUE`** — target end date exists and is before today
  - **`NO DATE`** — target end date is null or missing
  - Otherwise leave blank

Display the table to the user.

## Step 3 — Interactive Updates for Flagged Epics

Collect all epics flagged as `OVERDUE` or `NO DATE`.

If there are no flagged epics, report that all epics are on track and stop.

For each flagged epic, use `AskUserQuestion` to ask:
- Question: "**[KEY]** — [Summary] is flagged [FLAG]. What would you like to update?"
- Options:
  1. **Update Progress Indicator** — then ask which color: Green / Yellow / Red
  2. **Update Target End Date** — then ask for a date (YYYY-MM-DD format)
  3. **Update both** — ask for color and date
  4. **Skip this epic**

Collect all responses before applying any updates.

## Step 4 — Apply Updates

For each epic the user chose to update, call `update_issue` with the appropriate `customFields`:

**Target End Date:**
```json
{
  "customFields": {
    "customfield_16603": "YYYY-MM-DD"
  }
}
```

**Progress Indicator:**
```json
{
  "customFields": {
    "customfield_10300": {"id": "<optionId>"}
  }
}
```

Option ID mapping:
- Green: `10102`
- Yellow: `10101`
- Red: `10100`

**Both:** merge both fields into a single `customFields` object in one `update_issue` call.

After each update, report success or failure. When all updates are done, display a summary of what was changed.
