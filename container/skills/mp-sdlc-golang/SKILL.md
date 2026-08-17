<!-- Installed from marketplace plugin: sdlc/golang -->
<!-- MCP tools are available via the nanoclaw-plugins MCP server. -->
<!-- If a tool is shown as mcp__<server>__<tool>, use mcp__nanoclaw-plugins__<tool> instead. -->
<!-- Marketplace scripts are available at /marketplace/plugins/sdlc/ (e.g. scripts/, skills/, servers/) -->

---
name: golang-review
description: Perform a deep Go code review against Akamai InfraSec Golang coding standards. Checks project layout, naming conventions, error handling, concurrency, logging, configuration, testing, HTTP patterns, messaging, observability, and dependency injection. Use when reviewing Go code changes or auditing a Go codebase.
argument-hint: "[--local] [<target-branch>]"
---

Perform a focused Go coding standards review on the current branch's changes.

## Step 1: Gather Context

Parse `$ARGUMENTS` for the `--local` flag and target branch (default: `main` or `master`).

### Mode selection

- **Default mode** (no `--local`): Review committed changes between branches.
  ```bash
  git diff <target_branch>...HEAD
  git diff --name-only <target_branch>...HEAD
  ```

- **Local mode** (`--local`): Review everything not yet upstream — local commits AND uncommitted changes.
  ```bash
  git diff origin/<target_branch>
  git diff --name-only origin/<target_branch>
  ```
  If `origin/<target_branch>` does not exist, fall back to `<target_branch>` with a warning.

## Step 2: Verify Go Files Exist

Check whether the changeset includes `.go` files:

```bash
git diff --name-only <diff_base> | grep '\.go$'
```

If no `.go` files are changed, output:

> No Go source files changed in this diff. Nothing to review against Go coding standards.

And stop.

## Step 3: Gather Module Context

Collect project structure context to help the reviewer:

```bash
# Show module name and Go version
head -5 go.mod 2>/dev/null || echo "no go.mod found"

# Show changed Go files grouped by package
git diff --name-only <diff_base> | grep '\.go$' | sort
```

Also check if a `.golangci.yaml` exists — mention its presence in the review context.

## Step 4: Launch Review

Launch the `golang-standards-reviewer` agent with:
- The full diff (output of `git diff <diff_base>` filtered to `.go` files)
- The list of changed Go files
- The module name and Go version from `go.mod`
- Whether `.golangci.yaml` is present

```bash
# Get the Go-only diff
git diff <diff_base> -- '*.go'
```

Instruct the agent to:
1. Review all changed `.go` files against the Akamai InfraSec Go coding standards
2. Flag any violation with file path, line number, and specific fix
3. Group findings by severity: critical → warning → suggestion → nit
4. Cap nits at 3 total

## Step 5: Output

Present the agent's findings and append a summary:

```
## Go Standards Review — <branch> → <target> [local mode if applicable]

<agent findings here>

---
### Review Summary

- Go files reviewed: <list of changed .go files>
- Module: <module name>
- Go version: <version from go.mod>
- golangci-lint config: present / not found
- Total findings: N (X critical, Y warning, Z suggestion, W nit)
```

If critical findings exist, close with:

> **Action required:** Address critical findings before merging. Critical violations risk runtime panics, data races, goroutine leaks, or architectural debt that is expensive to untangle later.

If no findings, close with:

> The Go changes are idiomatic and consistent with Akamai InfraSec coding standards. Good to merge from a Go standards perspective.
