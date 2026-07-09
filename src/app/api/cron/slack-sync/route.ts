import { NextRequest, NextResponse } from 'next/server';
import { fetchChannelMessages, getSyncableChannels, resolveSlackUserName, makeFilePublic } from '@/lib/slack';
import { detectDeadline } from '@/lib/slackDeadline';
import { processUpload, llmClient, textExplorerRepository, reconcileFactsAfterUpload } from '@/text-explorer';
import { embedText } from '@/text-explorer/embeddings';
import { getPrisma } from '@/lib/prisma';
import { ExtractedFact } from '@/text-explorer/types';

export const dynamic = 'force-dynamic';

interface ChannelSyncResult {
  channelName: string;
  messagesProcessed: number;
  factsSynced: number;
  scheduledAnnouncementsCreated: number;
  latestTs?: string;
  error?: string;
}

async function syncChannel(channelName: string): Promise<ChannelSyncResult> {
  const prisma = await getPrisma();

  const syncState = await prisma.slackSync.findFirst({
    where: { channelName, spaceId: null },
  });
  const oldest = syncState?.lastSyncedTs || undefined;

  if (oldest) {
    console.log(`[Slack Sync] ${channelName}: resuming from ${oldest}`);
  } else {
    console.log(`[Slack Sync] ${channelName}: first sync`);
  }

  const messages = await fetchChannelMessages(channelName, oldest);

  if (messages.length === 0) {
    return { channelName, messagesProcessed: 0, factsSynced: 0, scheduledAnnouncementsCreated: 0 };
  }

  console.log(`[Slack Sync] ${channelName}: ${messages.length} new messages`);

  let syncedCount = 0;
  let scheduledCount = 0;
  let latestTs: string | undefined;

  const defaultSpace = await prisma.space.findFirst();
  const defaultSpaceId = defaultSpace?.id || null;

  for (const message of messages) {
    if ((!message.text || message.text.trim().length === 0) && (!message.files || message.files.length === 0)) {
      continue;
    }

    const messageText = message.text?.trim() || '';
    const messageDate = new Date(parseFloat(message.ts) * 1000);
    const uploadName = `Slack: ${channelName} - ${messageDate.toISOString()}`;

    // Make Slack files publicly accessible for MMS
    const publicMediaUrls: string[] = [];
    if (message.files && message.files.length > 0) {
      for (const file of message.files) {
        if (file.mimetype?.startsWith('image/')) {
          const publicUrl = await makeFilePublic(file.id);
          if (publicUrl) {
            publicMediaUrls.push(publicUrl);
          }
        }
      }
    }

    // Build text including file references for non-image files
    let fullText = messageText;
    if (message.files) {
      const nonImageFiles = message.files.filter(f => !f.mimetype?.startsWith('image/'));
      if (nonImageFiles.length > 0) {
        const fileNames = nonImageFiles.map(f => f.name).join(', ');
        fullText = fullText ? `${fullText}\n\n[Attached: ${fileNames}]` : `[Attached: ${fileNames}]`;
      }
    }

    try {
      const { id: uploadId } = await textExplorerRepository.createUpload({
        name: uploadName,
        rawText: fullText,
      });

      const processResult = await processUpload(fullText, llmClient);

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
      }

      // Only detect deadlines for announcement channels
      if (channelName.toLowerCase().includes('announcements')) {
        const senderName = message.user ? await resolveSlackUserName(message.user) : null;
        const deadline = await detectDeadline(fullText, message.ts, senderName ?? undefined);
        if (deadline) {
          let factId: string | undefined;
          if (processResult.facts.length > 0) {
            const fact = await prisma.fact.findFirst({
              where: { uploadId },
              orderBy: { createdAt: 'desc' },
              select: { id: true },
            });
            factId = fact?.id;
          }

          const urlPattern = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/gi;
          const cleanContent = deadline.content.replace(urlPattern, '').replace(/\s{2,}/g, ' ').trim();
          const links = [...new Set(fullText.match(urlPattern) || [])];
          const contentWithLinks = links.length > 0
            ? `${cleanContent}\n\n${links.join('\n')}`
            : cleanContent;

          const result = await prisma.scheduledAnnouncement.upsert({
            where: { sourceMessageTs: message.ts },
            update: {},
            create: {
              content: contentWithLinks,
              scheduledFor: deadline.scheduledFor,
              sourceFactId: factId,
              sourceMessageTs: message.ts,
              spaceId: defaultSpaceId,
              mediaUrls: publicMediaUrls.length > 0 ? publicMediaUrls : undefined,
            },
          });

          if (result.createdAt.getTime() > Date.now() - 5000) {
            scheduledCount++;
          }
        }
      }

      if (!latestTs || parseFloat(message.ts) > parseFloat(latestTs)) {
        latestTs = message.ts;
      }
    } catch (error) {
      console.error(`[Slack Sync] ${channelName}: error processing message ${message.ts}`, error);
    }
  }

  // Update sync cursor
  if (latestTs) {
    if (syncState) {
      await prisma.slackSync.update({
        where: { id: syncState.id },
        data: { lastSyncedTs: latestTs, lastSyncedAt: new Date(), updatedAt: new Date() },
      });
    } else {
      await prisma.slackSync.create({
        data: { channelName, spaceId: null, lastSyncedTs: latestTs, lastSyncedAt: new Date(), updatedAt: new Date() },
      });
    }
  }

  return { channelName, messagesProcessed: messages.length, factsSynced: syncedCount, scheduledAnnouncementsCreated: scheduledCount, latestTs };
}

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[Slack Sync Cron] Starting multi-channel sync...');

    const channelNames = await getSyncableChannels();
    console.log('[Slack Sync Cron] Channels to sync:', channelNames);

    if (channelNames.length === 0) {
      return NextResponse.json({ message: 'No syncable channels found', channels: [] });
    }

    const results: ChannelSyncResult[] = [];

    for (const channelName of channelNames) {
      try {
        const result = await syncChannel(channelName);
        results.push(result);
        console.log(`[Slack Sync Cron] ${channelName}: done`, result);
      } catch (error) {
        console.error(`[Slack Sync Cron] ${channelName}: failed`, error);
        results.push({
          channelName,
          messagesProcessed: 0,
          factsSynced: 0,
          scheduledAnnouncementsCreated: 0,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({
      message: 'Multi-channel sync completed',
      channels: results,
      totalMessages: results.reduce((sum, r) => sum + r.messagesProcessed, 0),
      totalFacts: results.reduce((sum, r) => sum + r.factsSynced, 0),
      totalScheduled: results.reduce((sum, r) => sum + r.scheduledAnnouncementsCreated, 0),
    });
  } catch (error) {
    console.error('[Slack Sync Cron] Sync error', error);
    return NextResponse.json(
      { error: 'Failed to sync Slack messages', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
