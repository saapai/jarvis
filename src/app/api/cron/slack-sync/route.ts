import { NextRequest, NextResponse } from 'next/server';
import { fetchChannelMessages, detectAnnouncementsChannel } from '@/lib/slack';
import { processUpload, llmClient, textExplorerRepository, reconcileFactsAfterUpload } from '@/text-explorer';
import { embedText } from '@/text-explorer/embeddings';
import { getPrisma } from '@/lib/prisma';
import { ExtractedFact } from '@/text-explorer/types';
import { getOpenAI } from '@/lib/openai';

export const dynamic = 'force-dynamic';

/**
 * Detect deadlines in Slack messages and parse them into scheduled announcements
 * Returns null if no deadline is detected
 */
async function detectDeadline(
  messageText: string,
  messageTs: string
): Promise<{ scheduledFor: Date; content: string } | null> {
  try {
    const openai = getOpenAI();
    
    const prompt = `Analyze this Slack message and detect if it contains a deadline or reminder time.

Message: "${messageText}"

Look for:
- Deadlines like "EOD Thursday", "end of Thursday", "by Thursday", "due Thursday"
- Reminder times like "remind everyone on Thursday", "send reminder Thursday"
- Time references that indicate when something should be done

If you find a deadline/reminder time:
1. Determine the exact date and time (default to 5pm local time for "EOD" or end of day)
2. Extract the key content/action that should be sent (e.g., the RSVP link or reminder message)

Today's date context: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

Return JSON:
{
  "hasDeadline": boolean,
  "scheduledFor": "YYYY-MM-DDTHH:mm:ss" (ISO datetime string, or null if no deadline),
  "content": "Message to send at the deadline (include any links or important info)" or null
}

Examples:
- "rsvp for retreat by EOD thurs" -> hasDeadline: true, scheduledFor: next Thursday at 5pm, content: "rsvp reminder: [link]"
- "fill out form by end of Thursday" -> hasDeadline: true, scheduledFor: next Thursday at 5pm
- "meeting is Friday" -> hasDeadline: false (not a deadline, just a date)

Return ONLY valid JSON:`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a deadline detector. Return only valid JSON.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 300,
    });

    const result = JSON.parse(response.choices[0]?.message?.content || '{}');
    
    if (result.hasDeadline && result.scheduledFor) {
      const scheduledFor = new Date(result.scheduledFor);
      
      // Validate the date is in the future
      if (scheduledFor > new Date()) {
        return {
          scheduledFor,
          content: result.content || messageText,
        };
      }
    }
    
    return null;
  } catch (error) {
    console.error('[Slack Sync Cron] Deadline detection error:', error);
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[Slack Sync Cron] Starting automated sync...');

    let channelName: string | undefined;
    
    const detected = await detectAnnouncementsChannel();
    if (detected) {
      channelName = detected;
      console.log('[Slack Sync Cron] Detected channel:', channelName);
    } else {
      const fallback = process.env.SLACK_ANNOUNCEMENTS_CHANNEL || 'announcements';
      console.log('[Slack Sync Cron] Using fallback:', fallback);
      channelName = fallback;
    }

    const prisma = await getPrisma();

    let oldest: string | undefined;
    const syncState = await prisma.slackSync.findUnique({
      where: { channelName },
    });
    if (syncState?.lastSyncedTs) {
      oldest = syncState.lastSyncedTs;
      console.log('[Slack Sync Cron] Resuming from last sync', { lastSyncedTs: oldest });
    }

    const messages = await fetchChannelMessages(channelName, oldest);
    console.log('[Slack Sync Cron] Fetched messages', { count: messages.length });

    if (messages.length === 0) {
      return NextResponse.json({ 
        message: 'No new messages to sync',
        synced: 0 
      });
    }

    let syncedCount = 0;
    let scheduledCount = 0;
    let latestTs: string | undefined;

    for (const message of messages) {
      if (!message.text || message.text.trim().length === 0) {
        continue;
      }

      const messageText = message.text.trim();
      const messageDate = new Date(parseFloat(message.ts) * 1000);
      const uploadName = `Slack: ${channelName} - ${messageDate.toISOString()}`;

      console.log('[Slack Sync Cron] Processing message', {
        ts: message.ts,
        textLength: messageText.length,
      });

      try {
        const { id: uploadId } = await textExplorerRepository.createUpload({
          name: uploadName,
          rawText: messageText,
        });

        const processResult = await processUpload(messageText, llmClient);

        if (processResult.facts.length > 0) {
          const factsWithEmbeddings: ExtractedFact[] = await Promise.all(
            processResult.facts.map(async (fact) => {
              const embedding = await embedText(
                `${fact.content} ${fact.sourceText || ''}`.trim()
              );
              return { ...fact, embedding };
            })
          );

          await textExplorerRepository.createFacts({
            uploadId,
            facts: factsWithEmbeddings,
          });

          await reconcileFactsAfterUpload(uploadId);

          syncedCount += factsWithEmbeddings.length;
          console.log('[Slack Sync Cron] Processed message', {
            ts: message.ts,
            factCount: factsWithEmbeddings.length,
          });
        }

        // Detect deadlines and create scheduled announcements
        const deadline = await detectDeadline(messageText, message.ts);
        if (deadline) {
          // Find the fact ID if facts were created
          let factId: string | undefined;
          if (processResult.facts.length > 0) {
            // Get the most recent fact for this upload
            const fact = await prisma.fact.findFirst({
              where: { uploadId },
              orderBy: { createdAt: 'desc' },
              select: { id: true },
            });
            factId = fact?.id;
          }
          
          // Extract links from message for the announcement content
          const urlPattern = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/gi;
          const links = messageText.match(urlPattern) || [];
          const contentWithLinks = links.length > 0
            ? `${deadline.content}\n\n${links.join('\n')}`
            : deadline.content;
          
          const scheduled = await prisma.scheduledAnnouncement.create({
            data: {
              content: contentWithLinks,
              scheduledFor: deadline.scheduledFor,
              sourceFactId: factId,
              sourceMessageTs: message.ts,
            },
          });
          
          scheduledCount++;
          console.log('[Slack Sync Cron] Created scheduled announcement', {
            id: scheduled.id,
            scheduledFor: deadline.scheduledFor.toISOString(),
            messageTs: message.ts,
          });
        }

        if (!latestTs || parseFloat(message.ts) > parseFloat(latestTs)) {
          latestTs = message.ts;
        }
      } catch (error) {
        console.error('[Slack Sync Cron] Error processing message', {
          ts: message.ts,
          error,
        });
      }
    }

    if (latestTs) {
      await prisma.slackSync.upsert({
        where: { channelName },
        update: {
          lastSyncedTs: latestTs,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        },
        create: {
          channelName,
          lastSyncedTs: latestTs,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }

    console.log('[Slack Sync Cron] Sync completed', {
      channelName,
      messagesProcessed: messages.length,
      factsSynced: syncedCount,
      scheduledAnnouncementsCreated: scheduledCount,
      latestTs,
    });

    return NextResponse.json({
      message: 'Sync completed',
      channelName,
      messagesProcessed: messages.length,
      factsSynced: syncedCount,
      scheduledAnnouncementsCreated: scheduledCount,
      latestTs,
    });
  } catch (error) {
    console.error('[Slack Sync Cron] Sync error', error);
    return NextResponse.json(
      { error: 'Failed to sync Slack messages', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

