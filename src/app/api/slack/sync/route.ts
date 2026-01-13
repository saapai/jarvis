import { NextRequest, NextResponse } from 'next/server';
import { fetchChannelMessages, detectAnnouncementsChannel, listAllChannels } from '@/lib/slack';
import { processUpload, llmClient, textExplorerRepository, reconcileFactsAfterUpload } from '@/text-explorer';
import { embedText } from '@/text-explorer/embeddings';
import { getPrisma } from '@/lib/prisma';
import { ExtractedFact } from '@/text-explorer/types';
import { getOpenAI } from '@/lib/openai';

export const dynamic = 'force-dynamic';

interface SyncRequest {
  channelName?: string;
  forceFullSync?: boolean;
}

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
    console.error('[Slack Sync] Deadline detection error:', error);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: SyncRequest = await req.json().catch(() => ({}));
    const forceFullSync = body.forceFullSync || false;

    let channelName: string | undefined = body.channelName;
    
    if (!channelName) {
      console.log('[Slack Sync] No channel specified, detecting announcements channel...');
      const detected = await detectAnnouncementsChannel();
      
      if (detected) {
        channelName = detected;
        console.log('[Slack Sync] Detected channel:', channelName);
      } else {
        const fallback = process.env.SLACK_ANNOUNCEMENTS_CHANNEL || 'announcements';
        console.log('[Slack Sync] Could not detect channel, using fallback:', fallback);
        channelName = fallback;
      }
    }

    console.log('[Slack Sync] Starting sync', { channelName, forceFullSync });

    const prisma = await getPrisma();

    let oldest: string | undefined;
    if (!forceFullSync) {
      const syncState = await prisma.slackSync.findUnique({
        where: { channelName },
      });
      if (syncState?.lastSyncedTs) {
        oldest = syncState.lastSyncedTs;
        console.log('[Slack Sync] Resuming from last sync', { lastSyncedTs: oldest });
      }
    }

    const messages = await fetchChannelMessages(channelName, oldest);
    console.log('[Slack Sync] Fetched messages', { 
      count: messages.length,
      channelName,
      oldest,
      oldestDate: oldest ? new Date(parseFloat(oldest) * 1000).toISOString() : null
    });

    if (messages.length === 0) {
      return NextResponse.json({ 
        message: 'No new messages to sync',
        synced: 0,
        channelName,
        lastSyncedTs: oldest
      });
    }

    console.log('[Slack Sync] Sample messages:', messages.slice(0, 3).map(m => ({
      ts: m.ts,
      textPreview: m.text?.substring(0, 100),
      hasText: !!m.text
    })));

    let syncedCount = 0;
    let latestTs: string | undefined;

    for (const message of messages) {
      // Skip system messages and empty messages
      if (!message.text || message.text.trim().length === 0) {
        console.log('[Slack Sync] Skipping empty message', { ts: message.ts });
        continue;
      }

      // Skip messages that are just user joins/leaves
      if (message.text.includes('joined') && message.text.includes('via invite')) {
        console.log('[Slack Sync] Skipping system message', { ts: message.ts, text: message.text.substring(0, 50) });
        continue;
      }

      const messageText = message.text.trim();
      const messageDate = new Date(parseFloat(message.ts) * 1000);
      const uploadName = `Slack: ${channelName} - ${messageDate.toISOString()}`;

      console.log('[Slack Sync] Processing message', {
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
              // Include subcategory, content, sourceText, and timeRef for comprehensive embedding
              const embeddingParts = [
                fact.subcategory || '',
                fact.content || '',
                fact.sourceText || '',
                fact.timeRef || '',
                fact.dateStr || ''
              ].filter(Boolean);
              const embeddingText = embeddingParts.join(' ').trim();
              const embedding = await embedText(embeddingText);
              return { ...fact, embedding };
            })
          );

          await textExplorerRepository.createFacts({
            uploadId,
            facts: factsWithEmbeddings,
          });

          await reconcileFactsAfterUpload(uploadId);

          syncedCount += factsWithEmbeddings.length;
          console.log('[Slack Sync] Processed message', {
            ts: message.ts,
            factCount: factsWithEmbeddings.length,
          });
        } else {
          console.log('[Slack Sync] No facts extracted from message', {
            ts: message.ts,
          });
        }

        // Detect deadlines and create scheduled announcements
        const deadline = await detectDeadline(messageText, message.ts);
        if (deadline) {
          const prisma = await getPrisma();
          
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
          
          console.log('[Slack Sync] Created scheduled announcement', {
            id: scheduled.id,
            scheduledFor: deadline.scheduledFor.toISOString(),
            messageTs: message.ts,
          });
        }

        if (!latestTs || parseFloat(message.ts) > parseFloat(latestTs)) {
          latestTs = message.ts;
        }
      } catch (error) {
        console.error('[Slack Sync] Error processing message', {
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

    console.log('[Slack Sync] Sync completed', {
      channelName,
      messagesProcessed: messages.length,
      factsSynced: syncedCount,
      latestTs,
    });

    return NextResponse.json({
      message: 'Sync completed',
      channelName,
      messagesProcessed: messages.length,
      factsSynced: syncedCount,
      latestTs,
    });
  } catch (error) {
    console.error('[Slack Sync] Sync error', error);
    
    // If channel not found, list available channels
    if (error instanceof Error && error.message.includes('not found')) {
      try {
        const availableChannels = await listAllChannels();
        return NextResponse.json(
          { 
            error: 'Failed to sync Slack messages', 
            details: error.message,
            availableChannels: availableChannels.map(ch => ({
              name: ch.name,
              isPrivate: ch.isPrivate
            }))
          },
          { status: 404 }
        );
      } catch (listError) {
        // If listing fails, just return the original error
      }
    }
    
    return NextResponse.json(
      { error: 'Failed to sync Slack messages', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const prisma = await getPrisma();
    const syncStates = await prisma.slackSync.findMany({
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json({
      syncStates: syncStates.map((s) => ({
        channelName: s.channelName,
        lastSyncedTs: s.lastSyncedTs,
        lastSyncedAt: s.lastSyncedAt,
        updatedAt: s.updatedAt,
      })),
    });
  } catch (error) {
    console.error('[Slack Sync] Error fetching sync state', error);
    return NextResponse.json(
      { error: 'Failed to fetch sync state' },
      { status: 500 }
    );
  }
}

