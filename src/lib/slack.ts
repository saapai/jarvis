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
    });

    const channel = channelList.channels?.find(
      (ch) => ch.name === channelName
    );

    if (!channel || !channel.id) {
      throw new Error(`Channel "${channelName}" not found`);
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
          if (msg.ts && msg.text && !msg.subtype) {
            messages.push({
              ts: msg.ts,
              text: msg.text,
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

    const prompt = `You are analyzing a list of Slack channels to identify which one is the announcements channel.

An announcements channel is typically used for:
- Official organization announcements
- Important updates and news
- Event notifications
- General information broadcasts
- May be named "announcements", "announcement", "news", "updates", or similar
- May be private (organization-specific) or public

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

