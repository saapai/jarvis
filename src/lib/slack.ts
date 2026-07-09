import { WebClient } from '@slack/web-api';

let _slackClient: WebClient | null = null;
let _slackSyncClient: WebClient | null = null;

function getSlackClient(): WebClient {
  if (!_slackClient) {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) {
      throw new Error('Missing SLACK_BOT_TOKEN environment variable');
    }
    if (!token.startsWith('xoxb-')) {
      throw new Error('SLACK_BOT_TOKEN must be a bot token (starts with xoxb-). App-level tokens (xapp-) are not supported for Web API.');
    }
    _slackClient = new WebClient(token);
  }
  return _slackClient;
}

/**
 * Returns a Slack client for syncing/reading messages.
 * Prefers SLACK_USER_TOKEN (xoxp-) for full channel access,
 * falls back to SLACK_BOT_TOKEN if no user token is configured.
 */
function getSlackSyncClient(): WebClient {
  if (!_slackSyncClient) {
    const userToken = process.env.SLACK_USER_TOKEN;
    if (userToken) {
      console.log('[Slack] Using user token (xoxp-) for sync — full channel access');
      _slackSyncClient = new WebClient(userToken);
    } else {
      console.log('[Slack] No SLACK_USER_TOKEN found, falling back to bot token for sync');
      _slackSyncClient = getSlackClient();
    }
  }
  return _slackSyncClient;
}

export interface SlackFile {
  id: string;
  name: string;
  mimetype: string;
  url_private: string;
  url_private_download?: string;
  filetype: string;
  size: number;
}

export interface SlackMessage {
  ts: string;
  text: string;
  user?: string;
  channel: string;
  thread_ts?: string;
  files?: SlackFile[];
}

export async function fetchChannelMessages(
  channelName: string,
  oldest?: string
): Promise<SlackMessage[]> {
  const client = getSlackSyncClient();

  try {
    // Get channels - user token has access to all channels the user is in
    let allChannels: any[] = [];
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const channelList = await client.conversations.list({
        types: 'public_channel,private_channel',
        exclude_archived: true,
        limit: 200,
        cursor,
      });

      if (channelList.channels) {
        allChannels = [...allChannels, ...channelList.channels];
      }

      cursor = channelList.response_metadata?.next_cursor;
      hasMore = !!cursor;
    }

    console.log('[Slack] Fetching messages from channel:', channelName);
    console.log('[Slack] Total channels available:', allChannels.length);

    // Try exact match first
    let channel = allChannels.find(
      (ch) => ch.name === channelName
    );

    // If not found, try case-insensitive match
    if (!channel) {
      channel = allChannels.find(
        (ch) => ch.name?.toLowerCase() === channelName.toLowerCase()
      );
    }

    // If still not found, try partial match (for truncated names)
    if (!channel) {
      channel = allChannels.find(
        (ch) => ch.name?.toLowerCase().includes(channelName.toLowerCase()) ||
                channelName.toLowerCase().includes(ch.name?.toLowerCase() || '')
      );
    }

    if (!channel || !channel.id) {
      const availableChannels = allChannels.map(ch => ({
        name: ch.name,
        id: ch.id,
        isPrivate: ch.is_private,
      }));

      const announceChannels = availableChannels.filter(ch =>
        ch.name?.toLowerCase().includes('announce')
      );

      console.error('[Slack] Channel not found. Announce channels:', announceChannels);

      throw new Error(
        `Channel "${channelName}" not found among ${allChannels.length} visible channels.`
      );
    }

    const messages: SlackMessage[] = [];
    let messageCursor: string | undefined;
    let hasMoreMessages = true;

    while (hasMoreMessages) {
      const result = await client.conversations.history({
        channel: channel.id,
        oldest,
        cursor: messageCursor,
        limit: 200,
      });

      if (result.messages) {
        for (const msg of result.messages) {
          // Skip system messages (subtype indicates system events like channel_join, etc.)
          // Only process regular user messages
          if (msg.subtype && !['thread_broadcast'].includes(msg.subtype)) {
            continue;
          }
          
          // Get text from message
          const messageText = msg.text || '';

          // Extract file attachments (images, documents, etc.)
          const files: SlackFile[] = [];
          if (msg.files && Array.isArray(msg.files)) {
            for (const file of msg.files) {
              if (file.id && file.url_private) {
                files.push({
                  id: file.id,
                  name: file.name || 'untitled',
                  mimetype: file.mimetype || '',
                  url_private: file.url_private,
                  url_private_download: file.url_private_download,
                  filetype: file.filetype || '',
                  size: file.size || 0,
                });
              }
            }
          }

          // Include messages with text or files
          if (msg.ts && (messageText.trim().length > 0 || files.length > 0)) {
            messages.push({
              ts: msg.ts,
              text: messageText,
              user: msg.user,
              channel: channel.id,
              thread_ts: msg.thread_ts,
              files: files.length > 0 ? files : undefined,
            });
          }
        }
      }

      messageCursor = result.response_metadata?.next_cursor;
      hasMoreMessages = !!messageCursor;
    }

    return messages;
  } catch (error) {
    console.error('[Slack] Error fetching messages:', error);
    throw error;
  }
}

export async function getChannelId(channelName: string): Promise<string | null> {
  const client = getSlackSyncClient();
  
  try {
    const channelList = await client.conversations.list({
      types: 'public_channel,private_channel',
    });

    const channel = channelList.channels?.find(
      (ch) => ch.name === channelName
    );

    return channel?.id || null;
  } catch (error) {
    console.error('[Slack] Error getting channel ID:', error);
    return null;
  }
}

export interface ChannelInfo {
  id: string;
  name: string;
  isPrivate: boolean;
  purpose?: string;
  topic?: string;
}

export async function listAllChannels(): Promise<ChannelInfo[]> {
  const client = getSlackSyncClient();
  
  try {
    // Get all channels with pagination
    let allChannels: any[] = [];
    let cursor: string | undefined;
    let hasMore = true;
    
    while (hasMore) {
      const channelList = await client.conversations.list({
        types: 'public_channel,private_channel',
        exclude_archived: true,
        limit: 200,
        cursor,
      });
      
      if (channelList.channels) {
        allChannels = [...allChannels, ...channelList.channels];
      }
      
      cursor = channelList.response_metadata?.next_cursor;
      hasMore = !!cursor;
    }
    
    console.log('[Slack] Total channels found:', allChannels.length);
    console.log('[Slack] Private channels:', allChannels.filter(ch => ch.is_private).map(ch => ({
      name: ch.name,
      isMember: ch.is_member
    })));

    const channels: ChannelInfo[] = [];
    
    for (const ch of allChannels) {
        if (ch.id && ch.name) {
          const isPrivate = ch.is_private || false;
          
          let purpose = '';
          let topic = '';
          
          if (ch.purpose?.value) {
            purpose = ch.purpose.value;
          }
          
          if (ch.topic?.value) {
            topic = ch.topic.value;
          }
          
          channels.push({
            id: ch.id,
            name: ch.name,
            isPrivate,
            purpose,
            topic,
          });
        }
    }

    return channels;
  } catch (error) {
    console.error('[Slack] Error listing channels:', error);
    throw error;
  }
}

export async function resolveSlackUserName(userId: string): Promise<string | null> {
  const client = getSlackSyncClient();
  try {
    const result = await client.users.info({ user: userId });
    const profile = result.user?.profile;
    return profile?.display_name || result.user?.real_name || null;
  } catch (error) {
    console.error('[Slack] Error resolving user name:', error);
    return null;
  }
}

/**
 * Makes a Slack file publicly accessible and returns the public URL.
 * Uses Slack's files.sharedPublicURL to generate a permalink.
 * Requires the user token (xoxp-) with files:write scope.
 */
export async function makeFilePublic(fileId: string): Promise<string | null> {
  const client = getSlackSyncClient();
  try {
    const result = await client.files.sharedPublicURL({ file: fileId });
    if (result.ok && result.file) {
      // Construct the public URL from permalink_public
      const file = result.file as any;
      if (file.permalink_public) {
        // Slack public URLs need the pub_secret appended to url_private
        const pubSecret = file.permalink_public.split('-').pop();
        return `${file.url_private}?pub_secret=${pubSecret}`;
      }
    }
    return null;
  } catch (error: any) {
    // already_public is fine — file was previously shared
    if (error?.data?.error === 'already_public') {
      try {
        const info = await client.files.info({ file: fileId });
        const file = info.file as any;
        if (file?.permalink_public) {
          const pubSecret = file.permalink_public.split('-').pop();
          return `${file.url_private}?pub_secret=${pubSecret}`;
        }
      } catch {
        // ignore
      }
    }
    console.error('[Slack] Error making file public:', error);
    return null;
  }
}

/**
 * Returns all channels that should be synced for the digest.
 * Matches channels with "general" or "announcements" in the name.
 */
export async function getSyncableChannels(): Promise<string[]> {
  const channels = await listAllChannels();
  const patterns = ['general', 'announcements'];
  return channels
    .filter(ch => patterns.some(p => ch.name.toLowerCase().includes(p)))
    .map(ch => ch.name);
}

export async function detectAnnouncementsChannel(): Promise<string | null> {
  const { getOpenAI } = await import('@/lib/openai');
  
  try {
    const channels = await listAllChannels();
    
    if (channels.length === 0) {
      console.log('[Slack] No channels found');
      return null;
    }

    const channelList = channels.map((ch) => ({
      name: ch.name,
      isPrivate: ch.isPrivate,
      purpose: ch.purpose || '',
      topic: ch.topic || '',
    }));

    console.log('[Slack] Detecting announcements channel from', channels.length, 'channels');

    // First, try to find channels with "announce" in the name (highest priority)
    const announceChannels = channels.filter(ch => 
      ch.name.toLowerCase().includes('announce')
    );
    
    if (announceChannels.length > 0) {
      console.log('[Slack] Found channel with "announce" in name:', announceChannels[0].name);
      return announceChannels[0].name;
    }

    const prompt = `You are analyzing a list of Slack channels to identify which one is the announcements channel.

An announcements channel is typically used for:
- Official organization announcements
- Important updates and news
- Event notifications
- General information broadcasts
- May be named "announcements", "announcement", "news", "updates", or similar
- May be private (organization-specific) or public
- NOT a general discussion channel like "general" or "random"

CRITICAL: Do NOT select "general" or "random" channels. These are for general discussion, not announcements.

Here are the available channels:
${JSON.stringify(channelList, null, 2)}

Return the exact channel name (as it appears in the list) that is most likely the announcements channel. If you cannot determine one with confidence, return null.

Return JSON: { "channelName": "channel-name-here" or null }`;

    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that identifies the announcements channel in a Slack workspace. Return only valid JSON.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 200,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      console.log('[Slack] No response from LLM');
      return null;
    }

    const parsed = JSON.parse(content) as { channelName?: string | null };
    const detectedChannel = parsed.channelName;

    if (!detectedChannel) {
      console.log('[Slack] LLM could not determine announcements channel');
      return null;
    }

    const channel = channels.find((ch) => ch.name === detectedChannel);
    if (!channel) {
      console.log('[Slack] Detected channel not found in list:', detectedChannel);
      return null;
    }

    console.log('[Slack] Detected announcements channel:', detectedChannel);
    return detectedChannel;
  } catch (error) {
    console.error('[Slack] Error detecting announcements channel:', error);
    return null;
  }
}

