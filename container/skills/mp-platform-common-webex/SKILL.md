<!-- Installed from marketplace plugin: platform-common/webex -->
<!-- MCP tools are available via the nanoclaw-plugins MCP server. -->
<!-- If a tool is shown as mcp__<server>__<tool>, use mcp__nanoclaw-plugins__<tool> instead. -->
<!-- Marketplace scripts are available at /marketplace/plugins/platform-common/ (e.g. scripts/, skills/, servers/) -->

---
name: webex
description: Send Webex messages to users or rooms. Use when notifying someone via Webex or posting to a team space.
argument-hint: "[email|room] [message]"
---

# Webex Messaging Skill

Send messages programmatically through the Webex bot to individuals or team spaces.

## Trigger Patterns

This skill should be invoked when:
- User wants to send a Webex message
- User wants to notify someone via chat
- User mentions "webex", "message", "notify"
- User wants to post to a team space or room

## Prerequisites

The Webex bot must be running at a public HTTPS endpoint. The `WEBEX_BOT_URL` environment variable is **required** and must:
- Be set (no default)
- Use HTTPS protocol
- Be reachable (connectivity is verified on MCP server startup)

If any of these conditions fail, the MCP server will abort and the tools will not be available.

## Available Tools

### send_message
Send a message to a room (group) or person (1:1).

**Target (exactly one required):**
- `room_id`: Room ID for group messages
- `email`: Email address for 1:1 messages (preferred)
- `person_id`: Person ID for 1:1 messages

**Content (at least one required):**
- `text`: Plain text message
- `markdown`: Markdown formatted message (supports **bold**, *italic*, lists, `code`)

**Optional:**
- `parent_id`: Parent message ID for threaded replies (rooms only)

### list_rooms
List all rooms the bot is a member of. Use this to discover room IDs.

**No parameters required.**

### get_room
Get details about a specific room.

**Required parameters:**
- `room_id`: The Webex room ID

## Usage Patterns

### Send Direct Message to User

When the user wants to message a specific person:

1. Identify the recipient's email address (ask if not provided)
2. Compose the message content
3. Use `send_message` with `email`

```
User: "Message alice@company.com that her PR was approved"
Action: send_message(email="alice@company.com", text="Your PR was approved!")
```

### Send Message to Team Room

When the user wants to post to a team space:

1. If room ID is not provided, use `list_rooms` to find available rooms
2. Present room options to the user if multiple matches
3. Use `send_message` with `room_id`

```
User: "Post to the ops channel that the deployment is done"
Action:
1. list_rooms() -> find "Ops Team" room
2. send_message(room_id="...", markdown="**Deployment complete**")
```

### Thread Replies

For threaded conversations in rooms:

1. Get the parent message ID from context
2. Use `send_message` with `room_id` and `parent_id`

```
send_message(
  room_id="...",
  parent_id="Y2lzY29zcGFyazovL3VzL01FU1NBR0UvMTIzNDU",
  text="Thanks for the update!"
)
```

## Message Formatting

The bot supports Webex markdown:

| Format | Syntax |
|--------|--------|
| Bold | `**text**` |
| Italic | `*text*` |
| Code | `` `code` `` |
| Code block | ```` ```code``` ```` |
| Bullet list | `- item` |
| Numbered list | `1. item` |
| Link | `[text](url)` |
| Mention | `<@personEmail:user@company.com>` |

## Error Handling

- **Tools not available**: The `WEBEX_BOT_URL` environment variable is missing, uses HTTP instead of HTTPS, or the bot is unreachable. Check the MCP server logs.
- **Recipient not found**: Verify the email address is correct and the person exists in Webex
- **Room not found**: Use `list_rooms` to verify the bot is a member of the room
- **Permission denied**: The bot can only message rooms it's a member of and people who have interacted with it

## Examples

### Example 1: Quick Notification
```
User: "Tell bob@example.com the build passed"
Action: send_message(email="bob@example.com", text="Build passed successfully!")
Response: "Message sent to bob@example.com"
```

### Example 2: Formatted Alert to Room
```
User: "Post an alert to the on-call room about the incident"
Action:
1. list_rooms() -> find room with "on-call" in title
2. send_message(room_id="Y2lzY29...", markdown="**INCIDENT ALERT**\n\n- Affected: API Gateway\n- Severity: P2")
Response: "Alert posted to On-Call room"
```

### Example 3: Find Available Rooms
```
User: "What rooms can you post to?"
Action: list_rooms()
Response: "The bot is a member of these rooms:
- Project Team (group)
- On-Call (group)
- John Doe (direct)"
```

## Security Notes

- HTTPS is enforced - HTTP connections are rejected
- The bot can only message rooms it has been added to
- Direct messages work with any Webex user, but some organizations may restrict external messaging
- Message content is transmitted to the Webex API - avoid sending sensitive credentials or secrets
