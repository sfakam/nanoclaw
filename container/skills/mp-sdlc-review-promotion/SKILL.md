<!-- Installed from marketplace plugin: sdlc/review-promotion -->
<!-- MCP tools are available via the nanoclaw-plugins MCP server. -->
<!-- If a tool is shown as mcp__<server>__<tool>, use mcp__nanoclaw-plugins__<tool> instead. -->
<!-- Marketplace scripts are available at /marketplace/plugins/sdlc/ (e.g. scripts/, skills/, servers/) -->

---
name: review-promotion
description: Review a spock-release prod promotion PR — validates Jira ticket statuses, test coverage, Zephyr test executions, and test report completeness.
argument-hint: "<PR#>"
allowed-tools: mcp__plugin_platform-common_akamai-bitbucket__get_pr, mcp__plugin_platform-common_akamai-bitbucket__get_pr_diff, mcp__plugin_platform-common_akamai-bitbucket__list_prs, mcp__plugin_platform-common_akamai-confluence__get_page, mcp__plugin_platform-common_akamai-confluence__get_page_comments, mcp__plugin_platform-common_akamai-jira__get_issue, mcp__plugin_platform-common_akamai-jira__search_issues, mcp__plugin_platform-common_akamai-jira__zephyr_get_project_versions, mcp__plugin_platform-common_akamai-jira__zephyr_get_cycles, mcp__plugin_platform-common_akamai-jira__zephyr_get_executions, mcp__plugin_platform-common_akamai-jira__zephyr_aggregate_results, mcp__plugin_platform-common_akamai-jira__zephyr_get_step_results
---

Review a prod promotion PR in `spock-release` (Bitbucket project: `NS`, repo: `spock-release`) against QA acceptance criteria. Runs 9 automated checks and prints a structured pass/fail report.

Reference files in `references/` — read on demand during evaluation and reporting:
- `references/constants.md` — project IDs, status codes, link types, issue type filters
- `references/check-rules.md` — detailed pass/fail/warn logic for all 9 checks
- `references/report-format.md` — output template for the final report

## Step 1 — Identify the PR and Parse Description

Arguments: $ARGUMENTS

If a PR number was provided, use it directly. Otherwise ask the user for the PR number.

Fetch the PR using `get_pr` (project: `NS`, repo: `spock-release`, pr_id: the number).

If the PR title does not contain `to 'prod'`, stop and tell the user this skill is only for prod promotion PRs.

Parse the PR **description** to extract:

| Field | How to extract |
|-------|---------------|
| **Chart name** | `Chart name:` line |
| **Chart version** | `Chart version:` line (e.g. `1.12.13-release+21`) |
| **Jira tickets** | `Jira ticket(s):` line — comma-separated list of keys |
| **QA report URL(s)** | **All** URLs between the `=== QA report start` and `=== QA report end` delimiters — there may be more than one (a promotion spanning multiple epics/versions), typically one per line |

Store the **stripped chart version** by removing everything from the first `-` onward (e.g. `1.12.13-release+21` → `1.12.13`).

**Multi-report note:** A single promotion can link **multiple** test reports (one per epic). Collect every URL in the delimited block into a `reports` list and run Steps 2–3 for each. Checks 4, 6, 7, and 8 are then evaluated **per report**, while Check 3 uses the **union** of all reports' executions (see `check-rules.md`).

## Step 2 — Fetch and Parse Each Test Report

For **each** report URL collected in Step 1:

Extract the Confluence page ID from the URL (the numeric segment in `/pages/<ID>/`).

Fetch the page **three** ways — `get_page` in `markdown` format, `get_page` in `storage` (XHTML) format, and `get_page_comments` for the page's footer comments. (Across multiple reports, issue these fetches in parallel.)

**Why comments matter:** `get_page` only returns the page body (`body.storage`). Confluence footer/page comments are a **separate** resource and are NOT included in the body — QA frequently records skip/failure explanations as a page comment, so Check 7 depends on `get_page_comments`. Keep the comment text keyed by report alongside the body.

From the **markdown** version, extract:
- **Test Results Summary** table: Total, Total Passed, Total Failed, Skipped, Unexecuted counts
- **Components Under Test** table: (component, version) pairs

From the **storage** (XHTML) version, extract:
- The **epic key**: pattern `(PLX-\d+)` in the page title
- The **Zephyr projectId**: `<ac:parameter ac:name="projectId">` value in a gadget macro (should be `23308`)

Keep the parsed data keyed by report (epic key) so later per-report checks can reference it.

## Step 3 — Resolve Zephyr Project and Version (per report)

Call `zephyr_get_project_versions` with `projectKey: "SNT"` **once** — the result covers every report.

For **each** report:
- Find the version whose `name` matches that report's epic key (e.g. `PLX-11340`). Record its `id` as the report's **versionId**.
- Use `zephyr_get_cycles` with `projectId: "23308"` and the report's `versionId` to get all cycles.
- For every cycle with `totalCycleExecutions > 0`, call `zephyr_get_executions` to collect all executions. **Make these calls in parallel** (across all reports and cycles). Build a per-report dataset of: executionId, issueKey, status, cycleName, cycleId, versionId.

Also build a **combined union dataset** across all reports — a test case counts as passing if it has a `pass`/`pass_manual` execution in **any** report's version. Check 3 evaluates against this union.

## Step 4 — Fetch Jira Data (for Checks 1, 2, and 3)

Use `search_issues` with:
- JQL: `key in (<comma-separated ticket keys>)`
- fields: `summary,status,issuetype,issuelinks`
- maxResults: 100

This single query provides data for Checks 1, 2, and the test case map for Check 3.

## Step 5 — Evaluate All Checks

Read `references/constants.md` and `references/check-rules.md` for the detailed evaluation logic.

Evaluate all 9 checks using the data gathered in Steps 1-4. Fetch additional data as needed per check (e.g., `zephyr_aggregate_results` for Checks 6 and 8, `list_prs` for Check 9, test case summaries for failing test cases).

| # | Check | Scope | Data source |
|---|-------|-------|-------------|
| 1 | JIRA ticket statuses | PR-level | Step 4 — status of each Bug/Story |
| 2 | "Tested by" links | PR-level | Step 4 — issuelinks on each Bug/Story |
| 3 | Test execution statuses | **union** | Step 3 **union** dataset + Step 4 test case map |
| 4 | Test report linked & version match | per-report (≥1 must match) | Steps 1 + 2 |
| 5 | Failed test case defects | union | Step 3 executions (look for fail/fail_manual) |
| 6 | No unexecuted tests | per-report | Step 2 report + `zephyr_aggregate_results` per cycle |
| 7 | Skipped/failed test comments | per-report | Step 2 report storage + `get_page_comments` (footer comments) |
| 8 | Smoke tests executed | per-report | Step 3 cycles/executions + `zephyr_aggregate_results` |
| 9 | Post-merge test execution | union | `list_prs` (merged QA PR) + `zephyr_get_executions_for_test` `executedOn` per linked test case (filtered to promotion versions) |

**Multi-report roll-up:** For per-report checks (4, 6, 7, 8), evaluate every report and roll up to a single result — Check 4 passes if **at least one** report matches the chart; Checks 6/7/8 take the worst per-report result (any report FAIL → FAIL; any WARN with none failing → WARN). Always list the per-report breakdown in the report.

## Step 6 — Report Results

Read `references/report-format.md` and output the structured report following that template. When more than one report is linked, include the per-report breakdown table and list each report's epic key and component.
