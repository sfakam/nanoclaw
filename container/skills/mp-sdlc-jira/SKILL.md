<!-- Installed from marketplace plugin: sdlc/jira -->
<!-- MCP tools are available via the nanoclaw-plugins MCP server. -->
<!-- If a tool is shown as mcp__<server>__<tool>, use mcp__nanoclaw-plugins__<tool> instead. -->
<!-- Marketplace scripts are available at /marketplace/plugins/sdlc/ (e.g. scripts/, skills/, servers/) -->

---
name: jira
description: Handle Jira-related requests including viewing, creating, updating, and transitioning issues. Invoke when Jira is mentioned or ticket IDs are referenced (PLX-*, SNT-*, DEVOPS-*, DBA-*).
disable-model-invocation: false
allowed-tools: mcp__plugin_platform-common_akamai-jira__search_issues, mcp__plugin_platform-common_akamai-jira__get_issue, mcp__plugin_platform-common_akamai-jira__get_issue_transitions, mcp__plugin_platform-common_akamai-jira__get_project_components, mcp__plugin_platform-common_akamai-jira__create_issue, mcp__plugin_platform-common_akamai-jira__update_issue, mcp__plugin_platform-common_akamai-jira__add_comment, mcp__plugin_platform-common_akamai-jira__transition_issue, mcp__plugin_platform-common_confluence__search_pages, mcp__plugin_platform-common_confluence__get_page, mcp__plugin_platform-common_confluence__get_page_by_title, mcp__plugin_platform-common_confluence__list_child_pages
---

# Jira Integration Skill

Handle Jira-related requests using the Jira MCP server tools. If the MCP server is unavailable, fall back to direct `curl` calls as described in the **Fallback** section below.

## Trigger Patterns

This skill should be invoked when:
- User mentions "Jira" or "jira"
- User references ticket IDs matching these patterns:
  - `PLX-\d+` - Main project tickets
  - `SNT-\d+` - Test cases and executions
  - `DEVOPS-\d+` - DevOps team tickets
  - `DBA-\d+` - DBA team tickets

## Interaction Principles

- **Prefer interactive selection over plain text proposals.** Whenever you need the user to choose between multiple options — selecting stories, picking a program/type, confirming which fields to update — use `AskUserQuestion` (with `multiSelect: true` when multiple selections are valid). Do not dump a list in markdown and ask open-ended questions like "which ones do you want?" — use the interactive TUI instead.
- This applies to all flows where the user must choose from 2 or more discrete options (story selection, program/type selection, field updates, status transitions). It does **not** apply to simple yes/no confirmations or single free-text inputs.

## Available Operations

### View Issue Details
When a user mentions a ticket ID (e.g., "what's PLX-1234?" or "show me PLX-1234"):
1. Use `get_issue` to fetch full details
2. Display key information: summary, status, priority, assignee, description

### Search Issues
When a user wants to find issues:
1. Help construct a JQL query based on their requirements
2. Use `search_issues` to execute the query
3. Present results in a compact format

**Common JQL patterns:**
- My open issues: `project = PLX AND assignee = currentUser() AND status != Done`
- Team backlog: `project = PLX AND status = "To Do" ORDER BY priority DESC`
- By sprint: `project = PLX AND sprint in openSprints()`
- By label: `project = PLX AND labels = "some-label"`
- Recently updated: `project = PLX AND updated >= -7d ORDER BY updated DESC`

### Create Issue
When user wants to create a new issue (Task, Bug):
1. Use AskUserQuestion to gather required fields:
   - Project (default: PLX)
   - Summary (required)
   - Issue type (Task, Bug)
   - Description
   - Priority
   - Assignee
2. Use `create_issue` to create it
3. Return the new issue key

> **Note**: Stories require an SDLC-compliant description template — see [Create Story](#create-story-sdlc-compliant) below.

### Create Epic (SDLC-Compliant)
When user wants to create an epic, it **must** follow the SDLC description template. Minimize questions — infer and suggest as much as possible from context.

1. **Required from user**: Summary (epic title).

2. **Program and Type**: Infer from context when the value is explicitly stated — e.g., the program key appears in the user's message, a parent epic's summary (e.g., `[PCC] [NEW] ...`), or session context. If either value is not explicitly present in these sources, use `AskUserQuestion` to let the user select interactively (present Program and Type as separate questions with the options below).
   - **Program** (required):
     - `MSO` — Managed Security Operations
     - `PCC` — Platform Capacity & Connectivity
     - `TDM` — Threat Detection & Mitigation
     - `PFD` — Product Feature Development
     - `PSE` — Platform Safety & Evolution
     - `BAU` — Business As Usual
   - **Type** (required):
     - `NEW` — New Behavior (introduces new behaviors/functionalities)
     - `MAINT` — Maintenance (updates/fixes without changes in functionality)
     - `HOTFIX` — Hotfix (addresses issues in existing system/component behavior)

   These values are applied as follows:
   - **Epic Summary**: `[<PROGRAM>] [<TYPE>] <summary>` (e.g., `[PCC] [NEW] Build new feature`)
   - **Epic Name**: `[<PROGRAM>] <summary>` (e.g., `[PCC] Build new feature`)
   - **Labels**: Add the program key as a label (e.g., `PCC`)

3. **Suggest content** for these template fields based on the conversation context, the user's stated goal, and your understanding of the change:
   - **Epic Description**: Infer from what the user described. Propose a brief description.
   - **Change Summary**: Infer the deployment purpose and types of changes. Propose a summary.
   - **Risks**: Propose at least 1 risk row with reasonable identification and mitigation strategies based on the change type (e.g., monitoring/alerting for identification, rollback for mitigation).

   Present your suggestions and let the user confirm or adjust before creating.

4. **Components**: Suggest components based on context (e.g., if the user mentions "ux-gateway", suggest the `ux-gateway` component). Reference the Components table in `context.md` for team-owned components. If the mentioned component isn't in the context table, use `get_project_components` to look up the exact component name in Jira (component names must match exactly). Include suggested components in the proposal for user confirmation. Components are optional — skip if no component is relevant.

5. **Owners**: Use the Release owner and SRE owners from session context (see `context.md` → Jira → Ticket Owners). Format with `[~username]` Jira tags. For multiple SRE owners, list all (e.g., `[~prsharm] [~akallura] [~dbarbusc]`). Only ask the user if owners are not available in context.

6. **Target Dates** (optional): Ask the user for a target start date and target end date (YYYY-MM-DD format). Either or both may be left blank — omit from the `create_issue` call if not provided.

7. **Team and Dev QA**:
   - **Team**: If not resolvable from session context, ask the user to choose from:
     - `Detection.InfraSec` (ID: `"1864"`)
     - `Orchestration.InfraSec` (ID: `"1917"`)
     - `Dataplane.InfraSec` (ID: `"1919"`)
     - `InTel.InfraSec` (ID: `"1916"`)
     - `CX.InfraSec` (ID: `"1920"`)
     - `C2UI.InfraSec` (ID: `"1918"`)
     - `SRE.InfraSec` (ID: `"1921"`)
     - `QA.E2E.InfraSec` (ID: `"2664"`)
   - **Dev QA**: If not resolvable from session context, ask the user for the Dev QA username.

8. **Phases**: Use Phase 1 and Phase 2, each with one placeholder row — the user will expand these later in Jira.

9. **Create the epic** using `create_issue` with:
   - `issueType`: `"Epic"`
   - `summary`: `[<PROGRAM>] [<TYPE>] <summary>`
   - `epicName`: `[<PROGRAM>] <summary>`
   - `labels`: include the program key (e.g., `["PCC"]`), plus any other labels
   - `components`: list of component names (e.g., `["ux-gateway"]`)
   - `description`: the populated SDLC template (Jira wiki markup)
   - `customFields`: set **Team**, **Dev QA**, **Target Start**, and **Target End** if provided (see Custom Field Mapping section)

10. Return the new epic key.

#### SDLC Epic Description Template

The description field must use this exact Jira wiki markup structure:

```
h3. Description
{panel:title=Epic Description}
<epic_description>
{panel}
{panel:borderStyle=none|bgColor=#fffffd}{panel}

h3. Change Safety
{panel:title=Change Summary}
<change_summary>
{panel}

{panel:title=Risks and Mitigations}
||risk||identification||mitigation||
|<risk_summary>|<risk_identification>|<risk_mitigation>|
{panel}

{panel:title=Owners}
||team||owner||
|Release|<release_owner> #changeMe|
|SRE|<sre_owner> #changeMe|
{panel}

h3. Actions
{panel:title=Phase 1}
||action||platform||network/variant||component||script (if applicable)||participants||
|#changeMe|#changeMe|#changeMe|#changeMe|#changeMe|#changeMe|
{panel}
{panel:title=Phase 2}
||action||platform||network/variant||component||script (if applicable)||participants||
|#changeMe|#changeMe|#changeMe|#changeMe|#changeMe|#changeMe|
{panel}
```

- Substitute `<epic_description>`, `<change_summary>`, and risk fields with suggested content
- For owners, use `[~username]` format if known from context, otherwise keep `#changeMe`
- Phase rows are always left as `#changeMe` placeholders
- Add additional risk rows as needed (minimum 1)

### Create Story (SDLC-Compliant)
When user wants to create a story, it **must** follow the SDLC description template. Minimize questions — infer and suggest as much as possible from context.

1. **Required from user**: Summary (story title).

2. **Program**: Stories use `[<PROGRAM>]` only (no `[TYPE]`). Same program values as epics (MSO, PCC, TDM, PFD, PSE, BAU).
   - If a parent epic is known, extract the program from the epic's summary (e.g., `[PCC] [NEW] ...` → program is `PCC`). Use `get_issue` to fetch the epic if needed.
   - If no parent epic is known, ask the user for the program.
   - Apply to **Story Summary**: `[<PROGRAM>] <summary>`
   - **Labels**: Add the program key as a label

3. **Suggest content** for these template fields based on the conversation context, the user's stated goal, and your understanding of the change:
   - **Customer**: Who benefits from this story (e.g., direct customers, SOCC, Provisioning, GSS, internal customers)
   - **Requirement Definition**: A concise definition of what is being built or changed
   - **Inputs / Interactions**: What triggers or feeds this requirement (user actions, API calls, data inputs)
   - **Outputs**: What the requirement produces — be specific with UI elements, data structures, or behaviors
   - **Impact**: What this story changes or affects in the broader system
   - **Performance**: Expected performance characteristics and limits
   - **Unit Tests**: What unit tests should be written or updated
   - **Installation Changes**: Any deployment, configuration, or infrastructure changes required

   Present your suggestions and let the user confirm or adjust before creating.

4. **Implementation Steps**: Propose a bulleted list of implementation subtasks based on the requirement. These should be ordered logically and cover the full scope of the story (e.g., API changes, UI updates, tests, documentation, metrics).

5. **Components**: Same rules as epic creation — suggest from context, validate with `get_project_components` if needed. Optional.

6. **Epic Link**: If the user mentions a parent epic or one is obvious from context, set the epic link. Ask if unclear.

7. **Create the story** using `create_issue` with:
   - `issueType`: `"Story"`
   - `summary`: `[<PROGRAM>] <summary>`
   - `labels`: include the program key, plus any other labels
   - `components`: list of component names if applicable
   - `description`: the populated SDLC template (Jira wiki markup)
   - `epicLink`: parent epic key if known
   - `customFields`: set **Team** and **Dev QA** if resolvable from context

8. Return the new story key.

#### SDLC Story Description Template

The description field must use this exact Jira wiki markup structure:

```
h1. Requirement
{panel:borderStyle=none|bgColor=#fffffd}{panel}

||*Customer*|<customer>|
||*Requirement Definition*|<requirement_definition>|
||*Inputs / Interactions*|<inputs_interactions>|
||*Outputs*|<outputs>|
||*Impact*|<impact>|
||*Performance*|<performance>|
||*Unit Tests*|<unit_tests>|
||*Installation Changes*|<installation_changes>|



h1. Implementation Steps/Subtasks

<implementation_steps>
```

- Substitute all `<placeholder>` fields with suggested content
- For **Outputs**, use Jira wiki markup lists (`*` and `**`) when describing multiple items or nested details
- For **Implementation Steps**, use a bulleted ordered list with `*` prefix for each step
- Leave fields as `#changeMe` only if genuinely unknown and not inferable from context

### Generate Stories from Epic
When user asks to create stories for an epic (e.g., "create stories for PLX-500"), gather context from the epic and related documentation, then propose stories for the user to select and confirm.

1. **Fetch the epic**: Use `get_issue` to retrieve the epic's full details — description, summary, components, labels.

2. **Extract the program**: Parse the program from the epic summary (e.g., `[PCC] [NEW] ...` → `PCC`). All generated stories inherit this program.

3. **Gather documentation context**: Scan the epic description for:
   - **Confluence links**: URLs matching the Confluence domain. Use `get_page` (by page ID extracted from the URL) to pull the full content of linked design docs, architecture decisions, or requirements.
   - **Capability tickets**: Referenced Jira tickets (e.g., `PLX-*` keys mentioned in the description). Use `get_issue` to fetch them, then scan their descriptions for additional Confluence links and repeat the document retrieval.
   - **Inline requirements**: Any implementation details, phases, or action items described directly in the epic.

4. **Propose stories**: Based on the epic description, phase actions, and Confluence documentation, propose a list of stories. Use `AskUserQuestion` with `multiSelect: true` to present the stories for interactive selection. Each option should have:
   - **label**: Short story title
   - **description**: `[<PROGRAM>] <full summary>` + brief rationale (1 sentence)

   Split across multiple `AskUserQuestion` calls if there are more than 4 stories (max 4 options per question). Group related stories in the same batch where possible. Collect all selections across all `AskUserQuestion` calls before beginning story creation — do not create stories after each batch. Unselected stories are skipped.

5. **Create selected stories**: For each confirmed story, follow the full [Create Story (SDLC-Compliant)](#create-story-sdlc-compliant) flow:
   - Populate the SDLC template fields using context gathered from the epic and Confluence docs
   - Set `epicLink` to the parent epic
   - Inherit program, components, and labels from the epic where applicable
   - Present each story's suggested template fields for user confirmation before creating

6. Return all created story keys.

### Update Issue
When user wants to modify an existing issue:
1. Confirm the issue key
2. Use `AskUserQuestion` with `multiSelect: true` to let the user select which fields to update (summary, description, priority, assignee, labels)
3. Gather new values for the selected fields
4. Use `update_issue` to apply changes
5. Confirm the update

### Add Comment
When user wants to comment on an issue:
1. Confirm the issue key
2. Get the comment text
3. Use `add_comment` to add it
4. Confirm success

### Transition Issue
When user wants to change issue status:
1. Use `get_issue_transitions` to see available transitions
2. Use `AskUserQuestion` to present the available transitions as a single-select list (label: transition name, description: target status)
3. Use `transition_issue` with the selected transition ID
4. Optionally add a comment with the transition

## Response Format

When displaying issue details, use this format:

```
**[KEY]** Summary
Status: [status] | Priority: [priority] | Assignee: [assignee]
Type: [type] | Reporter: [reporter]

Description:
[truncated description]

Labels: [labels]
Components: [components]
```

When displaying search results, use a compact table format:

```
| Key | Summary | Status | Assignee |
|-----|---------|--------|----------|
| PLX-123 | Fix login bug | In Progress | jsmith |
```

## Error Handling

- If an issue key doesn't exist, inform the user clearly
- If a transition isn't available, show available transitions
- If JQL is invalid, help the user fix it
- For permission errors, suggest the user check their Jira access

## Fallback (MCP unavailable)

If the Jira MCP server is not present in the session, use `curl` with mTLS client certificates:

```bash
curl -s \
  --cert ~/.certs/$USER.crt \
  --key ~/.certs/$USER.key \
  --cacert ~/.certs/akamai_ca_list.pem \
  "https://track-api.akamai.com/jira/rest/api/2/issue/<TICKET>" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
f = d['fields']
print('Key:', d['key'])
print('Type:', f['issuetype']['name'], '| Is Sub-task:', f['issuetype'].get('subtask', False))
print('Summary:', f.get('summary'))
print('Status:', f['status']['name'])
print('Description:', (f.get('description') or '(none)')[:2000])
parent = f.get('parent')
print('Parent:', parent['key'] if parent else '(none)')
epic = f.get('customfield_10903')
print('Epic Link:', epic if epic else '(none)')
"
```

> The Epic Link field is `customfield_10903`.

## Examples

### Example 1: Quick Ticket Lookup
User: "What's PLX-1234?"
Action: Use `get_issue` with issueKey="PLX-1234" and display formatted results.

### Example 2: Find My Work
User: "Show me my open tickets"
Action: Use `search_issues` with JQL `project = PLX AND assignee = currentUser() AND status != Done`

### Example 3: Create Bug
User: "Create a bug for the login issue"
Action:
1. Ask for summary and description
2. Use `create_issue` with project="PLX", issueType="Bug"
3. Return the new ticket key

### Example 4: Update Status
User: "Move PLX-1234 to In Progress"
Action:
1. Use `get_issue_transitions` to find the transition ID for "In Progress"
2. Use `transition_issue` with the correct transitionId
3. Confirm the status change

### Example 5: Create SDLC Story
User: "Create a story for adding an edit config action to ADAM Configurator under PLX-500"
Action:
1. Propose story fields: customer (internal customers), requirement definition, inputs/interactions (user selects edit config), outputs (edit modal with fields), impact, performance, unit tests, installation changes, and implementation steps
2. Present suggestions to user for confirmation/adjustment
3. Use `create_issue` with issueType="Story", epicLink="PLX-500", and the populated SDLC template as description
4. Return the new story key

### Example 6: Generate Stories from Epic
User: "Create stories for PLX-500"
Action:
1. Fetch PLX-500 with `get_issue`, extract program from summary, scan description for Confluence links and referenced tickets
2. Pull linked Confluence pages with `get_page` for additional context
3. Propose a list of stories (e.g., "API endpoint for config edit", "Edit config modal UI", "Unit tests for config validation")
4. User selects/adjusts the list
5. For each confirmed story, populate the SDLC template using epic + Confluence context, present for confirmation, and create with `create_issue`
6. Return all new story keys

### Example 7: Create SDLC Epic
User: "Create an epic for the xiphos config migration"
Action:
1. Propose epic description, change summary, and risks based on context
2. Present suggestions to user for confirmation/adjustment
3. Use `create_issue` with issueType="Epic", epicName="Xiphos Config Migration", and the populated SDLC template as description (phases left as #changeMe)
4. Return the new epic key

## Custom Field Mapping

| Field Name | Field ID | Format |
|------------|----------|--------|
| Epic Link | customfield_10903 | String — epic key (e.g., `"PLX-100"`) |
| Epic Name | customfield_10904 | String — short epic label |
| Team | customfield_16600 | String — **numeric ID** (not name). The field rejects display names; pass the ID as a string. Known IDs: `Detection.InfraSec`=`"1864"`, `Orchestration.InfraSec`=`"1917"`, `Dataplane.InfraSec`=`"1919"`, `InTel.InfraSec`=`"1916"`, `CX.InfraSec`=`"1920"`, `C2UI.InfraSec`=`"1918"`, `SRE.InfraSec`=`"1921"`, `QA.E2E.InfraSec`=`"2664"` |
| Dev QA | customfield_13207 | Array of objects — `[{"name": "<username>"}]` |
| Target Start | customfield_16602 | String — date in `YYYY-MM-DD` format (optional) |
| Target End | customfield_16603 | String — date in `YYYY-MM-DD` format (optional) |

## Commit Messages

All git commit messages **must** start with a Jira ticket ID. Format: `<TICKET-ID> <description>` (e.g., `PLX-1234 add retry logic to config sync`). When creating commits, always prefix the message with the relevant ticket ID from the current work context. If no ticket ID is known, ask the user before committing.

## Team Context

- Default project: PLX
- Test project: SNT (for test cases)
- The team uses Jira for tracking all work items
- Sprint planning happens bi-weekly
