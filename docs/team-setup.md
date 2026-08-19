# Fork Setup Guide

Step-by-step instructions for a new team member to get this fork running: nanoclaw with Webex, Telegram, Anthropic Foundry gateway, and a dedicated agent (Jira + Confluence MCP via mTLS).

---

## Prerequisites

Before starting, you need:

- Linux or macOS machine with Docker available
- mTLS certificates in `~/.certs/`:
  - `<company>_ca_list.pem` — CA bundle
  - `<username>-YYYYMMDD.crt` and `<username>-YYYYMMDD.key` — your current client cert/key pair  
    (dated symlinks may point to the latest pair, but use the actual dated filename inside containers)
- SSH access to the marketplace git server (for the plugin repo)
- A Webex bot token ([developer.webex.com](https://developer.webex.com) → My Apps → Create a Bot)
- A Telegram bot token ([@BotFather](https://t.me/BotFather) → `/newbot`)
- Access to your organization's Anthropic Foundry gateway

---

## Phase 1 — Clone and base setup

```bash
git clone git@github.com:<your-org>/nanoclaw.git nanoclaw-v2
cd nanoclaw-v2
bash nanoclaw.sh
```

The script installs Node, pnpm, and Docker if missing, sets up OneCLI (the credential vault), builds the agent container (includes Python 3.11 + `uv`), and walks through creating your first agent group. Follow the prompts and pick **Telegram** as the first channel when asked.

---

## Phase 2 — Configure `.env`

After the wizard completes, edit `.env` in the project root. Add or update these values — do not commit this file:

```bash
# Foundry gateway (replaces direct Anthropic API)
ANTHROPIC_BASE_URL=https://<your-foundry-gateway-url>/apim/claude
ANTHROPIC_FOUNDRY_BASE_URL=https://<your-foundry-gateway-url>/apim/claude
ANTHROPIC_FOUNDRY_API_KEY=<your-foundry-api-key>
ANTHROPIC_CUSTOM_HEADERS=user-id: <your-username>_prod
CLAUDE_CODE_USE_FOUNDRY=1

# Telegram bot (from BotFather)
TELEGRAM_BOT_TOKEN=<your-telegram-bot-token>

# Webex bot
WEBEX_BOT_TOKEN=<your-webex-bot-token>
WEBEX_POLL_INTERVAL_MS=30000

# Marketplace repo
PLUGIN_MARKETPLACE_REPO=ssh://git@<your-git-server>/<org>/plugins.git
```

Then restart the service so Foundry config takes effect:

```bash
systemctl --user restart nanoclaw   # Linux
# launchctl kickstart -k gui/$(id -u)/com.nanoclaw   # macOS
```

---

## Phase 3 — Wire Webex to an agent

The Webex adapter uses polling (no inbound webhook required). You need the Webex room ID — find it by having the bot post in the room and checking logs, or look it up via the Webex API. It looks like `Y2lzY29zcGFyazovL3VzL1JPT00v...`.

```bash
# Create the messaging group
ncl messaging-groups create \
  --channel-type webex \
  --platform-id "<room-id>" \
  --name "My Webex Room"

# Get your agent group id
ncl groups list

# Wire to your agent group
ncl wirings create \
  --messaging-group-id <mg-id> \
  --agent-group-id <ag-id> \
  --engage-mode mention
```

---

## Phase 4 — Dedicated agent with Jira and Confluence MCP

This phase sets up a dedicated agent group with access to Jira and Confluence MCP servers (authenticated via your mTLS certificates) and the full marketplace skill set.

### 4a. Clone the marketplace repo

```bash
git clone ssh://git@<your-git-server>/<org>/plugins.git plugins/marketplace
```

### 4b. Create the agent group

```bash
ncl groups create --folder teamagent --name "TeamAgent"
# Note the group ID printed (ag-XXXX) — you'll use it in later steps
export AGENT_ID=<ag-id-from-above>
```

Wire it to your Webex room:

```bash
ncl messaging-groups create \
  --channel-type webex \
  --platform-id "<webex-room-id>" \
  --name "Team Room"

ncl wirings create \
  --messaging-group-id <mg-id> \
  --agent-group-id "$AGENT_ID" \
  --engage-mode mention
```

### 4c. Install marketplace skills

```bash
pnpm exec tsx scripts/setup-marketplace.ts
```

This reads `plugins/config.json`, clones or pulls the marketplace repo, and writes `SKILL.md` files for skills into `container/skills/mp-*/` with all paths rewritten to container-side locations.

### 4d. Allow `~/.certs` to be mounted into containers

The Jira and Confluence MCP servers authenticate via mTLS — they need access to your client certificates inside the container.

```bash
mkdir -p ~/.config/nanoclaw
cat > ~/.config/nanoclaw/mount-allowlist.json << 'EOF'
{
  "allowedRoots": [
    {
      "path": "~/.certs",
      "allowReadWrite": false,
      "description": "mTLS certificates for Jira/Confluence/Bitbucket MCP servers"
    }
  ],
  "blockedPatterns": [],
  "nonMainReadOnly": true
}
EOF
```

### 4e. Pre-warm the Python venvs

The MCP servers (`jira-mcp`, `confluence-mcp`, `bitbucket-mcp`) are Python packages that must be compiled from source on first run — this takes ~2 minutes. Pre-warming runs this once so containers start instantly.

```bash
# The image tag is in the format nanoclaw-agent-v2-<hash>:latest
IMAGE=$(docker images --filter "reference=nanoclaw-agent-v2*" --format "{{.Repository}}:{{.Tag}}" | head -1)
echo "Using image: $IMAGE"

docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e HOME=/home/node \
  -e UV_PROJECT_ENVIRONMENT=/workspace/agent/.uv-envs \
  -e NO_PROXY='*' \
  -v "$(pwd)/groups/teamagent:/workspace/agent" \
  -v "$(pwd)/plugins/marketplace:/marketplace:ro" \
  --entrypoint "" \
  "$IMAGE" \
  bash -c '
    echo "Warming jira-mcp..."
    uv run --directory /marketplace/plugins/platform-common/servers/jira-mcp jira-mcp --help > /dev/null 2>&1 || true
    echo "Warming confluence-mcp..."
    uv run --directory /marketplace/plugins/platform-common/servers/confluence-mcp confluence-mcp --help > /dev/null 2>&1 || true
    echo "Warming bitbucket-mcp..."
    uv run --directory /marketplace/plugins/platform-common/servers/bitbucket-mcp bitbucket-mcp --help > /dev/null 2>&1 || true
    echo "Done: $(ls /workspace/agent/.uv-envs/bin/ | grep -E "^jira|^confluence|^bitbucket")"
  '
```

You should see `jira-mcp`, `confluence-mcp`, and `bitbucket-mcp` printed at the end.

### 4f. Find your current cert filename

Absolute symlinks in `~/.certs/` break inside the container. Use the actual dated filename:

```bash
# List non-symlink certs — pick the newest one
ls -la ~/.certs/*.crt | grep -v "^l" | awk '{print $NF}' | sort | tail -3
# e.g. /home/<username>/.certs/<username>-20260505.crt
```

Your cert file is named `<username>-<YYYYMMDD>.crt`. Note the date portion — you'll use it below.

### 4g. Configure the MCP servers

Replace `<CERT_DATE>` with the date from your cert filename (e.g. `20260505`) and `<YOUR_USERNAME>` with your username:

```bash
# jira MCP server
ncl groups config add-mcp-server --id "$AGENT_ID" \
  --name jira \
  --command /workspace/agent/.uv-envs/bin/jira-mcp \
  --env "{
    \"JIRA_CA_CERT\":\"/workspace/extra/.certs/<company>_ca_list.pem\",
    \"JIRA_CLIENT_CERT\":\"/workspace/extra/.certs/<YOUR_USERNAME>-<CERT_DATE>.crt\",
    \"JIRA_CLIENT_KEY\":\"/workspace/extra/.certs/<YOUR_USERNAME>-<CERT_DATE>.key\",
    \"NO_PROXY\":\"*\",
    \"no_proxy\":\"*\",
    \"HTTPS_PROXY\":\"\",
    \"HTTP_PROXY\":\"\"
  }"

# confluence MCP server
ncl groups config add-mcp-server --id "$AGENT_ID" \
  --name confluence \
  --command /workspace/agent/.uv-envs/bin/confluence-mcp \
  --env "{
    \"CONFLUENCE_CA_CERT\":\"/workspace/extra/.certs/<company>_ca_list.pem\",
    \"CONFLUENCE_CLIENT_CERT\":\"/workspace/extra/.certs/<YOUR_USERNAME>-<CERT_DATE>.crt\",
    \"CONFLUENCE_CLIENT_KEY\":\"/workspace/extra/.certs/<YOUR_USERNAME>-<CERT_DATE>.key\",
    \"NO_PROXY\":\"*\",
    \"no_proxy\":\"*\",
    \"HTTPS_PROXY\":\"\",
    \"HTTP_PROXY\":\"\"
  }"

# bitbucket MCP server
ncl groups config add-mcp-server --id "$AGENT_ID" \
  --name akamai-bitbucket \
  --command /workspace/agent/.uv-envs/bin/bitbucket-mcp \
  --env "{
    \"BITBUCKET_CA_CERT\":\"/workspace/extra/.certs/<company>_ca_list.pem\",
    \"BITBUCKET_CLIENT_CERT\":\"/workspace/extra/.certs/<YOUR_USERNAME>-<CERT_DATE>.crt\",
    \"BITBUCKET_CLIENT_KEY\":\"/workspace/extra/.certs/<YOUR_USERNAME>-<CERT_DATE>.key\",
    \"NO_PROXY\":\"*\",
    \"no_proxy\":\"*\",
    \"HTTPS_PROXY\":\"\",
    \"HTTP_PROXY\":\"\"
  }"
```

Add the certs directory as a container mount:

```bash
pnpm exec tsx scripts/q.ts data/v2.db \
  "UPDATE container_configs
   SET additional_mounts='[{\"hostPath\":\"~/.certs\",\"readonly\":true}]',
       updated_at='$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'
   WHERE agent_group_id='$AGENT_ID'"
```

### 4h. Start the agent

```bash
ncl groups restart --id "$AGENT_ID" \
  --message "Setup complete — Jira, Confluence, and Bitbucket MCP tools are available."
```

Check it started cleanly:

```bash
docker logs $(docker ps --filter "name=nanoclaw-v2-teamagent" --format "{{.Names}}" | head -1) 2>&1 | tail -10
```

You should see lines like:

```
[agent-runner] Additional MCP server: jira (/workspace/agent/.uv-envs/bin/jira-mcp)
[agent-runner] Additional MCP server: confluence (/workspace/agent/.uv-envs/bin/confluence-mcp)
[agent-runner] Additional MCP server: akamai-bitbucket (/workspace/agent/.uv-envs/bin/bitbucket-mcp)
```

with no "Wait for MCP server" lines — the servers start instantly from the pre-warmed venv.

---

## Verification

Mention the agent in your wired Webex room and ask it to search Jira or list recent tickets. If the MCP tools resolve, the setup is complete.

---

## Ongoing maintenance

### Cert rotation (annual)

When your cert rotates, a new `<username>-YYYYMMDD.crt/.key` pair appears in `~/.certs/`. Update both MCP server configs:

```bash
# Remove old entries
ncl groups config remove-mcp-server --id "$AGENT_ID" --name jira
ncl groups config remove-mcp-server --id "$AGENT_ID" --name confluence

# Re-add with the new cert date (same commands as step 4g)
```

The pre-warmed venvs do not need to change — only the cert paths.

### Marketplace plugin updates

```bash
cd plugins/marketplace && git pull && cd ../..
pnpm exec tsx scripts/setup-marketplace.ts   # regenerates mp- SKILL.md files
ncl groups restart --id "$AGENT_ID"
```

### Syncing from upstream nanoclaw

This fork tracks upstream `nanocoai/nanoclaw`. To pull upstream updates:

```bash
git fetch origin
git merge origin/main
# Expected conflicts: container/Dockerfile, container/agent-runner/src/poll-loop.ts,
#                    src/providers/claude.ts, src/container-runner.ts
pnpm install
./container/build.sh
systemctl --user restart nanoclaw
```

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Agent times out on first message after restart | MCP servers are still initializing — pre-warm venvs (step 4e) if you skipped it |
| `Missing certificate files` in MCP server logs | You used a symlink path — use the dated filename (step 4f) |
| Jira/Confluence calls time out | The container HTTP proxy is intercepting mTLS traffic — `NO_PROXY=*` must be set (step 4g) |
| `nanoclaw-plugins` MCP server fails to start | UFW blocks Docker→host on port 13337 — this is expected; the plugin bridge is not used, MCP servers run directly |
| Host process crashes with `better-sqlite3` assertion (`(env) != nullptr`) | Node v24 incompatibility fixed by upgrading to `better-sqlite3@13.0.3` — run `pnpm add better-sqlite3@13.0.3 && pnpm run build && systemctl --user restart nanoclaw` |
| Webex room not receiving replies | Check `WEBEX_BOT_TOKEN` is set and the bot is a member of the room |
