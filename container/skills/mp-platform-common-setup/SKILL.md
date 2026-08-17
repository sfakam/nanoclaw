<!-- Installed from marketplace plugin: platform-common/setup -->
<!-- MCP tools are available via the nanoclaw-plugins MCP server. -->
<!-- If a tool is shown as mcp__<server>__<tool>, use mcp__nanoclaw-plugins__<tool> instead. -->
<!-- Marketplace scripts are available at /marketplace/plugins/platform-common/ (e.g. scripts/, skills/, servers/) -->

---
name: setup
description: Guided setup for platform-common plugin dependencies. Detects missing runtimes (uv, pnpm) and environment variables, then installs/configures them interactively.
disable-model-invocation: false
allowed-tools: Bash
---

# Platform Common Setup

Interactive dependency setup for the platform-common plugin. Ensures all runtimes needed to run the shared MCP servers (Jira, Bitbucket, Confluence, Webex) are installed.

## Procedure

Run each step below **in order**. Before performing any install, ask the user for confirmation. Skip steps where the tool is already present.

### 1. Detect platform

```bash
uname -s
command -v brew
```

Use Homebrew on macOS if available; otherwise fall back to curl-based installers.

### 2. uv

Check: `command -v uv`

Required for all Python MCP servers (Jira, Bitbucket, Confluence).

If missing, ask the user then install:
- **macOS (brew):** `brew install uv`
- **Other:** `curl -LsSf https://astral.sh/uv/install.sh | sh`

After install, source the shell profile.

### 3. pnpm

Check: `command -v pnpm`

Required for the Webex Bot MCP server.

If missing, ask the user then install:
- **macOS (brew):** `brew install pnpm`
- **Other:** `curl -fsSL https://get.pnpm.io/install.sh | sh -`

After install, source the shell profile:
```bash
source ~/.bash_profile 2>/dev/null || source ~/.zshrc 2>/dev/null || source ~/.bashrc 2>/dev/null
export PATH="$HOME/.local/share/pnpm:$PATH"
```

### 4. Node.js / npm

Check: `command -v npm`

If missing, ask the user then install:
- **macOS (brew):** `brew install node`
- **Other:** Direct the user to https://nodejs.org/ or suggest using nvm

After install, source the shell profile.

### 5. Environment Variables

Check for required environment variables:

```bash
echo "WEBEX_BOT_URL=${WEBEX_BOT_URL:-<not set>}"
```

#### WEBEX_BOT_URL

Required only if using the Webex Bot MCP server (`/webex` skill).

If not set and the user wants Webex integration, instruct them to add to their shell profile:

```bash
export WEBEX_BOT_URL="https://your-webex-bot.example.com"
```

The URL must:
- Use HTTPS (HTTP is rejected)
- Point to a running instance of [go-webex-bot](https://git.source.akamai.com/users/rmangane/repos/go-webex-bot/browse)
- Be reachable (connectivity is verified on MCP server startup)

### 6. MCP server sync

Install dependencies for each MCP server under the plugin:

```bash
export PATH="$HOME/.local/bin:$HOME/.local/share/pnpm:$PATH"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/marketplaces/infrasec-agentic-plugins/plugins/platform-common}"

for server_dir in "$PLUGIN_ROOT"/servers/*/; do
  if [[ -f "$server_dir/pyproject.toml" ]]; then
    (cd "$server_dir" && uv sync)
  elif [[ -f "$server_dir/pnpm-lock.yaml" ]]; then
    (cd "$server_dir" && pnpm install --frozen-lockfile)
  fi
done
```

## Summary

After all steps complete, print a summary showing:
- What was installed (or already present and skipped)
- Environment variables status (set or not set)
- Confirm that no restart is needed — everything is active in the current session
