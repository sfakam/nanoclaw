---
name: remove-webex-poll
description: Remove the webex-poll adapter — reverses every change made by add-webex-poll.
---

# Remove Webex (Polling) Channel

Reverses everything `/add-webex-poll` applied. Run this before re-running the
skill if something went wrong, or to remove the integration entirely.

## Remove

### 1. Remove the barrel import

```nc:line-remove from:src/channels/index.ts
import './webex-poll.js';
```

### 2. Delete the adapter files

```nc:delete
src/channels/webex-poll.ts
src/channels/webex-poll-registration.test.ts
```

### 3. Remove the credential

```nc:env-unset
WEBEX_BOT_TOKEN
```

> Only do this if no other channel uses `WEBEX_BOT_TOKEN` (e.g. the webhook
> `webex` adapter also reads it). Skip this step if both adapters are installed.

### 4. Build to verify

```nc:run effect:build
pnpm run build
```
