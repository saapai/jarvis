-- CreateTable
CREATE TABLE IF NOT EXISTS "SlackSync" (
    "channelName" TEXT NOT NULL,
    "lastSyncedTs" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlackSync_pkey" PRIMARY KEY ("channelName")
);

