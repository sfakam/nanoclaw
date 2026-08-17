<!-- Installed from marketplace plugin: sdlc/jira-ticket-review -->
<!-- MCP tools are available via the nanoclaw-plugins MCP server. -->
<!-- If a tool is shown as mcp__<server>__<tool>, use mcp__nanoclaw-plugins__<tool> instead. -->
<!-- Marketplace scripts are available at /marketplace/plugins/sdlc/ (e.g. scripts/, skills/, servers/) -->

---
name: jira-ticket-review
description: Audit a Jira ticket for quality — check acceptance criteria, description completeness, and suggest test cases based on code changes.
argument-hint: "<PLX-123>"
---

Audit a Jira ticket's quality and suggest improvements. Use the `/jira` skill.

## Input

Jira ticket: $ARGUMENTS

If no ticket provided, try to extract from the current git branch name. Common patterns:
- `prefix/PLX-123-description`
- `PLX-123-description`
- `prefix/PLX-123`

If no ticket can be found, ask the user.

## Step 1: Read the Ticket

Fetch the Jira ticket. Note:
- Summary and description
- Acceptance criteria
- Story points / estimate
- Status and assignee
- Linked tickets

## Step 2: Check Ticket Status

If the ticket has an associated PR (check linked issues or current git context):
- The ticket should be in a review state (e.g., "Code Review", "In Review")
- If it's still in "Open", "To Do", or "In Progress", flag this and offer to transition it

## Step 3: Assess Ticket Quality

Evaluate:
- **Description**: Is the problem/goal clearly stated? Would a new team member understand what to do?
- **Acceptance criteria**: Are they specific, testable, and complete? Do they cover edge cases?
- **Scope**: Is the ticket well-scoped or trying to do too much?

## Step 4: Cross-reference with Code (if in a repo)

If code changes are available (current branch has a diff against target):
- Do the changes fully address the acceptance criteria?
- Are there acceptance criteria with no corresponding code changes?
- Are there code changes not covered by any acceptance criteria?

If the ticket has no acceptance criteria (or only template placeholders), still perform this step:
- Infer the expected behavior from the ticket summary and any description text
- Compare against the actual code changes
- Report what the code does vs. what the ticket asks for
- Flag this as a ticket quality issue — acceptance criteria should be added

## Step 5: Suggest Test Cases

Based on the ticket and code changes, suggest concrete test cases:
- Happy path tests
- Edge cases and boundary conditions
- Error/failure scenarios
- Integration points that need verification

## Output

```
## Ticket Quality: PLX-123

**Overall:** Good / Needs Improvement / Poor

### Description
<assessment>

### Acceptance Criteria
<assessment, specific gaps>

### Coverage Gaps
Always include this section with one of these outcomes:
- **Criteria → Code gaps**: acceptance criteria that have no corresponding code changes
- **Code → Criteria gaps**: code changes not covered by any acceptance criteria
- **No acceptance criteria found**: ticket has no AC or only template placeholders — list what the code actually does and note that AC should be added to match
- **Full coverage**: all criteria addressed, no uncovered code changes

### Suggested Improvements
- <concrete suggestions to improve the ticket>

### Suggested Test Cases
- <bulleted test cases>
```

If the `/jira` supports updates and improvements are significant, ask the user if they'd like you to add the suggestions as a comment on the ticket.
