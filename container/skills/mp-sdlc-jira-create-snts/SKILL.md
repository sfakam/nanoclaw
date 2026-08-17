<!-- Installed from marketplace plugin: sdlc/jira-create-snts -->
<!-- MCP tools are available via the nanoclaw-plugins MCP server. -->
<!-- If a tool is shown as mcp__<server>__<tool>, use mcp__nanoclaw-plugins__<tool> instead. -->
<!-- Marketplace scripts are available at /marketplace/plugins/sdlc/ (e.g. scripts/, skills/, servers/) -->

---
name: jira-create-snts
description: Create SNT test cases for a PLX epic. First-time setup wizard stores your username, team, label preset, and optional test strategy page — works for any PLX team. Audits existing coverage with a single fast bash call, classifies risk tier, proposes SNTs via epic/story analysis and user input (.txt/.csv/.xlsx), merges [Auto+User] ideas, shows a two-phase summary-then-steps review, and only creates after explicit confirmation. Handles one-time SNT lifecycle (label swap + status transitions).
argument-hint: "<PLX-epic-number>"
allowed-tools: mcp__plugin_platform-common_akamai-jira__get_issue, mcp__plugin_platform-common_akamai-jira__search_issues, mcp__plugin_platform-common_akamai-jira__create_issue, mcp__plugin_platform-common_akamai-jira__update_issue, mcp__plugin_platform-common_akamai-jira__add_comment, mcp__plugin_platform-common_akamai-confluence__get_page, mcp__plugin_platform-common_akamai-confluence__search_pages, AskUserQuestion, Bash, Read
---

# SNT Test Case Creator

Create well-structured Zephyr SNT test cases for a PLX epic and link them to the relevant stories and bugs.

**Approval gates:** Never create, update, or delete any Jira issue or Zephyr test step without explicit user confirmation. Stop and report if the user declines at any gate.

**One test case per condition:** Each distinct input condition, validation rule, boundary value, or error code gets its own SNT. Never bundle multiple validations into a single test case — if a title contains "and", it is probably two tests. One pass/fail outcome per SNT.

---

## Step 0 — Config Check

```bash
CONFIG="$HOME/.config/plx-snts/config.sh"
[ -f "$CONFIG" ] && source "$CONFIG" && echo "CONFIG_LOADED" || echo "SETUP_NEEDED"
```

**If SETUP_NEEDED**, run the one-time setup wizard with `AskUserQuestion`:

**Q1 — Akamai username** (free text via Other)
> "Your Akamai username — used for mTLS cert path `~/.certs/<username>.crt`"

**Q2 — Default team** (single-select):
| Team | ID | Team | ID |
|------|----|------|----|
| InTel.InfraSec | `1916` | C2UI.InfraSec | `1918` |
| Detection.InfraSec | `1864` | CX.InfraSec | `1920` |
| Orchestration.InfraSec | `1917` | SRE.InfraSec | `1921` |
| Dataplane.InfraSec | `1919` | QA.E2E.InfraSec | `2664` |

**Q3 — SNT label baseline** (single-select):
- **C2UI** — `component,kubernetes,UI,dart,spock` *(plx-ui-\* standalone apps)*
- **Standard PLX** — `component,kubernetes,spock` *(backend / pipeline components)*
- **Custom** — enter your own comma-separated list

**Q4 — Summary component prefix** (free text, optional)
> "Prefix used before component in SNT summaries — e.g. `plx-ui` → `[plx-ui-device-state]`. Leave blank to use the component name as-is."

**Q5 — Test strategy Confluence page ID** (free text, optional)
> "Page ID from your team's test strategy doc URL (numbers only). Leave blank to skip."

**Q6 — QA reviewer username** (free text)
> "Jira username of the person who reviews and accepts recurring SNTs on your team."

Save config:
```bash
mkdir -p "$HOME/.config/plx-snts"
cat > "$HOME/.config/plx-snts/config.sh" <<'EOF'
PLX_USERNAME="<username>"
PLX_TEAM_ID="<team-id>"
PLX_LABEL_BASELINE="<comma-separated-labels>"
PLX_SUMMARY_PREFIX="<prefix-or-empty>"
PLX_TEST_STRATEGY_PAGE_ID="<page-id-or-empty>"
PLX_QA_REVIEWER="<reviewer-username>"
EOF
echo "Config saved. Delete ~/.config/plx-snts/config.sh to re-run setup."
```

Validate after saving:
```bash
source "$HOME/.config/plx-snts/config.sh"
[ -z "$PLX_USERNAME" ] && echo "ERROR: PLX_USERNAME empty — re-run setup" && exit 1
echo "Config OK: user=$PLX_USERNAME team=$PLX_TEAM_ID"
```

---

## Step 1 — Parse Input

Read `$ARGUMENTS` for the epic key (e.g. `PLX-17542`).
- If missing, ask: "Which PLX epic would you like to create SNT test cases for?"
- Validate format matches `PLX-\d+` before proceeding.

---

## Step 2 — Gather Context

Run all fetches simultaneously:

**2a — Epic details:** `get_issue(<epic-key>)` — extract summary, status, components, labels, description, parent epic.

**2b — Test strategy** *(if `PLX_TEST_STRATEGY_PAGE_ID` is set)*: `get_page(page_id=$PLX_TEST_STRATEGY_PAGE_ID)`.
After fetching, extract only: risk tier table, required test types per tier, label rules, summary format examples, reviewer usernames. Discard the rest — do not retain the full page text in context.

**2c — Confluence architecture docs:** Run `search_pages` in the SELO space for **each component name** from the epic (one call per component, limit 4 each), plus one call using 2–3 meaningful keywords from the epic summary (limit 4). Do **not** search by the epic ticket number — that only finds the epic review checklist page, not component architecture docs.

**Query pattern:**
- Per-component call: `<component-name>` (e.g. `scrubmon`, `owl-config`, `owl-schema`)
- Epic keyword call: 2–3 meaningful words from the epic summary (e.g. `scrub center networks`)

**After fetching all results, filter before reading content:**
1. **Drop pages older than 5 years** — exclude any page whose `lastModified` is before (current year − 5). Stale docs mislead test design more than they help.
2. **Drop release notes pages** — exclude any page whose title contains "release notes" (case-insensitive). These are changelogs, not architecture context.
3. **Deduplicate by page ID.**
4. **Keep up to 10 pages total**, prioritising pages whose titles contain: `architecture`, `design`, `schema`, `runbook`, `ADR`, or the component name itself.

For each surviving page, call `get_page(page_id=<id>)` to fetch full content. Keep full content — used to improve test step quality.

Also scan the epic description for `/confluence/` URLs → `get_page()` those pages. These are explicitly linked by the engineer and always relevant regardless of age.

If 0 pages survive after filtering, note "No recent Confluence docs found for this epic's components" and continue — do not block.

If no useful Confluence pages are found at all, ask the user:

Ask with `AskUserQuestion` (single-select):
> "I couldn't find relevant Confluence documentation automatically. Do you have any design docs or API docs to share?"

Options:
- **Yes, here's a Confluence URL** — description: "I'll paste the Confluence page URL"
- **No docs available** — description: "Skip, use ticket content only"

If **Confluence URL**: extract the page ID, fetch with `get_page`, read full content, follow linked pages one level deep.

---

**2e — RAML / Swagger / OpenAPI spec search:**

Search for API specs for the affected component/service. Run in parallel:

Search Confluence:
- `"<component> RAML"` in space `SELO`
- `"<component> swagger"` in space `SELO`
- `"<component> OpenAPI"` in space `SELO`
- `"<component> API spec"` in space `SELO`

Search git repos:
```bash
find ~/git -name "*.raml" -o -name "swagger.yaml" -o -name "swagger.json" -o -name "openapi.yaml" -o -name "openapi.json" 2>/dev/null | xargs grep -l "<component>" 2>/dev/null | head -10
```

If a spec is found, read it and extract into `API_SPEC_CONDITIONS` — a flat list of conditions, each with:
- `condition`: the specific input or scenario
- `expected`: what the API should do (HTTP 200, reject with error code X, etc.)
- `type`: `positive` | `negative` | `boundary`

Use `API_SPEC_CONDITIONS` in Step 4 as the primary source for generating test cases — one SNT per condition, one SNT per error code, one SNT per boundary value.

If no spec is found automatically, ask the user:

Ask with `AskUserQuestion` (single-select):
> "I couldn't find a RAML/Swagger/OpenAPI spec for this component automatically. Do you have one?"

Options:
- **Yes, here's a Confluence URL** — description: "I'll paste the Confluence page URL"
- **Yes, here's a file path** — description: "I'll give you the local path to the spec file"
- **No spec available** — description: "Skip, use ticket and Confluence content only"

If **Confluence URL**: fetch with `get_page`, extract API conditions.
If **file path**: `cat "<filepath>"`, parse as RAML/Swagger/OpenAPI, extract conditions.
If **No spec**: note in summary, proceed with ticket + Confluence only.

---

## Step 2.3 — New Component Check

Ask `AskUserQuestion` (single-select):
> "Does this epic introduce a new component or a new sub-component of an existing one?"
- **Yes, brand-new component** — component not yet in the SNT project at all
- **Yes, new sub-component** — e.g. a new `plx-ui-*` app under an existing umbrella
- **No** — all components are established

Store as `COMPONENT_STATUS`.

- If **brand-new component**: store the new component name as `NEW_COMPONENT_NAME`.
  Build `EXISTING_COMPONENTS` = epic's component list minus `NEW_COMPONENT_NAME`.
  - If `EXISTING_COMPONENTS` is **non-empty**: run Step 2d for those components only —
    the epic has both new and established components, so coverage for the established ones
    must still be checked.
  - If `EXISTING_COMPONENTS` is **empty** (the epic is entirely about the new component):
    skip Step 2d — there are no existing SNTs to find.
- If **new sub-component**: ask for the parent component name and store as `PARENT_COMPONENT`.
  Use `PARENT_COMPONENT` (plus any other existing components from the epic) in Step 2d.
- If **No**: run Step 2.3a — validate that listed components exist in the SNT project.

---

## Step 2.3a — Validate established components *(only if Step 2.3 = "No")*

Run silently before any further work. Skip entirely if the epic returned zero components in Step 2a.

```bash
source "$HOME/.config/plx-snts/config.sh"
jcurl() {
  curl -s \
    --cert "$HOME/.certs/${PLX_USERNAME}.crt" \
    --key  "$HOME/.certs/${PLX_USERNAME}.key" \
    --cacert "$HOME/.certs/akamai_ca_list.pem" "$@"
}
EPIC_COMPONENTS="<comma-separated component names from Step 2a>"
jcurl "https://track-api.akamai.com/jira/rest/api/2/project/SNT/components" \
  | python3 -c "
import sys, json
comps = {c['name'].lower() for c in json.load(sys.stdin)}
missing = [c.strip() for c in sys.argv[1].split(',') if c.strip() and c.strip().lower() not in comps]
print('MISSING:' + ','.join(missing) if missing else 'ALL_FOUND')
" "$EPIC_COMPONENTS"
```

**If ALL_FOUND:** proceed normally.

**If MISSING:** stop immediately and show:

> ⚠ Component(s) `<list>` are not registered in the SNT project yet. Anna usually creates these before SNT work begins. Proceeding now will fall back to `unknown` — you'd need to update the component after Anna adds it.

Ask `AskUserQuestion` (single-select):
> "Component `<name>` is missing from the SNT project. What would you like to do?"
- **Stop — I'll ask Anna to add it first** — exits immediately; no SNTs created; no further work
- **Continue with `unknown` placeholder** — create SNTs now using `unknown`; update components manually after Anna adds them

If **Stop**: exit. Do not proceed to Step 2 (continued) or beyond.

If **Continue**: store `MISSING_COMPONENTS`. Use `["unknown"]` wherever those components would appear in Step 6a, and flag each affected SNT with `⚠ component pending (update after Anna adds <name>)` in the Step 7 summary.

---

## Step 2 (continued)

**2d — Existing SNT tests** *(skip only if `EXISTING_COMPONENTS` is empty)*: `search_issues`:
`project = SNT AND (component in (<EXISTING_COMPONENTS-or-PARENT_COMPONENT>) OR summary ~ "<epic-keyword>") ORDER BY created DESC`
Fields: `summary,status,assignee,priority,components,labels`. Max 30.

After fetching, scan the epic description for `/confluence/` URLs → `get_page()` those pages.

Show the user: epic overview, Confluence docs found (titles + URLs), existing SNTs found noting any that cover similar ground.

---

## Step 2.6 — Risk Tier Classification

If a test strategy page was fetched, apply its risk tier framework. Otherwise use this default:

| Tier | Assign if any apply | Suggested SNTs |
|------|---------------------|----------------|
| **High** | Mutates persistent state; admin-only; irreversible; affects multiple users; prior prod bugs | Smoke + ≥2 Regression |
| **Medium** | Non-critical UI; role-based visibility; reversible secondary workflows | Smoke + 1 Regression |
| **Low** | Read-only display; cosmetic; behind a feature flag | Smoke only |

State the inferred tier and **suggested** SNT types as a guide only — do not treat as a hard requirement. Note whether existing SNTs already cover those types. The final scope is determined by what the ticket actually needs, not the tier minimum.

---

## Step 2.5 — Collect User Testing Ideas

Ask with `AskUserQuestion` (single-select):
> "Before I propose SNT test cases, would you like to provide your own testing ideas?"

- **Type ideas now** — enter free text
- **Provide a file** — `.txt`, `.csv`, or `.xlsx`
- **Skip — let Claude propose** — use context alone

### If "Type ideas now"
Ask: "Enter your test ideas, one per line (e.g. `Verify X: when Y, Z is expected`)."
Parse each non-empty line into `USER_PROVIDED_IDEAS` (`{title, description}`).

### If "Provide a file"
Ask for the full file path.

**`.txt`:** `Read` tool — each non-empty line = one scenario.

**`.csv`:**
```bash
python3 -c "import csv; [print(r) for r in csv.reader(open('<filepath>'))]"
```

**`.xlsx`:**
```bash
python3 -c "
import sys
try: import openpyxl
except ImportError: print('pip install openpyxl'); sys.exit(1)
wb = openpyxl.load_workbook('<filepath>', read_only=True, data_only=True)
[print(list(r)) for r in wb.active.iter_rows(values_only=True)]
"
```

On read failure: report the error and fall back to "Skip".
Store results as `USER_PROVIDED_IDEAS`.

### If "Skip"
Set `USER_PROVIDED_IDEAS = []`.

---

## Step 2.7 — Template SNT Cloning *(only if Step 2.3 flagged a new component or new sub-component)*

### 2.7a — Component presence check

Verify whether the component name exists in the SNT project before fetching templates:

```bash
source "$HOME/.config/plx-snts/config.sh"
jcurl() {
  curl -s \
    --cert "$HOME/.certs/${PLX_USERNAME}.crt" \
    --key  "$HOME/.certs/${PLX_USERNAME}.key" \
    --cacert "$HOME/.certs/akamai_ca_list.pem" "$@"
}
jcurl "https://track-api.akamai.com/jira/rest/api/2/project/SNT/components" \
  | python3 -c "
import sys, json
comps = [c['name'].lower() for c in json.load(sys.stdin)]
target = sys.argv[1].lower()
print('FOUND' if target in comps else 'NOT_FOUND')
" "<new-component-name>"
```

**Decision matrix:**

| Scenario | Check result | `components` value in cloned SNT | User message |
|----------|-------------|----------------------------------|--------------|
| Brand-new component | FOUND | `[<component-name>]` | — |
| Brand-new component | NOT_FOUND | `["unknown"]` | "⚠ Component `<name>` not found in SNT project. SNTs will use `unknown` — add `<name>` to the SNT project component list before suiteseal." |
| New sub-component | N/A (skip check) | `[<PARENT_COMPONENT>]` | — (parent is already registered) |

### 2.7b — Fetch template SNTs

```
search_issues(
  jql="project = SNT AND type = Test AND component = unknown AND labels = template_spock_application",
  fields=["summary", "description", "components", "labels", "priority", "customfield_16600", "id"]
)
```

Show table: `| SNT Key | Summary | Priority |`

### 2.7c — Select and clone

Before the first batch, tell the user: "Found N template SNTs. I'll present them in batches of up to 4."

`AskUserQuestion` (multiSelect: true, batched ≤4 per call):
> "Select template SNTs to clone for `<component-name>` — batch X of Y (items X–X of N):"

Each option: label = `SNT-KEY`, description = summary + priority.
After each batch except the last: "✅ Selections recorded — batch X done. Moving to batch X+1 of Y…"

For each selected template:
1. Fetch Zephyr steps: `GET /rest/zapi/latest/teststep/<template-numeric-id>` (use numeric `id` from search result)
2. Create new SNT via `create_issue`:
   - `components`: per decision matrix above
   - `summary`: replace `[unknown]` / `unknown` in template summary with `[<component-name>]`
   - `labels`: copy template labels, remove `template_spock_application`, apply `PLX_LABEL_BASELINE` split; label type (smoke/regression/sanity) asked per Step 6a
   - `description`, `priority`, `customfield_16600`: copy from template
3. Immediately call `update_issue(issueKey=<NEW-SNT-KEY>, assignee=<confirmed-assignee>)` (per Step 6a).
4. Post Zephyr steps with JSON-safe body (per Step 6b pattern).
5. Continue normal creation flow: link to PLX ticket (6c) → one-time check (6d) → transition (6e).

Report: `✅ Cloned <TEMPLATE-KEY> → <NEW-SNT-KEY> for component <component-name>`

---

## Step 3 — Scope Determination

### 3a — New or existing epic?

`AskUserQuestion` (single-select):
> "Is this epic new (no SNT test cases created for it yet)?"

- **Yes, it's new** — all linked stories and bugs are candidates; skip to Step 3c
- **No, it has some SNTs** — run coverage check below

### 3b — Coverage check (existing epic)

**Do not use serial `get_issue` calls per ticket — that causes multi-minute hangs on large epics. Use this single bash call:**

```bash
source "$HOME/.config/plx-snts/config.sh"
[ -z "$PLX_USERNAME" ] && echo "ERROR: config missing — re-run /jira-create-snts" && exit 1

jcurl() {
  curl -s \
    --cert "$HOME/.certs/${PLX_USERNAME}.crt" \
    --key  "$HOME/.certs/${PLX_USERNAME}.key" \
    --cacert "$HOME/.certs/akamai_ca_list.pem" "$@"
}

EPIC_KEY="<KEY>"
BASE="https://track-api.akamai.com/jira/rest/api/2"

ENCODED_JQL=$(python3 -c 'import urllib.parse, sys; k=sys.argv[1]
print(urllib.parse.quote(
  "project=PLX AND issuetype in (Bug,Story,Task,\"Technical Spike\") "
  "AND \"Epic Link\"=" + k + " ORDER BY issuetype,priority DESC"))' "$EPIC_KEY")

jcurl "${BASE}/search?maxResults=100&fields=summary,status,priority,issuetype,issuelinks,components&jql=${ENCODED_JQL}" \
| python3 -c "
import sys, json
d = json.load(sys.stdin)
covered, uncovered, snt_keys, snt_key_to_id = [], [], [], {}
for issue in d['issues']:
    key    = issue['key']; f = issue['fields']
    itype  = f['issuetype']['name']
    prio   = (f.get('priority') or {}).get('name', 'Undetermined')
    status = f['status']['name']
    summ   = f.get('summary','')[:70]
    qa_links = [l for l in f.get('issuelinks',[]) if l['type']['name']=='QA']
    qa_snts = []
    for l in qa_links:
        for s in ('inwardIssue','outwardIssue'):
            k2 = l.get(s,{}).get('key','')
            i2 = l.get(s,{}).get('id','')
            if k2.startswith('SNT'):
                qa_snts.append(k2)
                if i2: snt_key_to_id[k2] = i2
    if qa_snts:
        covered.append((key,itype,prio,status,summ,qa_snts))
        snt_keys.extend(qa_snts)
    else:
        uncovered.append((key,itype,prio,status,summ))
print('=== COVERED ===')
for r in covered:   print('|'.join([r[0],r[1],r[2],r[3],r[4],','.join(r[5])]))
print('=== UNCOVERED ===')
for r in uncovered: print('|'.join([r[0],r[1],r[2],r[3],r[4]]))
print('=== SNT_KEYS ===')
print(','.join(set(snt_keys)))
print('=== SNT_IDS ===')
for k,i in snt_key_to_id.items(): print(f'{k}:{i}')
"
```

If `SNT_KEYS` is empty, skip the Zephyr step-count loop below.

Parse the `=== SNT_IDS ===` section from the coverage output into a `KEY:NUMERIC_ID` map.
Use the numeric IDs (not keys) in the step-count loop:

```bash
source "$HOME/.config/plx-snts/config.sh"
jcurl() {
  curl -s \
    --cert "$HOME/.certs/${PLX_USERNAME}.crt" \
    --key  "$HOME/.certs/${PLX_USERNAME}.key" \
    --cacert "$HOME/.certs/akamai_ca_list.pem" "$@"
}
# <SNT_ID_PAIRS> = space-separated "SNT-KEY:NUMERIC_ID" entries from === SNT_IDS === above
for PAIR in <SNT_ID_PAIRS>; do
  SNT_KEY="${PAIR%%:*}"; SNT_NUM="${PAIR##*:}"
  (COUNT=$(jcurl "https://track-api.akamai.com/jira/rest/zapi/latest/teststep/$SNT_NUM" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('stepBeanCollection', d if isinstance(d,list) else [])))"); \
   echo "$SNT_KEY $COUNT") &
done
wait
```

Show coverage table (one example row as format reference — replace with real data):
```
| Key    | Type  | Priority | Status | SNT(s)   | Steps | Coverage     |
|--------|-------|----------|--------|----------|-------|--------------|
| PLX-X  | Bug   | High     | Closed | SNT-Y    | ✅ 5  | Recurring    |
```

Show gap analysis — the `generate-test-plan` Jenkins job FAILs any bug or story missing a QA "Tested by" link:
```
| Gap                                   | Items        | Action               |
|---------------------------------------|--------------|----------------------|
| Bugs without SNT ⚠ AUDIT FAIL         | PLX-X, PLX-Y | Create SNT + QA link |
| Stories without SNT ⚠ AUDIT FAIL      | PLX-X        | Create SNT + QA link |
| SNTs missing Zephyr steps             | SNT-X        | Add steps            |
| Low/Undetermined SNTs without one-time comment | SNT-X | Add comment     |
```

Ask `AskUserQuestion` (single-select):
> "Which tickets should SNT test cases be created for?"

- **All tickets** — including those already covered
- **Only uncovered tickets** — tickets with no QA link (⚠ items above)

### 3c — Ticket selection

Before the first batch, tell the user: "Found N tickets. I'll present them in batches of up to 4."

`AskUserQuestion` (multiSelect: true, batched ≤4 options per call):
> "Select tickets for SNT creation — batch X of Y (items X–X of N):"

Each option: label = `[Type] KEY`, description = `[Status] summary — assignee`.

After each batch except the last, confirm: "✅ Selections recorded — batch X done. Moving to batch X+1 of Y…"

Collect all selections across all batches before continuing.

---

## Step 4 — Propose Test Cases

### 4a — Generate auto-proposed test cases

For each selected ticket, design test cases based on:
- The ticket description and components
- **Stories:** validate new functionality; check whether existing Smoke/Regression SNTs already cover the change before proposing new ones — only suggest new smoke/regression if there is a genuine gap
- **Bugs:** reproduce the defect and verify the fix; do not hardcode a label — the appropriate label (sanity, smoke, regression) will be asked in Step 6a
- Risk tier suggestion from Step 2.6 (advisory only)
- Confluence docs from Step 2c
- Gaps in existing SNTs from Step 2d
- **User-perspective thinking:** design around complete user workflows (select → interact → submit → verify persistence), not individual element checks

**Test case design guidelines:**
- For Stories: include at least one **sanity/install** test and one **regression** test
- For Bugs: include at least one **regression** test that reproduces the bug and confirms the fix; label with `regression`
- Mirror the label pattern of existing SNT tests: always include `component`, `kubernetes`, `spock`; add `install` for sanity checks, `sanity` for basic verifications, `regression` for functional/pipeline/fix-verification checks
- For SNTs covering a **new SPOCK component or sub-chart install**, add both `install` and `template_spock_application` labels — these identify the SNTs as new-install test cases for the component
- Component should be `owl-etl` for OWL pipeline tests (not owl-schema or owl-config)
- Each test case needs 4–7 steps in the format: **Test Step | Test Data | Expected Result**

Store as `AUTO_PROPOSED` (title, tier, rationale, 4–7 step table per test case).

### 4b — Merge with user-provided ideas

| Match | Tag | Action |
|-------|-----|--------|
| User idea overlaps auto proposal | `[Auto+User]` | Adopt auto, fold in user detail |
| User idea has no auto match | `[User]` | Design full test case from user idea |
| Auto proposal has no user match | `[Auto]` | Present as-is |

Order: `[Auto+User]` → `[User]` → `[Auto]`. Store as `COMBINED_PROPOSALS`.

### 4c — Two-phase review

**Phase 1 — Summary list** (avoids showing step tables for proposals the user will reject):

`AskUserQuestion` (multiSelect: true, max 4 per batch):
> "Select test cases to create for <PLX-KEY> ([Type]: summary) — batch X of Y:"

Each option: label = `[tag] <short title>`, description = `tier + one-line rationale`. Use `<PLX-KEY>:<short-title>` as the stable identifier across phases — not a sequence number.

Collect all selections across batches before continuing.

**Phase 2 — Full step tables for selected only:**

For each selected test case, show the full step table (Step | Test Data | Expected Result). Ask the user to confirm or deselect any. Only tests confirmed here get created.

---

## Step 5 — Field Confirmation

`AskUserQuestion` for:

1. **Team** (single-select) — default to `$PLX_TEAM_ID` if set; otherwise show full picker.
2. **Assignee** (`AskUserQuestion`, single-select):
   > "Who should the SNT be assigned to?"
   - `$PLX_USERNAME` — your username (default)
   - Other — type a different Akamai username

   Use the raw selected/typed value (no surrounding text) as `<confirmed-assignee>` for all SNTs in this batch.
3. **Priority** — default `High`. Confirm or override.

---

## Step 6 — Create Test Cases

Only after all approvals. Process one test case at a time.

### 6a — Create the Jira issue

Before creating each SNT, ask `AskUserQuestion` (single-select):
> "What label type should be applied to `<short title>`?"
- **smoke** — covers the happy path for regular regression runs
- **regression** — full regression scenario
- **sanity** — one-time or exploratory check (will not land in recurring suites)

```
project:     SNT
issueType:   Test
summary:     [<PLX_SUMMARY_PREFIX>-<component>] <test title>
             (omit prefix if PLX_SUMMARY_PREFIX is empty → [<component>] <test title>)
             If no component is available, derive a label from the epic summary keyword and
             use it in the brackets (e.g. [plx-mitigation]) — do not leave brackets empty.
description: one-sentence validation statement only — no test steps
components:  [<component from story or epic>]
             If no component is available, use ["unknown"] — the accepted placeholder for
             components not yet registered in the SNT project.
labels:      split PLX_LABEL_BASELINE on commas → one label each, then add the user-selected label (smoke / regression / sanity)
             Never add: epic key as label, suiteseal labels (managed by TCoRe)
priority:    <confirmed>
assignee:    <confirmed>
customFields:
  customfield_16600: "<PLX_TEAM_ID>"
```

Record returned `key` and numeric `id`. Report: `✅ Created <SNT-KEY>`

Immediately after creation, call `update_issue` to ensure the assignee is set (the SNT
project's "Test" issue type create screen may not include the Assignee field, causing
Jira to silently drop it from `create_issue`):

```
update_issue(issueKey=<SNT-KEY>, assignee=<confirmed-assignee>)
```

If `update_issue` returns an error, log `⚠ Assignee not set on <SNT-KEY> — set it manually`
and continue; do not abort the batch.
Report: `✅ Assignee <confirmed-assignee> applied to <SNT-KEY>`

### 6b — Post Zephyr test steps

```bash
source "$HOME/.config/plx-snts/config.sh"
jcurl() {
  curl -s \
    --cert "$HOME/.certs/${PLX_USERNAME}.crt" \
    --key  "$HOME/.certs/${PLX_USERNAME}.key" \
    --cacert "$HOME/.certs/akamai_ca_list.pem" "$@"
}
BODY=$(python3 -c "import json,sys; print(json.dumps({'step':sys.argv[1],'data':sys.argv[2],'result':sys.argv[3]}))" \
  "<step>" "<data>" "<expected>")
jcurl -X POST -H "Content-Type: application/json" -d "$BODY" \
  "https://track-api.akamai.com/jira/rest/zapi/latest/teststep/<issueId>"
```

Step pattern: Navigate → Pre-condition → Perform action → Verify primary result → Verify secondary (persistence / no error).
Verify each POST returns a numeric step ID. Report: `✅ Added N steps to <SNT-KEY>`

### 6c — Link to parent ticket

```bash
source "$HOME/.config/plx-snts/config.sh"
jcurl() {
  curl -s \
    --cert "$HOME/.certs/${PLX_USERNAME}.crt" \
    --key  "$HOME/.certs/${PLX_USERNAME}.key" \
    --cacert "$HOME/.certs/akamai_ca_list.pem" "$@"
}
jcurl -X POST -H "Content-Type: application/json" \
  -d '{"type":{"name":"QA"},"inwardIssue":{"key":"<SNT-KEY>"},"outwardIssue":{"key":"<PLX-STORY-OR-BUG-KEY>"}}' \
  "https://track-api.akamai.com/jira/rest/api/2/issueLink" \
  -w "\nHTTP:%{http_code}"
```

**Direction:** SNT = `inwardIssue`, PLX = `outwardIssue` → PLX shows "Tested by SNT-XXXX". Reversed = audit FAIL. Expect HTTP 201.
Skip for suggestion/file SNTs with no PLX source ticket.
Report: `✅ Linked <PLX-KEY> → <SNT-KEY>`

### 6d — One-time SNT handling

After all SNTs are created, ask `AskUserQuestion` (multiSelect: true):
> "Which of these SNTs should be marked as one-time (run once to verify a fix, then retired)?"

Each option: label = `<SNT-KEY>`, description = summary + priority.
Include a **None — all are recurring** option.

For each SNT the user selects as one-time:
1. Call `get_issue(<SNT-KEY>)` and read `fields.labels` and `fields.summary` — this fetch is mandatory because
   `update_issue` replaces all labels; skipping it would wipe the baseline labels.
2. Compute new label list: take fetched labels, remove `smoke` and `regression`, append `sanity`.
3. Append `[one-time]` to the SNT summary: `<original summary> [one-time]`.
   (`one-time-test` is not an official label category — keep it out of labels; the summary tag makes it visible in search and list views.)
4. Call `update_issue(issueKey=<SNT-KEY>, labels=<computed-list>, summary=<new-summary>)`.
5. Add comment via `add_comment`: `"One-time verification (<PLX-KEY>). Execute once to confirm fix; retire after validated."`

SNTs not selected: leave labels as-is — permanent recurring tests.
Report: `✅ <SNT-KEY> → one-time` or `✅ <SNT-KEY> → recurring`

### 6e — Status transitions

Transition all SNTs: Open → In Progress (id `41`) → Review (id `81`).

**Two transitions are required per SNT.** If using `transition_issue` MCP calls instead of the bash block, call it twice per SNT: first with id `41`, then with id `81`. Using it only once leaves SNTs stuck at In Progress.

```bash
source "$HOME/.config/plx-snts/config.sh"
jcurl() {
  curl -s \
    --cert "$HOME/.certs/${PLX_USERNAME}.crt" \
    --key  "$HOME/.certs/${PLX_USERNAME}.key" \
    --cacert "$HOME/.certs/akamai_ca_list.pem" "$@"
}
# Transition to In Progress
resp=$(jcurl -w "\nHTTP:%{http_code}" -X POST -H "Content-Type: application/json" \
  -d '{"transition":{"id":"41"}}' \
  "https://track-api.akamai.com/jira/rest/api/2/issue/<SNT-KEY>/transitions")
http_code=$(echo "$resp" | grep -oP 'HTTP:\K\d+')
[ "$http_code" != "204" ] && echo "⚠ <SNT-KEY> In Progress transition failed (HTTP $http_code) — set manually"
# Transition to Review
resp=$(jcurl -w "\nHTTP:%{http_code}" -X POST -H "Content-Type: application/json" \
  -d '{"transition":{"id":"81"}}' \
  "https://track-api.akamai.com/jira/rest/api/2/issue/<SNT-KEY>/transitions")
http_code=$(echo "$resp" | grep -oP 'HTTP:\K\d+')
[ "$http_code" != "204" ] && echo "⚠ <SNT-KEY> Review transition failed (HTTP $http_code) — set manually"
```

All SNTs stop at **Review** — do not auto-transition to QA Accepted. The reviewer needs to open the SNT, verify the steps are valid for the team's environment and clusters, and manually accept.

Report: `⏳ <SNT-KEY> → Review (share with $PLX_QA_REVIEWER for manual QA acceptance)`

---

## Step 7 — Summary

```
## Test Cases Created
Epic: <KEY> · Risk Tier: <High/Medium/Low>
```

| Action | Count | Result |
|--------|-------|--------|
| SNTs created | N | ✅ |
| Zephyr steps added | N steps across N SNTs | ✅ |
| QA links created | N | ✅ |
| One-time markers applied | N SNTs | ✅ |
| Transitioned to Review | N | ⏳ |
| Skipped by user | N | — |

**Existing tests found (not modified):**
| SNT Key | Summary | Status |

**Skipped (already covered):**
| PLX Key | Type | Existing SNTs |

Newly created SNT keys: `SNT-XXXX, SNT-XXXX, ...`

---

## Field Reference

### Label conventions
| Label | When to use |
|-------|------------|
| `component` | Always |
| `kubernetes` | Always (all SPOCK-deployed tests) |
| `spock` | Always |
| `install` | Schema/table existence checks, deployment verification |
| `sanity` | Basic smoke-level functional checks |
| `regression` | Pipeline correctness, data flow, aggregation validation |
| `smoke` | Lightweight health checks suitable for post-deploy gating |
| `template_spock_application` | SNTs created for a new SPOCK component or sub-chart install; keep on all cloned SNTs for new apps — identifies them as new-install test cases |

### Config (`~/.config/plx-snts/config.sh`)
| Key | Purpose |
|-----|---------|
| `PLX_USERNAME` | Akamai username → cert path |
| `PLX_TEAM_ID` | Default team custom field value |
| `PLX_LABEL_BASELINE` | Comma-separated base labels |
| `PLX_SUMMARY_PREFIX` | Component prefix for SNT summaries |
| `PLX_TEST_STRATEGY_PAGE_ID` | Confluence page ID for risk tier / label rules |
| `PLX_QA_REVIEWER` | Jira username of recurring SNT reviewer |

### Label presets
| Preset | Labels |
|--------|--------|
| C2UI | `component,kubernetes,UI,dart,spock` |
| Standard PLX | `component,kubernetes,spock` |

### SNT rules
| Rule | Value |
|------|-------|
| Labels | `$PLX_LABEL_BASELINE` split by comma + user-selected label (`smoke` / `regression` / `sanity`) |
| One-time swap | User-selected in Step 6d: remove `smoke`/`regression`, add `sanity`; append `[one-time]` to SNT summary |
| Suiteseal labels | Never set manually — TCoRe managed |
| Epic key as label | Never |
| QA link direction | SNT = inwardIssue · PLX = outwardIssue |
| All SNTs path | → InProgress → Review → share with `$PLX_QA_REVIEWER` for manual acceptance |

### Team IDs (`customfield_16600`)
| Team | ID | Team | ID |
|------|----|------|----|
| InTel.InfraSec | `1916` | C2UI.InfraSec | `1918` |
| Detection.InfraSec | `1864` | CX.InfraSec | `1920` |
| Orchestration.InfraSec | `1917` | SRE.InfraSec | `1921` |
| Dataplane.InfraSec | `1919` | QA.E2E.InfraSec | `2664` |

### Zephyr REST
- Base: `https://track-api.akamai.com/jira`
- List: `GET /rest/zapi/latest/teststep/{issueId}`
- Create: `POST /rest/zapi/latest/teststep/{issueId}` — `{"step":"...","data":"...","result":"..."}`
- Update: `PUT /rest/zapi/latest/teststep/{issueId}/{stepId}`
- Auth: mTLS — `~/.certs/$PLX_USERNAME.crt` / `.key` / `akamai_ca_list.pem`
