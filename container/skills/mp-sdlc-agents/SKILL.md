<!-- Installed from marketplace plugin: sdlc/agents -->
# Specialized Agents (sdlc)

You have access to the following specialized agents via the `delegate_to_agent` MCP tool.
Use them by calling `mcp__nanoclaw-plugins__delegate_to_agent` with the agent name and prompt.

## Available Agents

- **capability-reporter**: Generate and publish capability reports using jira_report.py directly. For each registered team parent page, run the CLI with report-type capability and publish under that parent.
- **code-analyzer**: Use this agent to review code for correctness, conventions, and performance. Detects bugs and evaluates code quality. Launch as part of a parallel code review or standalone after writing code.
- **code-simplifier**: Use this agent to simplify code for clarity and maintainability after the review pass. Reduces complexity, eliminates redundancy, and applies project standards — without changing behavior. Launch as the final step of a code review, after other agents have completed.
- **comment-analyzer**: Use this agent to analyze code comments for accuracy, completeness, and long-term maintainability. Detects comment rot, misleading documentation, and comments that restate obvious code. Launch as part of a parallel code review when comments or docstrings are added/modified.
- **custom-reviewer**: Use this agent to enforce repo-specific review guidelines from .review_instructions.md. Reads the instructions file and reviews the diff against those project-specific rules. Launch as part of a parallel code review when .review_instructions.md exists.
- **error-handling-reviewer**: Use this agent to audit error handling in code changes. Identifies silent failures, broad catches, inadequate logging, and misleading fallback behavior. Launch as part of a parallel code review when the diff contains error handling code.
- **full-pr-reviewer**: Specialized code review agent for the SPOCK/PLX platform at Akamai. Reviews PRs for bugs, security issues, breaking changes, and style/logging consistency with the surrounding codebase.
- **golang-standards-reviewer**: Use this agent to review Go code against Akamai InfraSec Golang coding standards. Covers package declarations, project layout, naming conventions, error handling, concurrency patterns, logging, configuration, testing, HTTP, io.Reader handling, messaging, observability, dependency injection, code style, and SOLID principles (applied to Go packages, types, and interfaces). Produces a structured review with Critical/Important/Style findings and an APPROVE/REQUEST CHANGES recommendation. Launch as part of a parallel code review when .go files are changed.
- **PLX Story Creator**: Creates PLX Jira Stories interactively. Asks for PLX Program and description, then generates a formatted Jira story with summary, structured description, implementation subtasks, suggested test cases, and a pre-filled Jira creation URL.
- **qa-automator**: Use this agent to identify automation candidates from test cases and produce test skeletons. Analyzes existing test coverage and suggests where automation adds the most value. Launch as part of a QA workflow or standalone when building a test suite.
- **qa-designer**: Use this agent to design test cases and scenarios for a feature or change. Produces functional, edge case, and negative test cases. Launch as part of a QA workflow or standalone when defining test coverage.
- **qa-executor**: Use this agent to review test execution results, identify gaps against the QA plan, and surface defects or coverage shortfalls. Launch after test runs or as part of a QA workflow review.
- **qa-planner**: Use this agent to create a structured QA plan for a feature, sprint, or release. Defines scope, priorities, resource needs, and execution strategy. Launch as part of a QA workflow or when defining a testing strategy.
- **security-reviewer**: Use this agent to assess security vulnerabilities introduced by code changes. High-confidence only (>80%) — flags concrete, exploitable issues, not theoretical concerns. Launch as part of a parallel code review.
- **structural-reviewer**: Use this agent to analyze the structural coherence and completeness of code changes. Identifies mixed concerns, missing pieces, and scope issues in a diff. Launch as part of a parallel code review.
- **test-coverage-reviewer**: Use this agent to analyze test coverage quality and completeness for code changes. Identifies untested error paths, missing edge cases, and brittle tests. Launch as part of a parallel code review when non-test source files are changed.
- **type-design-analyzer**: Use this agent to analyze type design quality — encapsulation, invariant expression, and enforcement. Launch as part of a parallel code review when new types, classes, or data structures are introduced or modified.
- **zephyr-report**: Use this agent to produce a QA execution report showing who tested epics within a given timeframe, using Zephyr test cycle data. Works with any Jira epic project and test-cases project pair configured below.

## Agent Details

### capability-reporter

Generate and publish capability reports using jira_report.py directly. For each registered team parent page, run the CLI with report-type capability and publish under that parent.

To use this agent, call the `delegate_to_agent` tool from the `nanoclaw-plugins` MCP server:
`delegate_to_agent({ agent_name: "capability-reporter", prompt: "<your task>" })`

---

### code-analyzer

Use this agent to review code for correctness, conventions, and performance. Detects bugs and evaluates code quality. Launch as part of a parallel code review or standalone after writing code.

To use this agent, call the `delegate_to_agent` tool from the `nanoclaw-plugins` MCP server:
`delegate_to_agent({ agent_name: "code-analyzer", prompt: "<your task>" })`

---

### code-simplifier

Use this agent to simplify code for clarity and maintainability after the review pass. Reduces complexity, eliminates redundancy, and applies project standards — without changing behavior. Launch as the final step of a code review, after other agents have completed.

To use this agent, call the `delegate_to_agent` tool from the `nanoclaw-plugins` MCP server:
`delegate_to_agent({ agent_name: "code-simplifier", prompt: "<your task>" })`

---

### comment-analyzer

Use this agent to analyze code comments for accuracy, completeness, and long-term maintainability. Detects comment rot, misleading documentation, and comments that restate obvious code. Launch as part of a parallel code review when comments or docstrings are added/modified.

To use this agent, call the `delegate_to_agent` tool from the `nanoclaw-plugins` MCP server:
`delegate_to_agent({ agent_name: "comment-analyzer", prompt: "<your task>" })`

---

### custom-reviewer

Use this agent to enforce repo-specific review guidelines from .review_instructions.md. Reads the instructions file and reviews the diff against those project-specific rules. Launch as part of a parallel code review when .review_instructions.md exists.

To use this agent, call the `delegate_to_agent` tool from the `nanoclaw-plugins` MCP server:
`delegate_to_agent({ agent_name: "custom-reviewer", prompt: "<your task>" })`

---

### error-handling-reviewer

Use this agent to audit error handling in code changes. Identifies silent failures, broad catches, inadequate logging, and misleading fallback behavior. Launch as part of a parallel code review when the diff contains error handling code.

To use this agent, call the `delegate_to_agent` tool from the `nanoclaw-plugins` MCP server:
`delegate_to_agent({ agent_name: "error-handling-reviewer", prompt: "<your task>" })`

---

### full-pr-reviewer

Specialized code review agent for the SPOCK/PLX platform at Akamai. Reviews PRs for bugs, security issues, breaking changes, and style/logging consistency with the surrounding codebase.

To use this agent, call the `delegate_to_agent` tool from the `nanoclaw-plugins` MCP server:
`delegate_to_agent({ agent_name: "full-pr-reviewer", prompt: "<your task>" })`

---

### golang-standards-reviewer

Use this agent to review Go code against Akamai InfraSec Golang coding standards. Covers package declarations, project layout, naming conventions, error handling, concurrency patterns, logging, configuration, testing, HTTP, io.Reader handling, messaging, observability, dependency injection, code style, and SOLID principles (applied to Go packages, types, and interfaces). Produces a structured review with Critical/Important/Style findings and an APPROVE/REQUEST CHANGES recommendation. Launch as part of a parallel code review when .go files are changed.

To use this agent, call the `delegate_to_agent` tool from the `nanoclaw-plugins` MCP server:
`delegate_to_agent({ agent_name: "golang-standards-reviewer", prompt: "<your task>" })`

---

### PLX Story Creator

Creates PLX Jira Stories interactively. Asks for PLX Program and description, then generates a formatted Jira story with summary, structured description, implementation subtasks, suggested test cases, and a pre-filled Jira creation URL.

To use this agent, call the `delegate_to_agent` tool from the `nanoclaw-plugins` MCP server:
`delegate_to_agent({ agent_name: "PLX Story Creator", prompt: "<your task>" })`

---

### qa-automator

Use this agent to identify automation candidates from test cases and produce test skeletons. Analyzes existing test coverage and suggests where automation adds the most value. Launch as part of a QA workflow or standalone when building a test suite.

To use this agent, call the `delegate_to_agent` tool from the `nanoclaw-plugins` MCP server:
`delegate_to_agent({ agent_name: "qa-automator", prompt: "<your task>" })`

---

### qa-designer

Use this agent to design test cases and scenarios for a feature or change. Produces functional, edge case, and negative test cases. Launch as part of a QA workflow or standalone when defining test coverage.

To use this agent, call the `delegate_to_agent` tool from the `nanoclaw-plugins` MCP server:
`delegate_to_agent({ agent_name: "qa-designer", prompt: "<your task>" })`

---

### qa-executor

Use this agent to review test execution results, identify gaps against the QA plan, and surface defects or coverage shortfalls. Launch after test runs or as part of a QA workflow review.

To use this agent, call the `delegate_to_agent` tool from the `nanoclaw-plugins` MCP server:
`delegate_to_agent({ agent_name: "qa-executor", prompt: "<your task>" })`

---

### qa-planner

Use this agent to create a structured QA plan for a feature, sprint, or release. Defines scope, priorities, resource needs, and execution strategy. Launch as part of a QA workflow or when defining a testing strategy.

To use this agent, call the `delegate_to_agent` tool from the `nanoclaw-plugins` MCP server:
`delegate_to_agent({ agent_name: "qa-planner", prompt: "<your task>" })`

---

### security-reviewer

Use this agent to assess security vulnerabilities introduced by code changes. High-confidence only (>80%) — flags concrete, exploitable issues, not theoretical concerns. Launch as part of a parallel code review.

To use this agent, call the `delegate_to_agent` tool from the `nanoclaw-plugins` MCP server:
`delegate_to_agent({ agent_name: "security-reviewer", prompt: "<your task>" })`

---

### structural-reviewer

Use this agent to analyze the structural coherence and completeness of code changes. Identifies mixed concerns, missing pieces, and scope issues in a diff. Launch as part of a parallel code review.

To use this agent, call the `delegate_to_agent` tool from the `nanoclaw-plugins` MCP server:
`delegate_to_agent({ agent_name: "structural-reviewer", prompt: "<your task>" })`

---

### test-coverage-reviewer

Use this agent to analyze test coverage quality and completeness for code changes. Identifies untested error paths, missing edge cases, and brittle tests. Launch as part of a parallel code review when non-test source files are changed.

To use this agent, call the `delegate_to_agent` tool from the `nanoclaw-plugins` MCP server:
`delegate_to_agent({ agent_name: "test-coverage-reviewer", prompt: "<your task>" })`

---

### type-design-analyzer

Use this agent to analyze type design quality — encapsulation, invariant expression, and enforcement. Launch as part of a parallel code review when new types, classes, or data structures are introduced or modified.

To use this agent, call the `delegate_to_agent` tool from the `nanoclaw-plugins` MCP server:
`delegate_to_agent({ agent_name: "type-design-analyzer", prompt: "<your task>" })`

---

### zephyr-report

Use this agent to produce a QA execution report showing who tested epics within a given timeframe, using Zephyr test cycle data. Works with any Jira epic project and test-cases project pair configured below.

To use this agent, call the `delegate_to_agent` tool from the `nanoclaw-plugins` MCP server:
`delegate_to_agent({ agent_name: "zephyr-report", prompt: "<your task>" })`

