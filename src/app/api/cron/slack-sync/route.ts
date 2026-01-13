import { NextRequest, NextResponse } from 'next/server';
import { fetchChannelMessages, detectAnnouncementsChannel } from '@/lib/slack';
import { processUpload, llmClient, textExplorerRepository, reconcileFactsAfterUpload } from '@/text-explorer';
import { embedText } from '@/text-explorer/embeddings';
import { getPrisma } from '@/lib/prisma';
import { ExtractedFact } from '@/text-explorer/types';

export const dynamic = 'force-dynamic';

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
    console.error('[Slack Sync Cron] Sync error', error);
    return NextResponse.json(
      { error: 'Failed to sync Slack messages', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

