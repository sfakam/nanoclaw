<!-- Installed from marketplace plugin: sdlc/proxy-api-automator -->
<!-- MCP tools are available via the nanoclaw-plugins MCP server. -->
<!-- If a tool is shown as mcp__<server>__<tool>, use mcp__nanoclaw-plugins__<tool> instead. -->
<!-- Marketplace scripts are available at /marketplace/plugins/sdlc/ (e.g. scripts/, skills/, servers/) -->

---
name: proxy-api-automator
description: Automate proxy-api SNT test cases in plx-tests. Reads SNT tickets to understand what needs testing, scans the existing proxy test suite to understand patterns and coverage, determines what is automatable, proposes Robot Framework changes, and implements after approval. Handles any proxy-api change — new endpoints, new parameters, new validations, new error codes, config changes.
argument-hint: "<PLX-epic-key>"
allowed-tools: mcp__plugin_platform-common_akamai-jira__get_issue, mcp__plugin_platform-common_akamai-jira__search_issues, mcp__plugin_platform-common_akamai-jira__update_issue, AskUserQuestion, Bash, Read, Edit, Write
---

# Proxy API Test Automator

Automate proxy-api SNT test cases by writing Robot Framework test cases in the `plx-tests` repo.

**IMPORTANT — approval gates:**
- Never write, modify, or commit any file without explicit user approval.
- Use `AskUserQuestion` for every proposal and selection decision.
- If the user declines at any gate, stop and report what was skipped.

---

## Step 1 — Parse Input

Read `$ARGUMENTS` for the PLX epic key (e.g. `PLX-17542`).
- If not provided, ask: "Which PLX epic are we automating test cases for?"
- Validate it matches `PLX-\d+`.

---

## Step 2 — Gather SNT Context (run in parallel)

Fetch:

1. **Epic details** — `get_issue` on the epic key. Extract: summary, components, description.
2. **SNT tickets linked to the epic** — `search_issues` with JQL:
   `project = SNT AND issueLinks in linkedIssues("<epic-key>", "is tested by") ORDER BY key ASC`
   Fields: `summary,status,labels,description`.
3. **PLX stories under the epic** — `search_issues` with JQL:
   `project = PLX AND "Epic Link" = <epic-key> AND issuetype in (Story, Bug)`
   Fields: `summary,status,description`.

Present to the user:
- Epic summary
- SNT tickets found (table: key, summary, labels, status)
- Note which SNTs are already `QA Accepted Automation` vs `QA Accepted Manual`

---

## Step 3 — Read the Proxy Test Suite

Read the following files to understand the current structure, patterns, and existing coverage. Run all reads in parallel:

```
~/git/plx-tests/config/proxy/test_data.json
~/git/plx-tests/testsuites/dart/regression/proxy/layer1/001__status_and_summary.robot
~/git/plx-tests/testsuites/dart/regression/proxy/layer1/002__vips_and_ports_limit_config.robot
~/git/plx-tests/testsuites/dart/regression/proxy/layer1/layer2/001__pd_subnet_allocation.robot
~/git/plx-tests/testsuites/dart/regression/proxy/layer1/layer2/layer3/001__vip_allocation.robot
~/git/plx-tests/testsuites/dart/regression/proxy/layer1/layer2/layer3/002__vip_allocation_flag_enabled.robot
~/git/plx-tests/testsuites/dart/regression/proxy/layer1/layer2/layer3/layer4/001__DART_pull_and_netscaler_status.robot
~/git/plx-tests/testsuites/dart/regression/proxy/layer1/layer2/layer3/layer4/layer5/001__vip_deallocation.robot
~/git/plx-tests/resources/proxy/proxy.robot
~/git/plx-tests/resources/proxy/open_proxy.robot
```

Also check for any other files related to the feature:
```bash
grep -r "<keyword-from-epic>" ~/git/plx-tests/ --include="*.robot" --include="*.json" -l 2>/dev/null
```

From this reading, build an understanding of:
- **Parametrized tests** — which tests are driven by `test_data.json` config values (e.g. `source_IP_protocol_list`, `ports`) and would auto-cover a new value if the config is updated
- **Existing patterns** — how negative tests are structured (expected status code, error code assertion), how positive tests are structured (validate endpoint response keyword), two-step tests (deploy then update)
- **Keywords available** — what Robot Framework keywords exist in `proxy.robot` and `open_proxy.robot` that can be reused
- **Layer structure** — which layer a new test belongs in based on what it's testing (status/summary, limits, subnet allocation, VIP allocation, DART pull, deallocation)
- **Tag convention** — what tags existing tests use (smoke, regression, disabled, etc.)

---

## Step 4 — Determine Automation Scope

For each SNT ticket, classify it as one of:

### A — Auto-covered by config change
The existing parametrized tests will pick up the new feature automatically if a config value is added/updated in `test_data.json`. No new test case needed — just a config update.

Example: adding a new `sourceIpProtocol` enum value to `source_IP_protocol_list` in `test_data.json` causes all existing VIP allocation, DART pull, and Xiphos pull tests to run with it automatically.

### B — Needs new Robot Framework test case
The scenario is specific enough that existing parametrized tests won't cover it. A new test case is needed in the appropriate `.robot` file.

### C — Not automatable
The test requires infrastructure or tooling not available in the current suite (e.g. NAT rule validation, DB-level checks, UI interaction, manual deploy steps). Flag these clearly.

### D — Already automated
The SNT is already covered by an existing test case.

Present the classification to the user:

```
| SNT | Summary | Classification | Reason |
|-----|---------|----------------|--------|
| SNT-XXXX | ... | A — config change | Adding to source_IP_protocol_list covers this |
| SNT-XXXX | ... | B — new test case | Specific error code not covered by existing tests |
| SNT-XXXX | ... | C — not automatable | Requires NAT rule inspection |
| SNT-XXXX | ... | D — already automated | Covered by SNT-1158-x |
```

Ask with `AskUserQuestion` (multiSelect):
> "Confirm which SNTs to automate:"

Present only Class A and B items as options. Class C and D are informational only.

---

## Step 5 — Propose Changes

For each confirmed SNT, propose the specific changes needed:

### For Class A (config changes)

Show the exact diff to `test_data.json`:
- Which key to update (e.g. `source_IP_protocol_list`, `source_IP_proxy_to_xiphos_mapping`, `ports`)
- The new value to add
- Explain which existing tests this will cause to run with the new value

### For Class B (new test cases)

For each SNT, propose a Robot Framework test case. Determine:

**What type of test is this?**
- **Positive** (valid input → HTTP 200): use `expectedStatusCode=${200}` + `Validate endpoint response against input payload for VIP configuration`
- **Negative** (invalid input → HTTP 400 + error code): use `expectedStatusCode=${400}` + `Should Be Equal ${errorCode[0]} <ERROR_CODE>`
- **Two-step** (deploy then update): re-fetch active config version between steps — version increments after each successful deploy
- **New endpoint**: identify the right keyword in `proxy.robot` or propose a new one if none exists

**Which file does this test go in?**
Based on what's being tested:
- API status/summary → `layer1/001__status_and_summary.robot`
- VIP/port limits → `layer1/002__vips_and_ports_limit_config.robot`
- PD subnet allocation → `layer1/layer2/001__pd_subnet_allocation.robot`
- VIP allocation, parameter validation → `layer1/layer2/layer3/001__vip_allocation.robot`
- Flag-gated VIP allocation → `layer1/layer2/layer3/002__vip_allocation_flag_enabled.robot`
- DART pull, Xiphos pull, Netscaler status → `layer1/layer2/layer3/layer4/001__DART_pull_and_netscaler_status.robot`
- VIP deallocation → `layer1/layer2/layer3/layer4/layer5/001__vip_deallocation.robot`

**What tag?**
- `smoke` — standard for all proxy-api tests
- `smoke  openAPI` — if testing via Open API client
- `disabled` — if temporarily disabling a test

**Show the full proposed Robot Framework test case** for user review before writing anything.

Ask with `AskUserQuestion` (multiSelect):
> "Approve the proposed test cases:"

One option per proposed test. Show the full Robot Framework code as the description.

---

## Step 6 — Confirm Branch

Ask with `AskUserQuestion` (single-select):
> "Which branch should changes be committed to?"

Options:
- **Create new feature branch** — `feature/<PLX-epic-key>-<short-description>`
- **Use existing branch** — I'll provide the branch name

If creating a new branch:
```bash
cd ~/git/plx-tests && git checkout -b feature/<PLX-epic-key>-<short-description>
```

If using existing:
```bash
cd ~/git/plx-tests && git checkout <branch-name>
```

---

## Step 7 — Implement Changes

Apply all approved changes:

### 7a — Config changes

Update `~/git/plx-tests/config/proxy/test_data.json` with the approved additions.

Show the diff to the user before writing.

### 7b — New test cases

For each approved test case, insert it into the correct `.robot` file:
- Add **before** the `*** Keywords ***` section
- Follow the exact indentation and spacing of surrounding tests
- Use the SNT ticket key as the test case name (no `-1` suffix unless there are genuinely multiple variants of the same SNT)
- Read the target file first to find the insertion point

### 7c — Disabling tests (if applicable)

If any existing tests need to be disabled (API removed, endpoint deprecated):
- Change `[Tags]` to `disabled`
- Add `Skip    msg=<reason>` as the first keyword in the test body
- Keep the test case in the file — do not delete it

---

## Step 8 — Commit and Push

```bash
cd ~/git/plx-tests
git add <changed files>
git status
```

Show the user what will be committed. Ask for confirmation before committing.

```bash
git commit -m "feat(<PLX-epic-key>): <short description of what was automated>"
git push origin <branch-name>
```

---

## Step 9 — Summary

Output a full summary:

```
## Automation Complete

### Config Changes
| File | Change |
|------|--------|

### New Test Cases
| SNT | File | Type | Tag |
|-----|------|------|-----|
| SNT-XXXX | 001__vip_allocation.robot | negative | smoke |

### Auto-covered by Config
| SNT | Covered by |
|-----|-----------|
| SNT-XXXX | source_IP_protocol_list → picked up by SNT-1158-x |

### Not Automatable
| SNT | Reason |
|-----|--------|
| SNT-XXXX | Requires NAT rule inspection |

### Branch
feature/<PLX-epic-key>-<description> — pushed to remote
```

---

## Key Patterns Reference

### Negative test (HTTP 400 + error code)
```robot
SNT-XXXX:[description]
    [Tags]  smoke
    ${active_config_version_resp}  ${active_cv_details}=  Get active config version response and its details
    Log Many  ${active_config_version_resp}  ${active_cv_details}
    <construct payload with specific invalid input>
    ${vips_response} =  Configure Proxy VIPs  ${pdName}  ${vips_payload}  expectedStatusCode=${400}  report=${TRUE}
    Log  ${vips_response}
    ${errorCode} =  dictUtils.get_element_by_jsonpath  jsonFile=${vips_response}  pattern=$..errorCode
    Should Be Equal  ${errorCode[0]}  <ERROR_CODE>
```

### Positive test (HTTP 200 + validate response)
```robot
SNT-XXXX:[description]
    [Tags]  smoke
    ${active_config_version_resp}  ${active_cv_details}=  Get active config version response and its details
    Log Many  ${active_config_version_resp}  ${active_cv_details}
    <construct payload with valid input>
    ${vips_response} =  Configure Proxy VIPs  ${pdName}  ${vips_payload}  expectedStatusCode=${200}  report=${TRUE}
    Log  ${vips_response}
    Validate endpoint response against input payload for VIP configuration  ${vips_payload}  ${vips_response}
```

### Two-step test (deploy then update)
```robot
    # Step 1: initial deploy
    <construct and send initial payload — expect 200>
    # Re-fetch active version — increments after each successful deploy
    ${active_config_version_resp}  ${active_cv_details}=  Get active config version response and its details
    # Step 2: update
    <construct update payload using refreshed version>
    <send update — expect 200 or 400 depending on scenario>
```

### Disabling a test
```robot
SNT-XXXX:[original title]
    [Tags]  disabled
    Skip    msg=<reason — e.g. "API deprecated in PLX-XXXXX">
```

### Tag convention
- `smoke` — all standard proxy-api tests
- `smoke  openAPI` — tests exercising the Open API client path
- `disabled` — tests for deprecated/removed APIs
