<!-- Installed from marketplace plugin: sdlc/review-plan -->
<!-- MCP tools are available via the nanoclaw-plugins MCP server. -->
<!-- If a tool is shown as mcp__<server>__<tool>, use mcp__nanoclaw-plugins__<tool> instead. -->
<!-- Marketplace scripts are available at /marketplace/plugins/sdlc/ (e.g. scripts/, skills/, servers/) -->

---
name: review-plan
description: Validate an activation plan PR against its Jira ticket. Approves the PR if the plan matches the ticket; posts a detailed comment if it doesn't.
argument-hint: "[<PR#>]"
allowed-tools: mcp__plugin_platform-common_bitbucket__get_pr, mcp__plugin_platform-common_bitbucket__get_pr_files, mcp__plugin_platform-common_bitbucket__get_file_content, mcp__plugin_platform-common_bitbucket__post_pr_comment, mcp__plugin_platform-common_bitbucket__approve_pr, mcp__plugin_platform-common_bitbucket__list_pr_comments, mcp__plugin_platform-common_jira__get_issue, mcp__plugin_platform-common_jira__search_issues, mcp__plugin_platform-common_webex-bot__send_message, mcp__plugin_platform-common_webex-bot__list_rooms
---

Review an activation plan PR in `plx-release-mgmt` (Bitbucket project: `NS`, repo: `plx-release-mgmt`) by comparing it against its Jira ticket. Auto-approve if the plan aligns with the ticket; post a comment explaining discrepancies if it doesn't.


## Step 1: Identify the PR

Arguments: $ARGUMENTS

- If a PR number was provided (e.g., `/review-plan 389`), use it directly.
- Otherwise, run `git branch --show-current` to get the current branch name.

Use `/bitbucket` to fetch the PR from the `NS` / `plx-release-mgmt` repo:
- If you have a PR number: `/bitbucket NS plx-release-mgmt <PR#>`
- If you have a branch name: `/bitbucket NS plx-release-mgmt <branch-name>`

Note the PR number, source branch name, and PR title.

## Step 2: Extract the Ticket ID

Parse the source branch name (or PR title if the branch doesn't contain a ticket ID) for a ticket ID matching the pattern `[A-Z]+-\d+` (e.g., `PLX-16453`, `AKADASH-795`).

If no ticket ID can be found, post a comment on the PR:
> "Could not extract a Jira ticket ID from branch name or PR title. Manual review required."

Then stop.

## Step 3: Read the Activation Plan

Use `get_pr_files` (project: `NS`, repo: `plx-release-mgmt`) to list files changed in the PR, then use `get_file_content` (project: `NS`, repo: `plx-release-mgmt`) to read `plans/<TICKET-ID>/plan.yaml` from the PR's source branch.

Parse the YAML. Key fields to note:
- `description` — top-level plan description
- `activation.changeSummary` — summary of what is changing
- `activation.actions[]` — list of actions; for each action note: `action` (deploy/enable/dbmc), `component`, `version`, `platform`

If the plan file is missing or unreadable, post a comment on the PR noting the issue and stop.

## Step 4: Fetch the Jira Ticket

Use `/jira <TICKET-ID>` to fetch the ticket. Note:
- `summary` — ticket title
- `description` — ticket body (look for change summary, component mentions, action type clues)
- `components` — Jira components attached to the ticket
- `fixVersions` — versions listed on the ticket

## Step 4b: Fetch Epic Child Tickets

If the ticket type is **Epic** (or even if uncertain, always run this step), search for its child issues using the `search_issues` Jira tool with:

```
JQL: "Epic Link" = <TICKET-ID> ORDER BY created ASC
fields: summary,status,components,fixVersions,description,issuetype
maxResults: 50
```

If that returns 0 results, retry with:
```
JQL: parent = <TICKET-ID> ORDER BY created ASC
```

For each child ticket, collect:
- `summary` — short description of what the child ticket does
- `components` — Jira components listed on the child ticket
- `fixVersions` — versions listed on the child ticket (these are the most reliable source of what should be deployed)
- Any keywords in summary/description that imply action type (e.g., "migrate", "schema", "enable flag", "deploy", "upgrade")

Build an **aggregate picture** from all child tickets:
- **Expected components**: union of all components across child tickets (plus the parent epic's components)
- **Expected versions**: map of component → version(s) derived from child ticket `fixVersions`
- **Expected action types**: inferred from child ticket summaries/descriptions

If no child tickets are found, note this and proceed without dimension 5g.

## Step 4c: Check Component Placement in spock-release

For each unique `component` value collected from the plan's actions, look it up in the `spock-release` repository (Bitbucket project: `NS`, repo: `spock-release`) to determine what type of component it is and which networks it belongs to.

For each component, check whether a file named `<component>.yaml` exists under:
- `apps/dart/<component>.yaml` — if present, the component is a **dart** component
- `apps/scrub/<component>.yaml` — if present, the component is a **scrub** component

Use `get_file_content` on the `spock-release` repo to look up each path. Build a map of component → placement:

| Component | In dart/ | In scrub/ | Type |
|-----------|----------|-----------|------|
| `<name>` | yes/no | yes/no | dart / scrub / both |

**For components that exist in both `apps/dart/` and `apps/scrub/`:** The plan must contain **separate** deploy actions for each — one action targeting the dart platform and one targeting the scrub platform.

**For network-specific components:** Within the component's YAML file in `apps/dart/` or `apps/scrub/`, look for any network-scoped configuration (e.g., network names like `prod-a1`, `staging`). Note which networks the component belongs to. The plan's deploy actions for that component must include the correct `platform` values matching those networks.

Produce a summary:
- **dart-only components**: list
- **scrub-only components**: list
- **dual components** (need two actions each): list
- **Per-component network targets** (from spock-release): map of component → expected networks/platforms

## Step 5: Evaluate — Dimensions

Assess each dimension with a verdict of **pass**, **warn**, or **fail**:

### 5a. Component Names
- Extract all `component` values from the plan's actions.
- Check whether each component is mentioned (by name or clear implication) in the ticket summary, description, or Jira components field.
- **pass**: all plan components are accounted for in the ticket
- **warn**: some components are absent from the ticket but the overall scope is consistent
- **fail**: plan components are clearly unrelated to what the ticket describes

### 5b. Description / Change Summary
- Semantically compare the plan's `description` + `changeSummary` against the ticket's summary + description.
- **pass**: the plan and ticket are describing the same change (wording differences are fine)
- **warn**: the plan describes a subset or superset of the ticket scope
- **fail**: the plan describes a fundamentally different change than the ticket

### 5c. Fix Version / Release
- Extract all `version` values from the plan's actions.
- Compare against the ticket's `fixVersions`.
- **pass**: plan versions appear in `fixVersions`, or `fixVersions` is empty (don't block on missing versions)
- **warn**: `fixVersions` is set but doesn't fully match — flag it but don't block
- **fail**: `fixVersions` explicitly lists a different version and the mismatch is unambiguous

### 5d. Action Type
- Note the unique action types in the plan (deploy, enable, dbmc).
- Check whether the ticket description implies the expected action type(s):
  - A DB migration / schema change ticket must have at least one `dbmc` action
  - A feature flag / feature enable ticket should have at least one `enable` action
  - A deployment / bug fix / version bump ticket should have at least one `deploy` action
- **pass**: action types match what the ticket describes
- **warn**: action types are plausible but the ticket is ambiguous
- **fail**: clear mismatch (e.g., ticket is a DB migration but plan has only deploy actions)

### 5e. No empty fields
- Ensure no fields are left empty on the activation plan

### 5f. Procedures
- PreValidation, Implementation, PostValidation and RollBack fields must either have "generic" in the filename or the componet name. 
- prevalidation, implementation, postvalidation and rollback fields must point to a file on the `plx-release-mgmt` repo (Bitbucket project: `NS`)
- prevalidation, implementation, postvalidation, and rollback fields should have the appropriate field name in the filename too. E.g. prevalidation field should be a link to a file called "*.prevalidation.md"

### 5g. Epic Child Coverage
Using the aggregate picture from Step 4b, verify the plan covers what the child tickets describe:

**Components**: Every component that appears in child ticket `components` fields should have at least one corresponding plan action.
- **pass**: all child ticket components are represented in the plan's actions
- **warn**: a child ticket has no `components` set (can't verify), or a component appears in a child ticket that's clearly in-scope but absent from the plan with no obvious explanation
- **fail**: a child ticket explicitly names a component with a specific version that has no matching plan action

**Versions**: For each (component, version) pair derived from child ticket `fixVersions`, there should be a matching plan action.
- **pass**: all child-ticket (component, version) pairs appear in the plan, or child tickets have no `fixVersions` set
- **warn**: some child tickets lack `fixVersions` so full coverage is uncertain
- **fail**: a child ticket has a `fixVersions` entry for a specific version that is absent from the plan

**Missing actions**: Flag if any child ticket's summary/description implies an action type (deploy, enable, dbmc) that is entirely absent from the plan.
- **pass**: all implied action types from child tickets are present in the plan
- **warn**: child ticket descriptions are ambiguous about action type
- **fail**: a child ticket clearly describes a DB migration or feature enable, but no corresponding action appears in the plan

If no child tickets were found, mark this dimension as ⚠ warn with note "No child tickets found — skipped".

### 5h. Component Platform Coverage (spock-release)

Using the component placement map from Step 4c:

**Dart/Scrub split:**
- For every component that exists **only** in `apps/dart`: verify there is at least one plan action for it targeting the dart platform.
- For every component that exists **only** in `apps/scrub`: verify there is at least one plan action for it targeting the scrub platform.
- For every component that exists in **both** `apps/dart` and `apps/scrub`: verify the plan contains **two separate** deploy actions — one for the dart platform and one for the scrub platform. A single action covering both is not sufficient.
- **pass**: all components have correct platform-split actions
- **warn**: a component's placement could not be determined (path not found in spock-release — may be newly added or renamed)
- **fail**: a dual component has only one deploy action, or a dart/scrub-only component is deployed to the wrong platform

**Network targets:**
- For each component where Step 4c identified expected networks/platforms from spock-release, verify the plan's actions use matching `platform` values.
- **pass**: all plan platform values match the networks the component belongs to in spock-release
- **warn**: component has no network-scoped config in spock-release (cannot verify), or network config was ambiguous
- **fail**: the plan deploys a component to a network/platform it does not belong to according to spock-release

Combine both sub-checks into a single 5h verdict (take the worst of the two).

## Step 6: Decide and Act

**Overall verdict:**
- Any dimension is **fail** → do NOT approve; post a mismatch comment (Step 7b)
- All dimensions are **pass** or **warn** → approve and post a confirmation comment (Step 7a)

## Step 7a: Approve (all pass/warn)

1. Call `approve_pr` on the PR.
2. Call `post_pr_comment` with:

```
**Activation Plan Review: Approved** ✓

Automated review of `plans/<TICKET-ID>/plan.yaml` against [<TICKET-ID>](<jira-url>).

| Dimension | Result | Notes |
|-----------|--------|-------|
| Component names | ✓ pass / ⚠ warn | <brief note> |
| Description / change summary | ✓ pass / ⚠ warn | <brief note> |
| Fix version | ✓ pass / ⚠ warn | <brief note> |
| Action type | ✓ pass / ⚠ warn | <brief note> |
| No empty fields | ✓ pass / ⚠ warn | <brief note> |
| Procedures | ✓ pass / ⚠ warn | <brief note> |
| Epic child coverage | ✓ pass / ⚠ warn | <brief note — list any missing components/versions, or "N child tickets checked"> |
| Component platform coverage | ✓ pass / ⚠ warn | <brief note — dart/scrub split and network target findings> |

<!-- claude-review-plan -->
```

Ensure jira-url uses track.akamai.com/jira as the base domain

## Step 7b: Comment (any fail)

1. Do NOT call `approve_pr`.
2. Call `post_pr_comment` with:

```
**Activation Plan Review: Issues Found** ✗

Automated review of `plans/<TICKET-ID>/plan.yaml` against [<TICKET-ID>](<jira-url>). Manual review required.

| Dimension | Result | Notes |
|-----------|--------|-------|
| Component names | ✗ fail / ⚠ warn / ✓ pass | <specific issue> |
| Description / change summary | ✗ fail / ⚠ warn / ✓ pass | <specific issue> |
| Fix version | ✗ fail / ⚠ warn / ✓ pass | <specific issue> |
| Action type | ✗ fail / ⚠ warn / ✓ pass | <specific issue> |
| No empty fields | ✗ fail / ⚠ warn / ✓ pass | <specific issue> |
| Procedures | ✗ fail / ⚠ warn / ✓ pass | <specific issue> |
| Epic child coverage | ✗ fail / ⚠ warn / ✓ pass | <list missing components/versions or explain gap> |
| Component platform coverage | ✗ fail / ⚠ warn / ✓ pass | <list dual components missing a dart or scrub action, or network mismatches> |

**Action required:** Please reconcile the above issues or request a manual review.

<!-- claude-review-plan -->
```

Ensure jira-url uses track.akamai.com/jira as the base domain

## Step 8: Send Results to Webex

Send a copy of the review results to the Webex room **"bot testing space"** using `/platform-common:webex`.

Use `send_message` with `room_id` for the "bot testing space" room and a `markdown` body.

**Important:** Webex does not support markdown tables. Format the message as follows instead:

```
**Activation Plan Review: <Approved ✓ / Issues Found ✗>**

**PR:** [#<number>](https://git.source.akamai.com/projects/NS/repos/plx-release-mgmt/pull-requests/<number>) — <title>
**Ticket:** [<TICKET-ID>](<jira-url>)
**Verdict:** <Approved / Needs Review>

---

**Results:**
- **Component names:** <✓ pass / ⚠ warn / ✗ fail> — <brief note>
- **Description / change summary:** <✓ pass / ⚠ warn / ✗ fail> — <brief note>
- **Fix version:** <✓ pass / ⚠ warn / ✗ fail> — <brief note>
- **Action type:** <✓ pass / ⚠ warn / ✗ fail> — <brief note>
- **No empty fields:** <✓ pass / ⚠ warn / ✗ fail> — <brief note>
- **Procedures:** <✓ pass / ⚠ warn / ✗ fail> — <brief note>
- **Epic child coverage:** <✓ pass / ⚠ warn / ✗ fail> — <brief note>
- **Component platform coverage:** <✓ pass / ⚠ warn / ✗ fail> — <brief note>
```

Ensure jira-url uses track.akamai.com/jira as the base domain

If the Webex message fails to send, log the error but do not fail the overall skill.

## Step 9: Report to Operator

Display a brief summary locally (do not post this to Bitbucket — the comment above is sufficient):
- PR number and ticket ID
- Overall verdict (approved / needs review)
- Any warn/fail findings with one-line explanations
