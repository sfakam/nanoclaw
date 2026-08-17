/**
 * Webex channel adapter — polling-based (no public webhook URL required).
 * Polls the Webex REST API for new messages on a configurable interval.
 * Self-registers on import.
 */

import { readEnvFile } from '../env.js';
import type { ChannelAdapter, ChannelDefaults, ChannelSetup, ConversationInfo, OutboundMessage } from './adapter.js';
import { registerChannelAdapter } from './channel-registry.js';
import { log } from '../log.js';

const POLL_INTERVAL_MS = Number(process.env.WEBEX_POLL_INTERVAL_MS ?? '30000');
const ROOM_POLL_DELAY_MS = 300; // stagger per-room requests to avoid rate limits
const WEBEX_API = 'https://webexapis.com/v1';

const WEBEX_DEFAULTS: ChannelDefaults = {
  dm: { engageMode: 'pattern', engagePattern: '.', threads: false, unknownSenderPolicy: 'request_approval' },
  group: { engageMode: 'mention', threads: true, unknownSenderPolicy: 'request_approval' },
  mentions: 'platform',
};

interface WebexRoom {
  id: string;
  type: 'direct' | 'group';
  title: string;
  lastActivity?: string; // ISO timestamp of most recent message
}

interface WebexMessage {
  id: string;
  roomId: string;
  personId: string;
  personEmail: string;
  text?: string;
  mentionedPeople?: string[];
  parentId?: string;
  created: string;
}

class WebexPollingAdapter implements ChannelAdapter {
  readonly name = 'webex';
  readonly channelType = 'webex';
  readonly supportsThreads = true;
  readonly defaults = WEBEX_DEFAULTS;

  private token: string;
  private botPersonId: string | null = null;
  private _config: ChannelSetup | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private _connected = false;
  /** roomId → ISO timestamp of last seen message (or last activity at seed time) */
  private lastSeenTime = new Map<string, string>();
  /** roomId → lastActivity timestamp seen on the room list, used to skip unchanged rooms */
  private lastActivityTime = new Map<string, string>();
  /** roomId → set of recently processed message IDs (dedup guard) */
  private processedIds = new Map<string, Set<string>>();
  /** rooms we've emitted metadata for */
  private knownRooms = new Set<string>();

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${WEBEX_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('Retry-After') ?? '10');
        throw Object.assign(new Error(`rate-limited: retry after ${retryAfter}s`), { status: 429, retryAfter });
      }
      const text = await res.text().catch(() => '');
      throw new Error(`Webex ${init?.method ?? 'GET'} ${path} → ${res.status}: ${text}`);
    }
    return res.json() as T;
  }

  async setup(config: ChannelSetup): Promise<void> {
    this._config = config;
    const me = await this.request<{ id: string }>('/people/me');
    this.botPersonId = me.id;
    this._connected = true;
    this.schedulePoll();
    log.info('Webex polling adapter started', { botPersonId: this.botPersonId, pollIntervalMs: POLL_INTERVAL_MS });
  }

  async teardown(): Promise<void> {
    this._connected = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  isConnected(): boolean {
    return this._connected;
  }

  private schedulePoll(): void {
    this.pollTimer = setTimeout(() => void this.poll(), POLL_INTERVAL_MS);
  }

  private async poll(): Promise<void> {
    try {
      const { items: rooms } = await this.request<{ items: WebexRoom[] }>('/rooms?sortBy=lastactivity&max=100');
      // Only fetch messages for rooms whose lastActivity has advanced — skip the rest to stay within rate limits.
      const activeRooms = rooms.filter((room) => {
        const prev = this.lastActivityTime.get(room.id);
        if (room.lastActivity) this.lastActivityTime.set(room.id, room.lastActivity);
        // No previous record → seed on first poll (pollRoom will cursor-seed and return without routing)
        if (!prev) return true;
        return room.lastActivity ? room.lastActivity > prev : true;
      });
      for (const room of activeRooms) {
        if (!this._connected) break;
        await this.pollRoom(room);
        if (activeRooms.length > 1) await new Promise<void>((r) => setTimeout(r, ROOM_POLL_DELAY_MS));
      }
    } catch (err) {
      log.warn('Webex poll error', { err });
    } finally {
      if (this._connected) this.schedulePoll();
    }
  }

  private async pollRoom(room: WebexRoom): Promise<void> {
    try {
      const isDM = room.type === 'direct';
      // Webex bot tokens can only read messages that mention them in group spaces.
      // DM spaces have no such restriction.
      const mentionFilter = isDM ? '' : '&mentionedPeople=me';
      const { items: messages } = await this.request<{ items: WebexMessage[] }>(
        `/messages?roomId=${encodeURIComponent(room.id)}${mentionFilter}&max=10`,
      );
      if (messages.length === 0) return;

      // API returns newest first
      const newestTime = messages[0]!.created;
      const lastTime = this.lastSeenTime.get(room.id);
      this.lastSeenTime.set(room.id, newestTime);

      // First poll: seed cursor — don't replay history
      if (!lastTime) return;

      if (!this.processedIds.has(room.id)) this.processedIds.set(room.id, new Set());
      const seen = this.processedIds.get(room.id)!;

      const newMessages = messages
        .filter((m) => new Date(m.created).getTime() > new Date(lastTime).getTime() && !seen.has(m.id))
        .reverse(); // process oldest first

      if (newMessages.length === 0) return;

      const config = this._config!;

      if (!this.knownRooms.has(room.id)) {
        this.knownRooms.add(room.id);
        config.onMetadata(room.id, room.title, !isDM);
      }

      for (const msg of newMessages) {
        seen.add(msg.id);
        // Trim to last 50 IDs to bound memory
        if (seen.size > 50) seen.delete(seen.values().next().value!);
        if (msg.personId === this.botPersonId) continue;

        const isMention = isDM || (msg.mentionedPeople?.includes(this.botPersonId!) ?? false);
        const threadId = !isDM && msg.parentId ? msg.parentId : null;

        await config.onInbound(room.id, threadId, {
          id: msg.id,
          kind: 'chat',
          content: {
            text: msg.text ?? '',
            senderId: msg.personId, // router reads this to identify + upsert the user
            sender: msg.personEmail,
            personId: msg.personId,
            personEmail: msg.personEmail,
            roomId: room.id,
            roomType: room.type,
            mentionedPeople: msg.mentionedPeople,
          },
          timestamp: new Date(msg.created).toISOString(),
          isMention,
          isGroup: !isDM,
        });
      }
    } catch (err) {
      log.warn('Webex poll room error', { roomId: room.id, err });
    }
  }

  async deliver(platformId: string, threadId: string | null, message: OutboundMessage): Promise<string | undefined> {
    const content = message.content as Record<string, unknown> | string;
    const text =
      typeof content === 'string'
        ? content
        : ((content.markdown as string | undefined) ?? (content.text as string | undefined) ?? '');

    const payload: Record<string, unknown> = { roomId: platformId, markdown: text };
    if (threadId) payload.parentId = threadId;

    const res = await this.request<{ id: string }>('/messages', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.id;
  }

  async openDM(userHandle: string): Promise<string> {
    // Post a zero-width space to open/locate the 1:1 space without a visible message
    const res = await this.request<{ roomId: string }>('/messages', {
      method: 'POST',
      body: JSON.stringify({ toPersonEmail: userHandle, text: '​' }),
    });
    return res.roomId;
  }

  async syncConversations(): Promise<ConversationInfo[]> {
    const { items } = await this.request<{ items: WebexRoom[] }>('/rooms?max=100');
    return items.map((r) => ({ platformId: r.id, name: r.title, isGroup: r.type !== 'direct' }));
  }
}

registerChannelAdapter('webex', {
  factory: () => {
    const env = readEnvFile(['WEBEX_BOT_TOKEN']);
    if (!env.WEBEX_BOT_TOKEN) return null;
    return new WebexPollingAdapter(env.WEBEX_BOT_TOKEN);
  },
  defaults: WEBEX_DEFAULTS,
});
