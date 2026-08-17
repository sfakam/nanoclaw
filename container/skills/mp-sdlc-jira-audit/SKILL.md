<!-- Installed from marketplace plugin: sdlc/jira-audit -->
<!-- MCP tools are available via the nanoclaw-plugins MCP server. -->
<!-- If a tool is shown as mcp__<server>__<tool>, use mcp__nanoclaw-plugins__<tool> instead. -->
<!-- Marketplace scripts are available at /marketplace/plugins/sdlc/ (e.g. scripts/, skills/, servers/) -->

---
name: jira-audit
description: Run SDLC JIRA audit queries from the InfraSec auditing framework. Check for non-compliant tickets, missing fields, stale issues, and more.
allowed-tools: mcp__plugin_platform-common_akamai-jira__search_issues, mcp__plugin_platform-common_akamai-jira__get_issue, mcp__plugin_platform-common_akamai-jira__update_issue, mcp__plugin_platform-common_akamai-jira__add_comment, mcp__plugin_platform-common_akamai-jira__bulk_update_issues, mcp__plugin_platform-common_akamai-jira__get_field_options
---

# SDLC JIRA Audit

Run InfraSec SDLC audit queries against Jira and display results with remediation guidance.

## Audit Registry

Each audit has a saved Jira filter ID. Use `filter = <id>` in JQL to execute them.

| # | Audit Name | Filter ID | Description |
|---|-----------|-----------|-------------|
| 1 | capabilities-incomplete-owners | 272726 | Capabilities scoped but missing Product Architect, Engineering Owner, or Product Manager |
| 2 | epics-empty-fields | 272727 | Active Epics missing Dev QA, Target Start, Target End, Progress Indicator, or Executive Summary |
| 3 | stale-issues | 269522 | Tickets not updated for a long period |
| 4 | fixversion-empty | 269523 | Tickets missing FixVersion |
| 5 | inprogress-but-no-release | 269524 | In Progress production tickets not linked to an Epic |
| 6 | issues-created-without-template | 269525 | Stories/Epics not created via official templates |
| 7 | unsupported-types | 269534 | Tickets using non-conformant issue types (allowed: Story, Bug, Task, Technical Spike) |
| 8 | devqa-missing | 269535 | Epics, Stories, and Bugs in execution/verification missing Dev QA assignee |
| 9 | tasks-prod-components | 273951 | Tasks that have release components (should be Stories, or use fixVersion "no_release") |
| 10 | orphaned | 274134 | Tickets missing parent link (Capability→Initiative, Epic→Capability) |
| 11 | unassigned | 274137 | Tickets without an assignee |
| 12 | dates-expired | 295152 | Epics with target end date in the past |
| 13 | escalation-related-epic-empty | 295145 | Escalation-related tickets without an epic/release planned |
| 14 | incident-related-epic-empty | 295149 | Incident-related tickets without an epic/release planned |
| 15 | noncompliant (all) | 273960 | Union of all audit filters above — shows every non-compliant ticket |
| 16 | epics-missing-team | *(JQL)* | Active and recently-closed Epics missing the Team field — infer owner from reporter/assignee and suggest bulk fix |

## Custom Field Reference

Use these Jira custom field IDs when reading or updating issue fields via `search_issues` or `update_issue`. This avoids needing to rediscover field IDs at runtime.

| Field Name | Field ID | Type | Values / Format |
|------------|----------|------|-----------------|
| Target Start | `customfield_16602` | Date | `YYYY-MM-DD` |
| Target End | `customfield_16603` | Date | `YYYY-MM-DD` |
| Progress Indicator | `customfield_10300` | Select | Green: `{"id": "10102"}` |
| Parent Link | `customfield_16601` | String | Issue key (e.g., `PLX-12345`) |
| Epic Link | `customfield_10903` | String | Issue key (e.g., `PLX-12345`) |
| Team | `customfield_16600` | String (numeric ID) | Plain numeric string, e.g., `"1916"` — see Team Ownership Reference below |
| Executive Summary | `customfield_10504` | Textarea (plain text) | Free-text status summary (see convention below) |
| Dev QA | `customfield_13207` | Multi-user picker (array) | `[{"name": "username"}]` |

### Team Ownership Reference

Use the following org-chart mapping to infer which Team a ticket belongs to based on its reporter or assignee. Match on display name (case-insensitive).

| Team Name | Jira name | Numeric ID (string) | Members (display names) |
|-----------|-----------|--------------------|--------------------------|
| Intel.InfraSec | `InTel.InfraSec` | `"1916"` ✅ | Michael Kreitman, Elliot Anico, U Indumathi, Rafal Muszynski, Saketh Tatavarthi, Kaan Turkmen |
| CX.InfraSec | `CX.InfraSec` | `"1920"` ✅ | Damien Coffey, Murtuza Dhilla, Sean Kunevich, Niall Groarke, Peter O'Reilly, John Hannon, Alan Johnson, Angela Kravcevich, Ani Hopkins, Neha Bisht, Bhagyashree Shettigar, Edward Lynes, Jaykumar Bhingaradia, Meghana Kudua, April Mackintosh, Santhi Malasani, Smita Ramteke, Nandini Raj, Luis Aleman, Patrick Caron, Rakesh E, Sourav Magotra, Sruba Mohapatra, Chaitrali Paripatyadar, Sneha Shreshtha, Goutham Suda |
| Detection.InfraSec | `Detection.InfraSec` | `"1864"` ✅ | Manjunath Shankara Reddy, Shwetha Amitabh, Rahul Sushil Jeswani, Saksham Lakhera, Mujtaba Arfat Syed, Xiaohui Wang |
| C2UI.InfraSec | `C2UI.InfraSec` | `"1918"` ✅ | Christopher Respeto, Arianna Gray, Roberto Manganelly Del Risco |
| Orchestration.InfraSec | `Orchestration.InfraSec` | `"1917"` ✅ | Andreas Bjoru, Mauricio Navarro, Carl Rischar, Roger Rojas, Anjali Verma, Glen Walters |
| SRE.InfraSec | `SRE.InfraSec` | `"1921"` ✅ | Dominick Barbuscio, Jonathan Boast, Deekshitha C, Anirudh Kalluraya, Vidyathar Thendral Maran, Swami Nathan, Rajesh Ravi, Anoop Sebastian, Jerrod Wiesman, Joel Parker, Pramod D, Bernie Petreccia, Justin Beattie, Stephane Bensoussan, Shirisha Medi, Konda Srinivasulu, Kanchan Upadhyay, Jason Weber |
| QA.InfraSec | `QA.InfraSec` | `"1922"` ✅ | Jack Buchholz, Eliran Azouri, Chethana BS, Mohit Choudhary, Megha Devaraju, Vishwanath Korisetru, Dilip Kumar, Gururaj Narasannavar, Satyam Singh, Scott Karneth, Umayal Balasubramanian, Paul Lewis III, Urvashi S, Anna Kalinovska, Nestor Canizares, Suman Dhal, Keat Gilpin, Muhammad Kumail, Ishwar Malavade, Sachin Shettyhalli |
| Dataplane.InfraSec | `Dataplane.InfraSec` | `"1919"` ✅ | Stevan Markovic, Bill Sears, Vinh Tran, Omar Badoolah, Sam Aditya, Marlon Bailey, Charles Gould, Asha Prabhakaran, Jeffrey Steger, Nil Alexandrov, Jim Jensen, Brian Moore, Robert Sanford, Evan Thomas, Quanren Xiong |

> **Write format:** `customfield_16600` takes a **plain numeric string** (e.g., `"1916"`), not an object. All IDs above are confirmed from live Jira data.
>
> **If you need to re-verify or look up new team IDs**, use `get_field_options(project="PLX", issueType="Epic", fieldId="customfield_16600")` which returns all allowed options with their IDs directly from the Jira `createmeta` API.

**Usage with `update_issue`:**
```
update_issue(issueKey="PLX-1234", customFields={
  "customfield_16602": "2026-03-09",
  "customfield_16603": "2026-06-30",
  "customfield_10300": {"id": "10102"}
})
```

**Usage with `search_issues` to check which fields are missing:**
```
search_issues(jql="key = PLX-1234", fields="summary,status,customfield_16602,customfield_16603,customfield_10300,customfield_10504")
```

### Executive Summary Update Convention

When an epic is flagged as **stale** (audit #3) and all other required fields are already populated, the standard remediation is to prepend a new dated status line to the Executive Summary field. The format is:

```
MM/dd/yy: <brief status summary>
```

**Examples:**
- `03/09/26: On track, waiting for QA sign-off`
- `03/09/26: Blocked on upstream dependency from Platform team`
- `03/09/26: Deprioritized, revisiting next quarter`

**How to apply:**
1. Fetch the current Executive Summary value via `get_issue` (field: `customfield_10504`)
2. Prepend the new dated line to the existing content (separated by `\n`)
3. Use `update_issue` with `customFields: {"customfield_10504": "<new line>\n<existing content>"}`
4. If the field is currently empty, just set the new dated line as the entire value

**When suggesting a fix for stale epics:**
- Ask the user for a brief status summary to include in the dated entry
- Show them the current Executive Summary content (if any) so they have context
- Present the proposed new value (new line prepended) for confirmation before writing

## Step 1 — Select Audit

Use `AskUserQuestion` to ask which audit to run. Present the categories directly to avoid back-to-back questions:

- Question: "Which SDLC audit would you like to run?"
- Options:
  1. **All non-compliant** — runs the combined noncompliant filter (273960) to see all audit failures
  2. **Epic Health** — epics-empty-fields (272727), dates-expired (295152), stale-issues (269522)
  3. **Ticket Compliance** — fixversion-empty (269523), unsupported-types (269534), issues-created-without-template (269525), tasks-prod-components (273951)
  4. **Assignment & Ownership** — capabilities-incomplete-owners (272726), unassigned (274137), devqa-missing (269535), orphaned (274134)  5. **Epics Missing Team** — find all PLX Epics with no Team field set and infer ownership from the org chart
If the user selects "Other", they can type a category name ("Release & Tracking") or a specific audit name from the Audit Registry. Map their input accordingly:
- **Release & Tracking** — inprogress-but-no-release (269524), escalation-related-epic-empty (295145), incident-related-epic-empty (295149)
- **Specific audit by name** — match against the Audit Registry table and run that single filter

If a category is selected, run all filters in that category sequentially and combine results.

## Presentation Rule

**Every table that lists tickets must include a Status column.** This applies to results tables, diagnostic tables, and confirmation tables throughout the skill.

## Step 2 — Run Audit

For each selected audit filter:
1. Run `search_issues` with `jql: "filter = <filterId> AND assignee = currentUser()"`
2. Use `fields: "summary,status,assignee,fixVersions"` for general audits
3. For **stale-issues** (269522), **epics-empty-fields** (272727), and **dates-expired** (295152), also include `customfield_10504` (Executive Summary) and `customfield_10300` (Progress Indicator) in the fields list
4. Use `maxResults: 25`

If a category was selected, run each filter in the category sequentially.

### Epics Missing Team — Special Procedure

This audit uses a JQL query instead of a saved filter. Run in pages of up to 200 issues:

```
project = PLX AND issuetype = Epic AND "Team" is EMPTY
AND updated >= "-180d"
ORDER BY updated DESC
```

Use `fields: "summary,status,assignee,reporter,customfield_16600"` and `maxResults: 200`.

**Ownership inference:** For each epic returned, determine the likely owning team by matching the **assignee** display name against the Team Ownership Reference table. If the assignee is not in any team, fall back to matching the **reporter**. If neither matches, mark ownership as **Unknown**.

**Grouping:** Group epics by inferred team and present a table per team:

| Key | Summary | Status | Assignee | Reporter | Inferred Team |
|-----|---------|--------|----------|----------|---------------|

Also show an **Unknown** group at the end for epics where no match was found.

**Show a summary row at the top:**

| Team | Epic Count |
|------|------------|
| Intel.InfraSec | N |
| CX.InfraSec | N |
| Detection.InfraSec | N |
| C2UI.InfraSec | N |
| Orchestration.InfraSec | N |
| SRE.InfraSec | N |
| QA.InfraSec | N |
| Unknown | N |

**Remediation — bulk fix per team:**

After presenting results, offer to bulk-assign the Team field for each group using `bulk_update_issues`. For each team group:
1. All IDs in the Team Ownership Reference are confirmed — use them directly
2. Use `AskUserQuestion` to confirm the inferred team and ask if the user wants to apply it to all epics in that group (or a subset)
3. If confirmed, call `bulk_update_issues` with the epic keys for that team and `customFields: {"customfield_16600": "<numeric-id-string>"}`
4. Show the `updated` / `failed` counts from the response
5. Repeat for each team group (skip Unknown — those need manual review)

> **Format reminder:** `customfield_16600` takes a **plain numeric string** — e.g., `"1916"` for InTel.InfraSec, not `{"id": 1916}` and not the team name string.

## Step 3 — Present Results

For each audit that was run, display:

### Audit: `<audit-name>` — <count> issues found

If issues were found, show a results table:

| Key | Summary | Status | Assignee |
|-----|---------|--------|----------|

Then show the **Remediation** guidance for that audit (from the table below).

If no issues were found, report: "No issues found — this audit is clean."

### Remediation Reference

Use this guidance when presenting results:

| Audit | Remediation |
|-------|-------------|
| capabilities-incomplete-owners | Assignee must fill: Product Architect, Engineering Owner, Product Manager |
| epics-empty-fields | Fill missing fields: Dev QA, Target Start, Target End, Progress Indicator. If Progress is Yellow/Red, add Executive Summary explaining status |
| stale-issues | For Stories/Bugs: update status, add comment explaining staleness. For Epics: prepend a dated status line to Executive Summary (see convention above) and update Progress Indicator if needed |
| fixversion-empty | Add correct fixVersion to ticket |
| inprogress-but-no-release | Consult with Team Lead and assign to an appropriate Epic for release tracking |
| issues-created-without-template | Recreate using official "Create Epic" or "Create Story" templates |
| unsupported-types | Convert to a supported type: Story, Bug, Task, or Technical Spike |
| devqa-missing | Assign a Dev QA team member |
| tasks-prod-components | If deploying to production: convert Task to Story. If not touching prod code: set fixVersion to "no_release" |
| orphaned | Capabilities: consult PGM team to add Initiative as parent. Epics: consult PGMs/Engineering to add Capability as parent |
| unassigned | Management to assign to appropriate owner |
| dates-expired | Work with PGM to update Target End date and Progress Indicator |
| escalation-related-epic-empty | Verify ticket is escalation-related, then add to an Epic (RRT or hotfix) |
| incident-related-epic-empty | Verify ticket is incident-related, then add to an Epic (RRT or hotfix) |
| noncompliant | Review each ticket against the specific audit it fails. Use the dashboard: https://track.akamai.com/jira/secure/Dashboard.jspa?selectPageId=58904 |
| epics-missing-team | Infer team from assignee/reporter using the Team Ownership Reference, then use bulk_update_issues to set customfield_16600. Confirm IDs before bulk-writing. |

## Step 4 — Offer to Help Fix (Optional)

After presenting results, if there are fixable issues, use `AskUserQuestion`:

- Question: "Would you like help fixing any of these issues?"
- Options:
  1. **Yes, walk me through them** — iterate through flagged tickets and offer to update fields or add comments
  2. **No, just the report** — stop here

If the user selects yes, for each ticket:
1. Use `get_issue` to fetch full details (include `customfield_10504` for epics)
2. Show what's missing based on the audit type
3. For **stale epics** where all other fields are populated: show the current Executive Summary value and prompt the user for a brief status summary to prepend as a new dated line (format: `MM/dd/yy: <text>`). Use today's date for the prefix.
4. Use `AskUserQuestion` to ask what action to take (update fields, add comment, skip)
5. If the user chooses to update fields, follow the **Smart Field Suggestions** procedure below before presenting options
6. Collect all requested changes

### Smart Field Suggestions

When the user chooses to update a field, look up child issues to suggest the most probable value:

**fixVersion:**
1. Search for child issues: `search_issues` with `jql: "parentEpic = <issueKey> AND fixVersion is not EMPTY"` and `fields: "fixVersions"` and `maxResults: 25`
2. If child issues are found, count the frequency of each fixVersion across children
3. Present the most common fixVersion as the first option labeled `(Recommended)` in the `AskUserQuestion` prompt
4. Include up to 2 other fixVersions found on children as additional options (sorted by frequency)
5. Always include a final free-text-friendly option so the user can type a custom value
6. If no child issues have fixVersion set, fall back to presenting generic options (e.g., `no_release`) or let the user type a value

**General principle:** Whenever updating a field on a parent issue, prefer deriving suggestions from existing child issue data. This avoids guessing and helps the user pick the right value quickly.

### Step 4a — Confirm Before Writing

Before applying any changes, present a summary of all planned updates. Always include the ticket status:

| Key | Status | Action | Details |
|-----|--------|--------|---------|
| PLX-1234 | In Progress | Update fields | Dev QA → jsmith, Target End → 2026-06-30 |
| PLX-5678 | Verification | Add comment | "Please assign Dev QA member" |

Use `AskUserQuestion` to confirm:
- Question: "Apply these changes to Jira?"
- Options:
  1. **Yes, apply all** — proceed to apply
  2. **No, cancel** — abort without making any changes

If cancelled, report that no changes were made and stop.

### Step 4b — Apply Changes

For each confirmed change:
- Use `update_issue` for field updates
- Use `add_comment` for comments
- Report success or failure after each

Display a final summary of all changes applied.
