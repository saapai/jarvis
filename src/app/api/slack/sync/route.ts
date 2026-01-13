import { NextRequest, NextResponse } from 'next/server';
import { fetchChannelMessages, detectAnnouncementsChannel } from '@/lib/slack';
import { processUpload, llmClient, textExplorerRepository, reconcileFactsAfterUpload } from '@/text-explorer';
import { embedText } from '@/text-explorer/embeddings';
import { getPrisma } from '@/lib/prisma';
import { ExtractedFact } from '@/text-explorer/types';

export const dynamic = 'force-dynamic';

interface SyncRequest {
  channelName?: string;
  forceFullSync?: boolean;
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
          console.log('[Slack Sync] Processed message', {
            ts: message.ts,
            factCount: factsWithEmbeddings.length,
          });
        } else {
          console.log('[Slack Sync] No facts extracted from message', {
            ts: message.ts,
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

