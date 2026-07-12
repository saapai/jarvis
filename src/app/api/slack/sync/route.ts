import { NextRequest, NextResponse } from 'next/server';
import { fetchChannelMessages, getSyncableChannels, listAllChannels, resolveSlackUserName, makeFilePublic } from '@/lib/slack';
import { detectDeadline } from '@/lib/slackDeadline';
import { processUpload, llmClient, textExplorerRepository, reconcileFactsAfterUpload } from '@/text-explorer';
import { embedText } from '@/text-explorer/embeddings';
import { getPrisma } from '@/lib/prisma';
import { getPrimarySpaceId } from '@/lib/spaces';
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
      // No specific channel — sync all matching channels
      console.log('[Slack Sync] No channel specified, syncing all general/announcements channels...');
      const channelNames = await getSyncableChannels();
      console.log('[Slack Sync] Syncable channels:', channelNames);
      if (channelNames.length > 0) {
        channelName = channelNames[0]; // Process first one via existing flow
        // TODO: could loop all channels here, but cron already handles multi-channel
      } else {
        const fallback = process.env.SLACK_ANNOUNCEMENTS_CHANNEL || 'announcements';
        console.log('[Slack Sync] No syncable channels found, using fallback:', fallback);
        channelName = fallback;
      }
    }

    console.log('[Slack Sync] Starting sync', { channelName, forceFullSync });

    const prisma = await getPrisma();

    let oldest: string | undefined;
    // Use findFirst since the unique key is now compound (spaceId, channelName)
    // For global/legacy sync, we use spaceId: null
    let syncState: { id: string; lastSyncedTs: string | null } | null = null;
    if (!forceFullSync) {
      syncState = await prisma.slackSync.findFirst({
        where: { channelName, spaceId: null },
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

    // Find default space for space-scoped announcements
    const defaultSpaceId = await getPrimarySpaceId();

    for (const message of messages) {
      // Skip system messages and empty messages (unless they have files)
      if ((!message.text || message.text.trim().length === 0) && (!message.files || message.files.length === 0)) {
        console.log('[Slack Sync] Skipping empty message', { ts: message.ts });
        continue;
      }

      // Skip messages that are just user joins/leaves
      if (message.text?.includes('joined') && message.text.includes('via invite')) {
        console.log('[Slack Sync] Skipping system message', { ts: message.ts, text: message.text.substring(0, 50) });
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

      console.log('[Slack Sync] Processing message', {
        ts: message.ts,
        textLength: fullText.length,
        fileCount: message.files?.length || 0,
      });

      try {
        const { id: uploadId } = await textExplorerRepository.createUpload({
          name: uploadName,
          rawText: fullText,
        });

        const processResult = await processUpload(fullText, llmClient);

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

          // Strip any URLs the LLM may have included in content, then append deduplicated URLs from original message
          const urlPattern = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/gi;
          const cleanContent = deadline.content.replace(urlPattern, '').replace(/\s{2,}/g, ' ').trim();
          const links = [...new Set(fullText.match(urlPattern) || [])];
          const contentWithLinks = links.length > 0
            ? `${cleanContent}\n\n${links.join('\n')}`
            : cleanContent;

          // Use upsert to atomically prevent duplicates (sourceMessageTs is unique)
          const scheduled = await prisma.scheduledAnnouncement.upsert({
            where: { sourceMessageTs: message.ts },
            update: {}, // Don't update if already exists
            create: {
              content: contentWithLinks,
              scheduledFor: deadline.scheduledFor,
              sourceFactId: factId,
              sourceMessageTs: message.ts,
              spaceId: defaultSpaceId,
              mediaUrls: publicMediaUrls.length > 0 ? publicMediaUrls : undefined,
            },
          });

          if (scheduled.createdAt.getTime() > Date.now() - 5000) {
            console.log('[Slack Sync] Created scheduled announcement', {
              id: scheduled.id,
              scheduledFor: deadline.scheduledFor.toISOString(),
              messageTs: message.ts,
            });
          } else {
            console.log('[Slack Sync] Announcement already exists for message', { messageTs: message.ts });
          }
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
      // For global/legacy sync with spaceId: null, we can't use upsert with nullable compound key
      // Instead, use findFirst + update/create pattern
      if (syncState) {
        await prisma.slackSync.update({
          where: { id: syncState.id },
          data: {
            lastSyncedTs: latestTs,
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
          },
        });
      } else {
        // Need to check again in case forceFullSync was true
        const existingSync = await prisma.slackSync.findFirst({
          where: { channelName, spaceId: null },
        });
        if (existingSync) {
          await prisma.slackSync.update({
            where: { id: existingSync.id },
            data: {
              lastSyncedTs: latestTs,
              lastSyncedAt: new Date(),
              updatedAt: new Date(),
            },
          });
        } else {
          await prisma.slackSync.create({
            data: {
              channelName,
              spaceId: null,
              lastSyncedTs: latestTs,
              lastSyncedAt: new Date(),
              updatedAt: new Date(),
            },
          });
        }
      }
    }

    // Count scheduled announcements created
    const scheduledCount = await prisma.scheduledAnnouncement.count({
      where: {
        sourceMessageTs: {
          in: messages.map(m => m.ts),
        },
        sent: false,
      },
    });

    console.log('[Slack Sync] Sync completed', {
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

