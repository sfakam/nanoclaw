<!-- Installed from marketplace plugin: sdlc/jira-file-bug -->
<!-- MCP tools are available via the nanoclaw-plugins MCP server. -->
<!-- If a tool is shown as mcp__<server>__<tool>, use mcp__nanoclaw-plugins__<tool> instead. -->
<!-- Marketplace scripts are available at /marketplace/plugins/sdlc/ (e.g. scripts/, skills/, servers/) -->

---
name: jira-file-bug
description: File or validate a Jira bug. Config-driven defaults, one-shot input, no preview round, parallel creates.
allowed-tools: Bash, mcp__plugin_platform-common_akamai-jira__create_issue, mcp__plugin_platform-common_akamai-jira__get_issue, mcp__plugin_platform-common_akamai-jira__search_issues, mcp__plugin_platform-common_akamai-jira__update_issue, mcp__plugin_platform-common_akamai-jira__add_comment, mcp__plugin_platform-common_akamai-jira__transition_issue, mcp__plugin_platform-common_akamai-jira__get_project_components, mcp__plugin_platform-common_akamai-jira__get_field_options, AskUserQuestion
---

## Step 0 — Mode
If user message contains a bare `PLX-\d+` key → **Mode A**. Otherwise → **Mode B**.

---

## Mode A — Validate Existing Bug
1. `get_issue` fields: `summary, description, components, labels, priority, status, customfield_14747, customfield_10903, customfield_12201`
2. Report failures only:

| Check | Rule |
|-------|------|
| Summary | `[plx-ui-*] <description>` format |
| Component | Exactly one `plx-ui-*` |
| Labels | `component`, `kubernetes`, `UI`, `dart` + `smoke` or `regression` |
| Detection Env | `customfield_14747` set |
| Epic Link | `customfield_10903` set |
| Priority | Not empty |
| Severity | `customfield_12201` set |
| Pre-conditions | Description has "Pre-conditions" section |
| Steps + E/A | Numbered steps; each bug states expected and actual |

3. For each failure, state the exact fix. Offer to apply all with one `update_issue` call.

---

## Mode B — File New Bug

### Config Load
Read `~/.claude/plx/control-ui-bug.config.md`. If found: load silently, skip questions for assignee/epic/env/team/labels/priority/severity/SNT default. If not found: run **First-Time Setup Wizard** (end of file).

### Step 1 — One-Shot Input
Ask once (free text):
> "Describe the bug — component (if different from config default), severity (Critical/High/Medium/Low — default: {config.default_severity}), assignee (if different from {config.assignee}), URL, what you were doing, and what went wrong. Number each separate bug. Include steps, expected, and actual."

Extract without follow-up:
- **Component**: `{config.component}` unless user specifies; validate if ambiguous
- **Severity**: extract if stated; else use `{config.default_severity}`
- **Assignee**: `{config.assignee}` unless user specifies a different username
- **Env**: infer from URL (`.sqa.`/SQA hosts → `{config.env_field_id}`; `.qa.`/`devqa` → `34203`); ask only if unclear
- **Summary**: `[plx-ui-{component}] <≤10-word description>`
- **Pre-conditions**: role, URL, starting state
- **Bugs**: numbered, each with action → expected → actual

### Step 2 — Discovery Context

```
AskUserQuestion:
  question: "How was this bug discovered?"
  options:
    - label: "During SNT testing — I have an SNT key"
    - label: "Ad-hoc — create a new SNT"
    - label: "No SNT needed"
```

#### During SNT Testing
Ask: "Enter the SNT key (e.g. SNT-XXXX)."

`get_issue` for status and labels. Add epic key as label if not already present (merge, do not overwrite). Do NOT change the SNT's smoke/regression labels — the SNT keeps its existing lifecycle unchanged.

#### Ad-hoc (New SNT)
Call Skill `jira-create-snts` to create the SNT. Once it completes, use the returned SNT key for all subsequent steps.

#### No SNT Needed
Skip SNT steps. Skip Step 5a.

### Step 3 — Epic
- **Epic**: `{config.epic}` — skip question. If no config: ask (free text). If user types `search`: `search_issues` JQL `project = PLX AND issuetype = Epic AND component = plx-ui-{component} AND status != Done ORDER BY updated DESC`, show top 5.

### Step 4 — Create (no preview round)
Fire `create_issue` (PLX bug). Trust the create response — do NOT call `get_issue` to validate. If something looks wrong in the response, offer to fix with `update_issue`. Fetch only if user explicitly asks.

### Step 5 — Issue Links

**5a — SNT → PLX Bug** _(skip when "No SNT needed")_
```
! curl -s --cert ~/.certs/$USER.crt --key ~/.certs/$USER.key --cacert ~/.certs/akamai_ca_list.pem -X POST -H "Content-Type: application/json" -d '{"type":{"name":"QA"},"inwardIssue":{"key":"<SNT-XXXX>"},"outwardIssue":{"key":"<PLX-XXXXX>"}}' "{config.api_base}/rest/api/2/issueLink"
```
Direction: SNT = inwardIssue, PLX = outwardIssue. Reversing breaks the generate-test-plan audit.

**5b — Bug → Epic "discovered while testing"** _(always run)_
```
! curl -s --cert ~/.certs/$USER.crt --key ~/.certs/$USER.key --cacert ~/.certs/akamai_ca_list.pem -X POST -H "Content-Type: application/json" -d '{"type":{"name":"discovered while testing"},"inwardIssue":{"key":"<PLX-EPIC>"},"outwardIssue":{"key":"<PLX-XXXXX>"}}' "{config.api_base}/rest/api/2/issueLink"
```
Direction: Epic = inwardIssue ("was discovered while testing"), Bug = outwardIssue ("discovered while testing [Epic]").

### Step 6 — Summary
```
Created:  PLX-XXXXX  {config.jira_base}/PLX-XXXXX
SNT:      SNT-ZZZZ   {config.jira_base}/SNT-ZZZZ
Epic:     PLX-YYYY
```
If bug found via existing SNT, offer `add_comment` on SNT linking back to the new PLX ticket.
```
All SNTs:      project = SNT AND labels = PLX-YYYY AND status != Done
One-time SNTs: project = SNT AND labels = PLX-YYYY AND labels = one-time-test AND status != Done
```

**Update test artifacts:** The bug is filed. If coverage for the epic changed (new SNT created, or SNT transitioned), re-run these to keep artifacts current:
- `/plx-generate-test-plan` — regenerates the test plan and Confluence audit page
- Create-test-cycle pipeline — rebuilds the Zephyr cycle for this epic

---

## Bug Create Payload
```json
{
  "project": "PLX",
  "issueType": "Bug",
  "summary": "[plx-ui-{component}] <description>",
  "priority": "{config.priority}",
  "assignee": "{config.assignee}",
  "components": ["plx-ui-{component}"],
  "labels": ["{config.labels}", "<smoke|regression>"],
  "epicLink": "{config.epic}",
  "description": "<wiki markup below>",
  "customFields": {
    "customfield_14747": {"id": "{config.env_field_id}"},
    "customfield_16600": "{config.team_field_id}",
    "customfield_12201": {"id": "<severity_option_id>"}
  }
}
```
`customfield_16600` must be a plain string (e.g. `"1918"`) — NOT `{"id":...}` (causes 400 error).

To resolve severity option IDs, run `get_field_options` for `customfield_12201` on project PLX during first-time setup, then store in config.

### Description Template (Jira Wiki Markup)
```
h3. Environment
*URL:* <url>
h3. Pre-conditions
* Role: <role>
* URL: <url>
* Starting state: <state>
h3. Steps to Reproduce
# <step 1>
# <step 2>
h3. Bugs Found
h4. Bug 1 — <title>
||Input / Action||Expected||Actual||
|<input>|<expected>|<actual>|
h4. Bug N — <title>
...
h3. Expected Behavior Summary
* <one bullet per fix required>
h3. Related
[SNT-XXXXX|{config.jira_base}/SNT-XXXXX]
```

## Custom Field Reference
| Field | ID | Format |
|-------|----|--------|
| Detection Env | `customfield_14747` | `{"id": "34202"}` SQA / `{"id": "34203"}` DevQA |
| Epic Link | `customfield_10903` | Epic key string e.g. `"PLX-100"` |
| Team | `customfield_16600` | Plain string e.g. `"1918"` — NOT `{"id":...}` |
| Dev QA | `customfield_13207` | `[{"name": "<username>"}]` |
| Severity | `customfield_12201` | `{"id": "<option_id>"}` — resolve with `get_field_options` |

---

## First-Time Setup Wizard
Runs when config file is missing. Ask in order:
1. Team name
2. Default PLX component — validate with `get_project_components`
3. Default epic key
4. Default assignee username — this should be the **dev lead** for the component; individual bugs can override via Step 1 free text
5. Detection environment (SQA → `34202` / DevQA → `34203`) — sets `env_field_id`
6. `customfield_16600` value (e.g. `1918`)
7. Default labels, comma-separated
8. Default priority
9. Default severity (Critical/High/Medium/Low) — call `get_field_options` for `customfield_12201` to get option IDs; store as `default_severity` (label) and `severity_option_ids` map
10. Default SNT type (one-time/recurring) — sets `snt_one_time_default: true/false`

Write answers to `~/.claude/plx/control-ui-bug.config.md`. Tell the user: "Config saved — you won't be asked these again. Edit the file to change defaults."
