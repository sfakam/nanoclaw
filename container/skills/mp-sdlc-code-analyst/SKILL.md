<!-- Installed from marketplace plugin: sdlc/code-analyst -->
<!-- MCP tools are available via the nanoclaw-plugins MCP server. -->
<!-- If a tool is shown as mcp__<server>__<tool>, use mcp__nanoclaw-plugins__<tool> instead. -->
<!-- Marketplace scripts are available at /marketplace/plugins/sdlc/ (e.g. scripts/, skills/, servers/) -->

---
name: code-analyst
description: Perform a parallel code review on a diff. Launches specialized agents for structural analysis, code quality, error handling, test coverage, security, comments, type design, and simplification. Use when analyzing code changes.
argument-hint: "[--local] [<target-branch>]"
---

Perform a comprehensive code review on the current branch's changes against the target branch by launching specialized agents in parallel.

## Step 1: Gather Context

Parse `$ARGUMENTS` for the `--local` flag and target branch (default: main or master).

### Mode selection

- **Default mode** (no `--local`): Review only committed changes between branches.
  ```bash
  git diff <target_branch>...HEAD          # full diff
  git diff --name-only <target_branch>...HEAD  # changed files
  ```

- **Local mode** (`--local`): Review everything not yet upstream — local commits AND uncommitted changes (staged + unstaged) against the remote tracking branch.
  ```bash
  git diff origin/<target_branch>          # full diff (includes working tree)
  git diff --name-only origin/<target_branch>  # changed files
  ```
  If `origin/<target_branch>` does not exist, fall back to `<target_branch>` with a warning.

Use the appropriate diff commands for the selected mode in all subsequent steps.

Check if a `.review_instructions.md` file exists in the repo root — if so, the `custom-reviewer` agent will be launched to enforce those guidelines.

## Step 2: Architecture Context (optional)

If `/confluence` is available and a Jira ticket can be identified from the branch name:

1. Fetch the ticket via `/jira`, find its parent epic
2. Get the epic's linked Confluence page for design context
3. Pass this context to agents as part of their input

If `/confluence` is not available, skip this step.

## Step 3: Determine Applicable Agents

Based on the changed files and diff content, decide which agents to launch:

### Phase 1 — Analysis Agents (parallel)

| Agent | When to launch |
|-------|---------------|
| `structural-reviewer` | Always |
| `code-analyzer` | Always |
| `error-handling-reviewer` | If diff contains error handling patterns |
| `test-coverage-reviewer` | If non-test source files were changed |
| `security-reviewer` | Always |
| `comment-analyzer` | If diff contains new/modified comments or docstrings |
| `type-design-analyzer` | If diff introduces or modifies types/classes/interfaces |
| `custom-reviewer` | If `.review_instructions.md` exists in repo root |
| `golang-standards-reviewer` | If diff contains `.go` files |

### Phase 2 — Polish Agent (sequential, after Phase 1)

| Agent | When to launch |
|-------|---------------|
| `code-simplifier` | Always (runs after Phase 1 completes, only if no critical issues found) |

Detection checks (use the diff base from Step 1 — `<target_branch>...HEAD` in default mode, `origin/<target_branch>` in local mode):

```bash
# Error handling patterns
git diff <diff_base> | grep -cE '(catch|except|rescue|Error\(|\.error|fallback|retry|Result\<)'

# Non-test files changed
git diff --name-only <diff_base> | grep -cvE '(test|spec|_test\.|\.test\.|Test\.)'

# Comments/docstrings added or modified
git diff <diff_base> | grep -cE '^\+.*(//|/\*|\*|#|"""|--|///)'

# New types/classes/interfaces
git diff <diff_base> | grep -cE '^\+.*(class |interface |type |struct |enum |data class|case class|sealed |trait )'
# Go source files changed
git diff --name-only <diff_base> | grep -cE '\.go$'```

## Step 4: Launch Phase 1 Agents in Parallel

Launch all applicable Phase 1 agents simultaneously. For each agent, provide:
- The diff (or instruct them to run `git diff <diff_base>` using the base from Step 1)
- The list of changed files
- Architecture context from Step 2, if available

Example launch:
> Launch `structural-reviewer`, `code-analyzer`, `security-reviewer`, `comment-analyzer`, `type-design-analyzer` (and conditionally `error-handling-reviewer`, `test-coverage-reviewer`) in parallel. Each agent reviews the diff from `git diff <diff_base>`.

Wait for all Phase 1 agents to complete.

## Step 5: Launch Phase 2 (Code Simplifier)

If Phase 1 found **no critical issues**, launch `code-simplifier` to suggest clarity and maintainability improvements.

If critical issues were found, skip Phase 2 — the author should fix critical issues first, simplification comes later.

## Step 6: Aggregate Findings

Collect findings from all agents and process:

1. **Deduplicate**: If multiple agents flag the same file:line for the same issue, keep the most detailed finding
2. **Normalise severity**: The `golang-standards-reviewer` uses 🚨 Critical / ⚠️ Important / 💡 Style. Map these to `critical / warning / suggestion` respectively when aggregating with other agents' output
3. **Group by severity**: critical → warning → suggestion → nit
4. **Cap nits**: Max 3 nits total across all agents. Stop adding nits to the aggregate once 3 are reached — do not collect more than 3. When the cap is hit, emit `nit=3 (capped)` in the final `SEVERITY_SUMMARY` line
5. **Tag source**: Prefix each finding with the agent that produced it

## Step 7: Output

Present aggregated findings in this format:

```
## Code Review — <branch> → <target> [local mode if applicable]

### Critical (N found)

[agent-name] [critical] Category — Description (confidence: N)

Explanation.

File: <path>:<line>
Suggested fix: <recommendation>

### Warnings (N found)

...

### Suggestions (N found)

...

### Nits (N found, max 3)

...

### Summary

- Agents run: <list>
- Total findings: N (X critical, Y warning, Z suggestion, W nit)
- Architecture context: included/not available
```

If no findings across all agents, confirm the code looks good with a brief summary of what was reviewed.
