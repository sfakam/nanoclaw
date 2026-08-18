---
name: add-webex-poll
description: Add Webex channel integration via REST polling (no public webhook URL required).
---

# Add Webex (Polling) Channel

Adds Cisco Webex support via REST polling — no webhook, no public URL. Suitable
for enterprise installs behind firewalls or NAT where the webhook-based
`/add-webex` adapter can't receive inbound events.

The adapter polls `/v1/rooms` every 3 seconds, skipping rooms whose `lastActivity`
hasn't changed, then fetches recent messages for changed rooms and routes them.
Mention detection reads the `mentionedPeople` array from the REST response —
no webhook subscription needed.

**Trade-offs vs the webhook adapter:**

| | Polling (`webex-poll`) | Webhook (`webex`) |
|---|---|---|
| Public URL required | No | Yes |
| Latency | ~3 s | Instant |
| Thread support | No | Yes |
| Mention-sticky wiring | No | Yes |

The mechanical steps under **Apply** carry `nc:` directive fences: an agent
reads the prose and applies them, and a parser can apply them deterministically
from the same document. Every directive is idempotent, so the whole skill is
safe to re-run; anything a parser can't apply falls back to the prose beside it.

## Apply

### 1. Copy the adapter and its registration test

Fetch the `channels` branch and copy the adapter and its test into
`src/channels/` (overwrite — the branch is canonical):

```nc:copy from-branch:channels
src/channels/webex-poll.ts
src/channels/webex-poll-registration.test.ts
```

### 2. Register the adapter

Append the self-registration import to the channel barrel (skipped if already
present). This is the skill's only reach-in into core:

```nc:append to:src/channels/index.ts
import './webex-poll.js';
```

### 3. Build and validate

Build first to guard the typed core calls, then run the registration test.
The adapter uses Node's built-in `fetch` API — no extra packages to install.

```nc:run effect:build
pnpm run build
```
```nc:run effect:test
pnpm exec vitest run src/channels/webex-poll-registration.test.ts
```

`webex-poll-registration.test.ts` imports the real channel barrel and asserts
the registry contains `webex-poll`. It goes red if the import line is deleted or
if the barrel fails to evaluate.

## Credentials

### Create the Webex bot

1. Go to [developer.webex.com](https://developer.webex.com/my-apps/new/bot) and create a new bot.
2. Copy the **Bot Access Token**.

```nc:prompt bot_token secret
Paste the Bot Access Token — from the Webex bot you created.
```
```nc:env-set
WEBEX_BOT_TOKEN={{bot_token}}
```

No webhook secret needed — the polling adapter calls out to Webex, it never
receives inbound HTTP from Webex.

## Next Steps

If you're in the middle of `/setup`, return to the setup flow now. Otherwise run
`/manage-channels` to wire this channel to an agent group.

## Channel Info

- **type**: `webex-poll`
- **terminology**: Webex has "spaces." A space can be a group conversation or a 1:1 direct message with the bot.
- **how-to-find-id**: Open the space in Webex, click the space name > Settings — the Space ID is listed there. Or use the Webex API (`GET /v1/rooms`) to list spaces and their IDs. The adapter prefixes room IDs with `webex-poll:` internally.
- **supports-threads**: no
- **typical-use**: Enterprise installs that can't expose a public webhook URL — corporate firewalls, VPN-only networks, local dev.
- **default-isolation**: Same agent group for spaces where you're the primary user. Separate agent group for spaces with different teams or sensitive information.

## Troubleshooting

**Sends fail with 401.** The Bot Access Token shown at developer.webex.com is the
bot-specific token (not the 12-hour personal access token on the API docs pages —
that one expires and causes 401s). Regenerate on the bot page; update `WEBEX_BOT_TOKEN`.

**Messages never reach the agent.** The polling loop logs `webex-poll: poll error`
on repeated failure. Check `logs/nanoclaw.log` for the error and confirm the bot
token is set with `grep WEBEX_BOT_TOKEN .env`. The bot must be a member of the
space to see its messages.

**Bot sees its own messages.** The adapter filters by `personId` fetched at startup
via `GET /v1/people/me`. If this fetch fails at startup, the adapter falls through
without filtering and routes its own messages. The startup log prints `botPersonId`
on success; check `logs/nanoclaw.log` for the ready message.
