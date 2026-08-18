# Anthropic Foundry Setup

How to run NanoClaw agents against your organization's Claude Foundry gateway instead of the public Anthropic API.

## Prerequisites

- NanoClaw v2 with `DEFAULT_AGENT_PROVIDER=claude`
- Access to your organization's Foundry gateway and a valid subscription key
- `src/providers/index.ts` must contain `import './claude.js'` (present by default on Foundry installs)

## `.env` config

Add these to `.env` in the NanoClaw root:

```env
ANTHROPIC_BASE_URL=https://<your-foundry-gateway-url>/apim/claude
ANTHROPIC_FOUNDRY_BASE_URL=https://<your-foundry-gateway-url>/apim/claude
ANTHROPIC_FOUNDRY_API_KEY=<your-subscription-key>
CLAUDE_CODE_USE_FOUNDRY=1
ANTHROPIC_CUSTOM_HEADERS=user-id: <your-user-id>
```

> `ANTHROPIC_BASE_URL` and `ANTHROPIC_FOUNDRY_BASE_URL` point to the same endpoint. The former is used by the non-Foundry SDK path; the latter by Claude Code's Foundry mode.

## How it works

`src/providers/claude.ts` reads the Foundry vars from `.env` and injects them into every agent container's environment at spawn time. It also sets `NO_PROXY=<your-foundry-gateway-url>` so containers connect directly to the gateway — required because Foundry subscription key auth is handled natively by Claude Code, not by OneCLI's header injection.

No iptables rules for Docker → OneCLI ports are needed.

## Apply changes

```bash
pnpm run build
systemctl --user restart nanoclaw-v2-*.service
```

## Verify

Send a message to your agent. In the container logs you should see:

```
[poll-loop] Result: <message to="...">
```

If you see `API retry (retryable: true)` instead, check:

1. `ANTHROPIC_FOUNDRY_API_KEY` is a valid subscription key — test directly:
   ```bash
   curl -H "x-api-key: <key>" \
        -H "user-id: <your-user-id>" \
        -H "anthropic-version: 2023-06-01" \
        -H "content-type: application/json" \
        -d '{"model":"claude-sonnet-4-5","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}' \
        https://<your-foundry-gateway-url>/apim/claude/v1/messages
   ```
2. `CLAUDE_CODE_USE_FOUNDRY=1` is set in `.env`
3. The service was restarted after editing `.env`

## Code changes (reference)

| File | Change |
|------|--------|
| `src/providers/claude.ts` | Reads `ANTHROPIC_CUSTOM_HEADERS`, `ANTHROPIC_FOUNDRY_API_KEY`, `ANTHROPIC_FOUNDRY_BASE_URL`, `CLAUDE_CODE_USE_FOUNDRY` from `.env` and forwards them into container env; sets `NO_PROXY` to the Foundry hostname |
| `.env` | Added `ANTHROPIC_FOUNDRY_API_KEY`, `ANTHROPIC_FOUNDRY_BASE_URL`, `CLAUDE_CODE_USE_FOUNDRY`, `ANTHROPIC_CUSTOM_HEADERS` |
