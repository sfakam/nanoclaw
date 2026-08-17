<!-- Installed from marketplace plugin: sdlc/qa -->
<!-- MCP tools are available via the nanoclaw-plugins MCP server. -->
<!-- If a tool is shown as mcp__<server>__<tool>, use mcp__nanoclaw-plugins__<tool> instead. -->
<!-- Marketplace scripts are available at /marketplace/plugins/sdlc/ (e.g. scripts/, skills/, servers/) -->

---
name: qa
description: Orchestrate a QA workflow for a feature or change. Launches specialized agents for test design, planning, execution, and automation. Use when validating a feature, PR, or release.
argument-hint: "[<feature|ticket|branch>]"
---

Perform a comprehensive QA workflow by launching specialized agents in sequence and/or parallel.

## Step 0: Load Release Testing Context

Check whether `${SKILL_DIR}/release-testing.md` exists:
- If **missing** → report: "Release testing context not found at `${SKILL_DIR}/release-testing.md`. Proceeding without team-specific workflow context." and continue without it.
- If **present** → read it and pass its contents to all agents in subsequent steps.

The context document defines:
- Release types (ALSI vs EPIC), their triggers, and scope rules
- The 5-step release testing workflow and what triggers each step
- Tooling (Jira, Zephyr Squad) and traceability requirements
- Roles and their responsibilities
- Key rules: prefer existing test cases, link before creating, every failure needs a bug

## Step 1: Gather Context

Parse `$ARGUMENTS` for the target. Accepted formats:
- Jira ticket (e.g. `PLX-1234`) — fetch issue details via `/jira`
- Branch name — derive context from git
- Free-text feature description — use as-is

Determine release type from context (ALSI or EPIC) and carry it through all steps.

If a branch is provided or can be inferred:
```bash
git diff main...HEAD --name-only   # changed files
git log main...HEAD --oneline      # commit summary
```

If no argument is provided, assume the current branch is the target.

## Step 2: Launch Design and Planning Agents in Parallel

Launch `qa-designer` and `qa-planner` simultaneously. Provide each agent with:
- Release type (ALSI or EPIC) and release name/ticket
- Feature or change description
- The release testing workflow context from Step 0

- **qa-designer**: Produces test cases and scenarios covering functional, edge, and negative paths; links each to the relevant Jira story or epic per the workflow rules
- **qa-planner**: Produces a structured QA plan aligned to the team's 5-step workflow, including Zephyr cycle structure and Jira traceability

Wait for both agents to complete before proceeding.

## Step 3: Launch Execution and Automation Agents in Parallel

Using the test cases from `qa-designer` and the plan from `qa-planner`, launch:

- **qa-executor**: Reviews and validates test execution coverage against the plan; surfaces gaps and assesses release readiness per Step 4 criteria (100% execution, bugs triaged)
- **qa-automator**: Identifies automation candidates and produces test skeletons for integration with Zephyr automated imports

Wait for both agents to complete.

## Step 4: Aggregate and Output

Collect outputs from all agents and present a unified QA summary:

```
## QA Report — <target> [<release-type>]

### Test Design (qa-designer)
<findings>

### QA Plan (qa-planner)
<findings>

### Execution Review (qa-executor)
<findings>

### Automation (qa-automator)
<findings>

### Summary
- Release type: ALSI | EPIC
- Agents run: qa-designer, qa-planner, qa-executor, qa-automator
- Test cases designed: N (new: N, reused: N)
- Automation candidates: N
- Risk areas: <list>
- Release readiness: [ready|not ready|conditional]
```
