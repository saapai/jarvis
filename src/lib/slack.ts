import { WebClient } from '@slack/web-api';

let _slackClient: WebClient | null = null;

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

export interface SlackMessage {
  ts: string;
  text: string;
  user?: string;
  channel: string;
  thread_ts?: string;
}

export async function fetchChannelMessages(
  channelName: string,
  oldest?: string
): Promise<SlackMessage[]> {
  const client = getSlackClient();
  
  try {
    const channelList = await client.conversations.list({
      types: 'public_channel,private_channel',
      exclude_archived: true,
    });

    // Try exact match first
    let channel = channelList.channels?.find(
      (ch) => ch.name === channelName
    );

    // If not found, try case-insensitive match
    if (!channel) {
      channel = channelList.channels?.find(
        (ch) => ch.name?.toLowerCase() === channelName.toLowerCase()
      );
    }

    // If still not found, try partial match (for truncated names)
    if (!channel) {
      channel = channelList.channels?.find(
        (ch) => ch.name?.toLowerCase().includes(channelName.toLowerCase()) ||
                channelName.toLowerCase().includes(ch.name?.toLowerCase() || '')
      );
    }

    if (!channel || !channel.id) {
      // List available channels for debugging
      const availableChannels = channelList.channels?.map(ch => ({
        name: ch.name,
        id: ch.id,
        isPrivate: ch.is_private,
        isMember: ch.is_member
      })) || [];
      
      const announceChannels = availableChannels.filter(ch => 
        ch.name?.toLowerCase().includes('announce')
      );
      
      console.error('[Slack] Channel not found. Available channels:', availableChannels);
      console.error('[Slack] Channels with "announce" in name:', announceChannels);
      
      const channelListStr = availableChannels.map(c => 
        `${c.name}${c.isPrivate ? ' (private' : ' (public'}${c.isMember ? ', member)' : ', not member)'}`
      ).join(', ');
      
      throw new Error(
        `Channel "${channelName}" not found. ` +
        `Available channels: ${channelListStr}. ` +
        `Note: For private channels, the bot must be a member to access them.`
      );
    }

    // Check if bot is a member of private channels
    if (channel.is_private && !channel.is_member) {
      throw new Error(
        `Bot is not a member of private channel "${channelName}". ` +
        `Please invite the bot (@YourBotName) to the channel first using /invite @YourBotName`
      );
    }

    const messages: SlackMessage[] = [];
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const result = await client.conversations.history({
        channel: channel.id,
        oldest,
        cursor,
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
          
          if (msg.ts && messageText.trim().length > 0) {
            messages.push({
              ts: msg.ts,
              text: messageText,
              user: msg.user,
              channel: channel.id,
              thread_ts: msg.thread_ts,
            });
          }
        }
      }

      cursor = result.response_metadata?.next_cursor;
      hasMore = !!cursor;
    }

    return messages;
  } catch (error) {
    console.error('[Slack] Error fetching messages:', error);
    throw error;
  }
}

export async function getChannelId(channelName: string): Promise<string | null> {
  const client = getSlackClient();
  
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
  const client = getSlackClient();
  
  try {
    const channelList = await client.conversations.list({
      types: 'public_channel,private_channel',
      exclude_archived: true,
    });

    const channels: ChannelInfo[] = [];
    
    if (channelList.channels) {
      for (const ch of channelList.channels) {
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
    }

    return channels;
  } catch (error) {
    console.error('[Slack] Error listing channels:', error);
    throw error;
  }
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

