-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fact" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceText" TEXT,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "timeRef" TEXT,
    "dateStr" TEXT,
    "entities" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "meta" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationState" (
    "phoneNumber" TEXT NOT NULL,
    "stateType" TEXT,
    "statePayload" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationState_pkey" PRIMARY KEY ("phoneNumber")
);

-- CreateTable
CREATE TABLE "AnnouncementDraft" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "draftText" TEXT NOT NULL,
    "structuredPayload" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollMeta" (
    "id" TEXT NOT NULL,
    "questionText" TEXT NOT NULL,
    "requiresReasonForNo" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollMeta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollResponse" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Message_phoneNumber_createdAt_idx" ON "Message"("phoneNumber", "createdAt");

-- CreateIndex
CREATE INDEX "AnnouncementDraft_phoneNumber_status_idx" ON "AnnouncementDraft"("phoneNumber", "status");

-- CreateIndex
CREATE INDEX "PollMeta_isActive_createdAt_idx" ON "PollMeta"("isActive", "createdAt");

-- CreateIndex
CREATE INDEX "PollResponse_pollId_phoneNumber_idx" ON "PollResponse"("pollId", "phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PollResponse_pollId_phoneNumber_key" ON "PollResponse"("pollId", "phoneNumber");

-- AddForeignKey
ALTER TABLE "Fact" ADD CONSTRAINT "Fact_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fact" ADD CONSTRAINT "Fact_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Fact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollResponse" ADD CONSTRAINT "PollResponse_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "PollMeta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
