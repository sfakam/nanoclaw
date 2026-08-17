<!-- Installed from marketplace plugin: sdlc/roadmap-report -->
<!-- MCP tools are available via the nanoclaw-plugins MCP server. -->
<!-- If a tool is shown as mcp__<server>__<tool>, use mcp__nanoclaw-plugins__<tool> instead. -->
<!-- Marketplace scripts are available at /marketplace/plugins/sdlc/ (e.g. scripts/, skills/, servers/) -->

---
name: roadmap-report
description: Generate a 3-quarter capability roadmap report for a team and publish it to Confluence. Auto-detects the current quarter from today's date, searches Jira for the matching BAU capability tickets, evaluates epic health and Q+1 slip candidates, generates a local PLX capability markdown report via jira_report.py, and uses that markdown as the primary source for roadmap planning.
argument-hint: "<team-name> [confluence-parent-page-id]"
allowed-tools: mcp__plugin_platform-common_akamai-jira__get_issue, mcp__plugin_platform-common_akamai-jira__search_issues, mcp__plugin_platform-common_akamai-confluence__search_pages, mcp__plugin_platform-common_akamai-confluence__get_page, mcp__plugin_platform-common_akamai-confluence__get_page_by_title, mcp__plugin_platform-common_akamai-confluence__create_page, mcp__plugin_platform-common_akamai-confluence__update_page, mcp__plugin_platform-common_akamai-confluence__list_child_pages, Bash
---

# Roadmap Report Skill

Generate a 3-quarter capability roadmap report for a C2 team, then publish it to Confluence.

## Arguments

Arguments: $ARGUMENTS

Parse as positional:
1. `TEAM_NAME` — display name used in Jira capability summaries, e.g. `C2` or `Customer Experience`
2. `CONFLUENCE_PARENT_ID` *(optional)* — Confluence page ID to publish under. If omitted, search SELO space for the `<TEAM_NAME>` team home page.

If `TEAM_NAME` is missing, ask for it before proceeding.

---

## Team Context

Use this table to resolve the Confluence parent page and additional Jira filter for a given `TEAM_NAME`. Match case-insensitively on the Team column.

| Team | Confluence Roadmap Parent Page ID | Additional Capabilities Filter ID |
|------|----------------------------------|-----------------------------------|
| C2 | 1244661384 | 309911 |

> **Adding a team:** Add a row with the team's display name (as used in `/roadmap-report` invocations), the Confluence page ID of the team's roadmap/planning parent page, and the Jira saved filter ID that returns all capabilities the team is involved in.

When a match is found in this table:
- Use the **Confluence Roadmap Parent Page ID** as `CONFLUENCE_PARENT_ID` (overrides the search fallback).
- Use the **Additional Capabilities Filter ID** in Step 4 to supplement capability discovery (see below).

## Team Name Aliases (BAU Search Fallback)

Use these aliases when Step 1 BAU searches return no results for a quarter.

| Team | Aliases to try |
|------|----------------|
| C2 | `C2C`, `C2 - Command And Control` |

---

## Custom Field Reference

| Field | ID | Notes |
|-------|----|-------|
| Target Start | `customfield_16602` | Date `YYYY-MM-DD` |
| Target End | `customfield_16603` | Date `YYYY-MM-DD` |
| Progress Indicator | `customfield_10300` | Green id `10102`, Yellow id `10101`, Red id `10100` |
| Parent Link | `customfield_16601` | Issue key string |
| Executive Summary | `customfield_10504` | Free-text |
| Team | `customfield_16600` | Numeric string |

---

## Step 0 — Derive Quarter Labels from Today's Date

Compute the current quarter from today's date, then derive Q_NEXT and Q_PLUS2:

| Month | Current Quarter | Q_NEXT | Q_PLUS2 |
|-------|----------------|--------|---------|
| Jan–Mar | Q1 YYYY | Q2 YYYY | Q3 YYYY |
| Apr–Jun | Q2 YYYY | Q3 YYYY | Q4 YYYY |
| Jul–Sep | Q3 YYYY | Q4 YYYY | Q1 YYYY+1 |
| Oct–Dec | Q4 YYYY | Q1 YYYY+1 | Q2 YYYY+1 |

Set:
- `Q_CURRENT_LABEL` e.g. `Q2 2026`
- `Q_NEXT_LABEL` e.g. `Q3 2026`
- `Q_PLUS2_LABEL` e.g. `Q4 2026`
- `Q_CURRENT_DATE_RANGE` e.g. `Apr–Jun 2026`
- `Q_NEXT_DATE_RANGE` e.g. `Jul–Sep 2026`
- `Q_PLUS2_DATE_RANGE` e.g. `Oct–Dec 2026`

---

## Step 1 — Locate BAU Capability Tickets in Jira

Search for the three BAU capability tickets automatically. Run all three searches in parallel:

```
search_issues(
  jql: 'project = PLX AND issuetype = Capability AND summary ~ "BAU" AND summary ~ "<Q_CURRENT_LABEL>" AND summary ~ "<TEAM_NAME>"',
  fields: "summary,status,assignee,customfield_16602,customfield_16603",
  maxResults: 5
)
```

Repeat for `Q_NEXT_LABEL` and `Q_PLUS2_LABEL`.

If a quarter returns no match on the first search using `TEAM_NAME`, retry the same quarter search in order with each alias from the **Team Name Aliases** table for that team.

Example retry pattern for a missing quarter:
- first: `summary ~ "<TEAM_NAME>"`
- then: `summary ~ "<ALIAS_1>"`
- then: `summary ~ "<ALIAS_2>"`

Only after all aliases fail should the quarter be marked as "Not yet created".

The BAU capability summary pattern is: `[BAU][OTHER TECH] <Q_LABEL> BAU/KTLO - <TEAM_NAME>`

Pick the best match from each result set (exact quarter + team name). If no match is found for a quarter, note it as "Not yet created" and continue — do not block the report.

Set `Q_CURRENT_KEY`, `Q_NEXT_KEY`, `Q_PLUS2_KEY` from the matched issue keys.

---

## Step 2 — Fetch Epics and Build Local Capability Source

Run all of the following in parallel once the three keys are known:

1. **Epics under `Q_CURRENT_KEY`:**
   ```
   jql: '"Parent Link" = <Q_CURRENT_KEY> AND issuetype = Epic ORDER BY status ASC'
   fields: summary,status,assignee,customfield_16602,customfield_16603,customfield_10300,customfield_10504
   maxResults: 100
   ```

2. **Epics under `Q_NEXT_KEY`** (same fields).

3. **Epics under `Q_PLUS2_KEY`** (same fields).

4. **Generate local capability markdown** using `jira_report.py` and save to:
   - `CAP_REPORT_MD_PATH=/tmp/capability-report-<TEAM_NAME>-<TODAY_YYYY-MM-DD>.md`

   ```bash
   cd "/marketplace/plugins/platform-common/servers/jira-mcp" && \
   uv run python3 "/marketplace/plugins/sdlc/scripts/jira_report.py" \
     --report-type capability \
     --days 365 \
     --output "$CAP_REPORT_MD_PATH"
   ```

5. **Confluence parent page** — use the **Confluence Roadmap Parent Page ID** from the Team Context table if the team is listed there. Otherwise, if `CONFLUENCE_PARENT_ID` was passed as an argument use that. As a last resort, `search_pages(query="<TEAM_NAME> team", space="SELO")`.

6. **Additional capabilities filter** *(if team has one in the Team Context table)* — run the `search_issues` filter query from Step 4 / Source B in parallel here so results are ready when Step 4 runs.

---

## Step 3 — Classify Q_CURRENT Epics

Assign each epic under `Q_CURRENT_KEY` to one of four buckets.

**Evaluation order: check Bucket C conditions exhaustively for every epic before assigning any epic to Bucket B. An epic may not be assigned to Bucket B if it meets any Bucket C condition, regardless of Progress Indicator color.**

### Bucket A — Done (omit from report)
- Status: `Closed` or `Cancelled`

### Bucket C — At Risk / Q+1 Slip Candidates (evaluated first)
Any of:
- Progress Indicator is **Yellow** (`10101`) or **Red** (`10100`)
- `customfield_10504` contains any of (case-insensitive): *slip*, *slipping*, *Q3*, *Q4*, *deprioritized*, *blocked*, *no timeline*, *on hold*, *awaiting*, *competing priorities*, *no real timeline*
- Target End (`customfield_16603`) is past today's date and status is not Closed/Cancelled
  - **This check is mandatory arithmetic — compare `customfield_16603` (ISO date string) against today's date for every epic. Do not skip it for epics with a Green indicator or active status. Even one day past today qualifies.**
- Status is `Open` with a Target End set but no active progress (likely not started)

### Bucket B — On Track for Current Quarter (only if no Bucket C condition matched)
All of:
- Status is active: `In Progress`, `Accepted`, `Activation`, `Verification`, `Committed`
- Progress Indicator is **Green** (`10102`), OR no indicator but status is `Verification` / `Activation`
- `customfield_10504` contains no slip language

### Bucket D — Deprioritized / On Hold
Any of:
- Status is `On Hold`, `Scope`, or `Planning`
- Status is `Open` with **no** Target End and **no** Progress Indicator (unstarted backlog)

---

## Step 4 — Collect Deliverables (Non-BAU Capabilities)

Use **two sources** and merge the results, deduplicating by Jira key.

### Source A — Local Capability Report Markdown (full index, no team filter)

Parse **all** capability rows from `CAP_REPORT_MD_PATH` into a key→row lookup. Do **not** filter by team tokens at this stage — every row is indexed regardless of whether the Team(s) column is populated.

Extract per row: Jira key, summary, AHA Release, Team(s), Target End, parent link (Initiative).

Exclude rows where summary contains `[BAU]`.

### Source B — Additional Capabilities Filter (Jira, authoritative membership signal)

If the team has an **Additional Capabilities Filter ID** in the Team Context table, run:

```
search_issues(
  jql: 'filter = <FILTER_ID> AND issuetype = Capability AND summary !~ "BAU"',
  fields: "summary,status,assignee,customfield_16602,customfield_16603,customfield_10300,customfield_16601",
  maxResults: 100
)
```

Filter 309911 (and equivalents for other teams) is the **authoritative signal** that the team is involved in a capability. A capability appearing here is included regardless of whether the team column in the markdown is populated.

Group Source B results by quarter bucket, inferring the quarter from `customfield_16603` (Target End) then `customfield_16602` (Target Start). If neither date is set, place in `Q_NEXT` as a planning item. When Source A has an AHA release for a Source B key, use the AHA release for quarter placement (overrides the null-date Q_NEXT default). If Source A has no entry or no AHA release for the key, and both Jira date fields are null, place in Q_NEXT. In all cases the key must land in exactly one bucket.

A capability with 0 epics or 0 stories is still included in the deliverables table — it represents planned but not yet broken-down work. Do not omit it on the grounds that it has no child issues.

### Source A — Team-token fallback (Source A only keys)

For any capability that appears in Source A but **not** in Source B, apply the team-token filter to decide whether to include it:

| Team | Team Name Tokens |
|------|-----------------|
| C2 | `C2UI.InfraSec`, `Detection.InfraSec`, `InTel.InfraSec`, `Orchestration.InfraSec` |
| Customer Experience | `CX.InfraSec` |

*(Add tokens for other teams as needed.)*

Include the row only if at least one token appears in the Team(s) column. Group by AHA Release:
- `Q_CURRENT` → AHA Release contains `Q_CURRENT_LABEL`
- `Q_NEXT` → AHA Release contains `Q_NEXT_LABEL`
- `Q_PLUS2` → AHA Release contains `Q_PLUS2_LABEL`

### Merge

1. Start with all keys from **Source B** — these are unconditionally included.
2. For each Source B key, **look up Source A by key** and merge:
   - Use Source A's **AHA release** if present (even if the Team(s) column in Source A is blank).
   - Use Source A's **initiative (parent link)** and **target end** if present.
   - Fall back to Source B (Jira) values for any field not found in Source A.
3. Add any Source A-only keys that passed the team-token filter (step above), placing them in the appropriate quarter bucket by AHA Release.
4. Deduplicate by Jira key. Exclude BAU rows from both sources.

Capture per merged row: Jira key, summary, status, assignee, target end, AHA release, team(s), initiative (parent link).

**Source B completeness check (mandatory):** After merging, verify that every key returned by the Source B `search_issues` call appears in exactly one quarter bucket in the merged list. Compare the Source B result set against the merged list by key. Any Source B key that is absent from the merged list is a bug — add it to Q_NEXT as an unscheduled planning item and log a warning: `WARNING: Source B key <KEY> was not placed in any bucket — defaulting to Q_NEXT.` Do not silently drop Source B results under any circumstance.

For Source A rows where the parent link (initiative) is missing, call `get_issue` on each capability key to retrieve `customfield_16601`, batching in parallel groups of 10. Use the parent issue key as the Initiative label (e.g. `PLX-1234`). Also preserve capability `status` in all merged deliverable records — this is required for scoping risk detection.

For each merged deliverable that has an `initiative_key`, store the initiative's **summary** in `initiative_summary`. If Source A already includes the initiative summary alongside the parent link, use it directly. Otherwise call `get_issue(initiative_key, fields="summary")` (batch in parallel groups of 10) to resolve it. The template renders `initiative_summary` (falling back to `initiative_key`) as the linked text in the Initiative column.

---

## Step 5 — Infer Overall BAU Capability Status

Derive a single status badge for `Q_CURRENT_KEY`:

| Condition | Badge | Confluence Colour |
|-----------|-------|-------------------|
| ≥1 Bucket C epic with Red indicator OR exec summary contains *slipping* | Off Track | `Red` |
| ≥2 Bucket C epics OR ≥1 Yellow indicator | Watch | `Yellow` |
| All active epics in Bucket B | On Track | `Green` |

---

## Step 6 — Derive Key Actions

Generate follow-up actions from observed issues:

- Bucket C epic with Yellow/Red → "Investigate and unblock `{{KEY}}: {{SUMMARY}}`" — owner = epic assignee
- Bucket D epic with past target end still in Q_CURRENT → "Move `{{KEY}}` to `Q_NEXT_KEY` or close" — owner = epic assignee
- Bucket D epic still in Q_CURRENT (On Hold/Scope/Planning) → "Confirm: move to `Q_NEXT_KEY` or deprioritize `{{KEY}}`" — owner = epic assignee
- If Q_NEXT has no DART ALSI epic (no epic with `DART:` in summary) → "Create DART:XX.X BAU epic under `Q_NEXT_KEY`" — owner = team lead
- Any Q_NEXT or Q_PLUS2 epic with no target dates → "Set target dates on Q_NEXT / Q_PLUS2 BAU epics" — owner = epic owners — target = planning session

In the same step, infer `key_takeaways` for the top summary section of the report template.

Build 3–6 concise bullets that capture the most important points across:
- overall BAU status (`inferred_status_label`)
- count and severity of at-risk epics
- deprioritized/on-hold backlog impact
- Q_NEXT and Q_PLUS2 readiness (dates, planning completeness)
- major cross-team deliverable signals from Source A + Source B

Each takeaway should be one sentence, specific, and action-oriented where possible.

In the same step, infer `scoping_risks` for the top report section.

Risk criteria:
- Capability is planned for `Q_CURRENT` or `Q_NEXT` (from the quarter bucket / AHA release grouping), and
- Capability status indicates not through scoping/design yet:
  - `Open`, `Backlog`, `Scope`, `Scoped`, or `Design`

For each risk, include:
- `key`
- `summary`
- `quarter` (`Q_CURRENT_LABEL` or `Q_NEXT_LABEL`)
- `status`
- `risk_reason` (e.g. "Not past design/scoping while targeted for current quarter")
- `recommendation` (e.g. "Revalidate commitment or fast-track scope/design exit criteria")

Sort `scoping_risks` by quarter (current first), then by key.

---

## Step 7 — Render Markdown Report Locally

### Page Title
```
<TEAM_NAME> Team — Roadmap Report — <TODAY_YYYY-MM-DD>
```

Use the roadmap template at:

```
/marketplace/plugins/sdlc/skills/roadmap-report/roadmap_report.md.j2
```

Render the template with the roadmap context you assembled in Steps 0–6, including `key_takeaways` and `scoping_risks`. Do not narrate individual sub-steps (path resolution, env var lookup, etc.) — execute the render script directly and report only the output path when done.

Output file (markdown only — the MCP server handles markdown→XHTML conversion):
- `ROADMAP_MD_PATH=/tmp/roadmap-report-<TEAM_NAME>-<TODAY_YYYY-MM-DD>.md`

Example render flow:

```bash
cat > /tmp/roadmap-context.json <<'JSON'
{ ...context object from Steps 0-6 plus key_takeaways and scoping_risks... }
JSON

python3 - <<'PY'
import json
import os
from pathlib import Path
from jinja2 import Environment, FileSystemLoader

plugin_root = "/marketplace/plugins/sdlc"
template_dir = Path(plugin_root) / "skills" / "roadmap-report"
template_name = "roadmap_report.md.j2"
context = json.loads(Path("/tmp/roadmap-context.json").read_text(encoding="utf-8"))

env = Environment(loader=FileSystemLoader(str(template_dir)), trim_blocks=True, lstrip_blocks=True)
md = env.get_template(template_name).render(**context)

md_path = Path(context["roadmap_md_path"])
md_path.write_text(md, encoding="utf-8")
print(f"Rendered markdown to {md_path}")
PY
```

Read `ROADMAP_MD_PATH` and pass its content as `content` to the MCP publish tools below.

---

## Step 8 — Publish via MCP (markdown → XHTML handled server-side)

The MCP `create_page` and `update_page` tools both accept markdown and convert it to Confluence XHTML storage format automatically. Do **not** pre-convert to XHTML locally.

Set `PAGE_TITLE = <TEAM_NAME> Team — Roadmap Report — <TODAY_YYYY-MM-DD>`.

1. Call `search_pages(query="<PAGE_TITLE>", space="SELO", limit=10)`.
2. From the returned array (`{ id, title, space, url, lastModified }`), select entries where `title == PAGE_TITLE` exactly.
3. If an exact match exists:
  - Use that entry's `id` as `page_id`.
  - Call `get_page(page_id)` and parse the header line `Version: <N>` to get `version_number`.
  - Call `update_page` with:
    - `page_id`
    - `title`: `PAGE_TITLE`
    - `content`: markdown content from `ROADMAP_MD_PATH`
    - `content_format`: `markdown`  ← MCP converts to XHTML internally
    - `version_number`: parsed integer `N`
4. If no exact match exists, call `create_page` with:
  - `space`: `SELO`
  - `title`: `PAGE_TITLE`
  - `parent_id`: resolved Confluence parent page ID
  - `content`: markdown content from `ROADMAP_MD_PATH`  ← MCP converts to XHTML internally

Report the published page URL to the user.

---

## Example Invocations

```
/roadmap-report C2
```
Fully automatic — derives Q2/Q3/Q4 2026 from today, searches Jira for C2 BAU capabilities, generates local capability markdown with jira_report.py, and publishes under the C2 team home page.

```
/roadmap-report C2 965646135
```
Same but uses the specified Confluence parent explicitly.

**Reference output:** [C2 Team — Roadmap Report — 2026-05-20](https://collaborate.akamai.com/confluence/spaces/SELO/pages/1413242265/C2+Team+%E2%80%94+Roadmap+Report+%E2%80%94+2026-05-20)
