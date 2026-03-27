# REPO_OVERVIEW.md

## Project Summary

**Jarvis SMS** (v2.0 Enclave) is a multi-space SMS-powered organizational assistant that combines LLM-based intent classification, semantic search via pgvector embeddings, weighted conversation history, and integrated Slack synchronization. Organizations manage announcements, polls, events, and knowledge bases through SMS with web-based admin interfaces.

**Tech Stack:** Next.js 14.2 (App Router), TypeScript, PostgreSQL (Supabase) + Prisma + pgvector, Supabase Auth (phone OTP), Twilio SMS, OpenAI (LLM + embeddings), Slack Web API, Tailwind CSS, Vercel deployment

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER INTERFACES                          │
├──────────────────────────┬──────────────────────┬───────────────┤
│  SMS (Twilio Webhook)    │  Web Dashboard       │  Slack Channel│
│  /api/twilio/sms         │  /spaces/[slug]/*    │  /api/slack/  │
└──────────┬───────────────┴──────────┬───────────┴───────────────┘
           │                          │
    ┌──────▼──────────────┐    ┌──────▼──────────────┐
    │  SMS MESSAGE HANDLER│    │  NEXT.JS WEB ROUTES │
    │  1. Normalize phone │    │  Space CRUD, Auth,  │
    │  2. Detect space    │    │  Members, Uploads,  │
    │  3. Classify intent │    │  Chat, Calendar     │
    │  4. Route to action │    └─────────────────────┘
    └──────┬──────────────┘
           │
    ┌──────▼──────────────────────────────────────┐
    │   PLANNER ORCHESTRATOR                       │
    │   - Intent Classifier (LLM + pattern match)  │
    │   - Weighted conversation history            │
    │   - Personality engine                       │
    │   - Action handlers (draft, send, search...) │
    └──────┬───────────────────────────────────────┘
           │
    ┌──────▼──────────────────────────────────────┐
    │   DATA LAYER                                 │
    │   Repositories → Prisma → PostgreSQL         │
    │   - Message, Draft, Poll, Event, Fact        │
    │   - User, Space, SpaceMember                 │
    │   - pgvector embeddings for semantic search   │
    └──────────────────────────────────────────────┘

PARALLEL SUBSYSTEMS:
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│  TEXT EXPLORER        │  │  SLACK SYNC           │  │  CRON JOBS           │
│  Upload → Extract →  │  │  Channel → Messages → │  │  Announcements,      │
│  Facts → Embeddings  │  │  Facts + Deadlines    │  │  Event nudges,       │
│  → Semantic search   │  │  → Scheduled announces│  │  Slack auto-sync     │
└──────────────────────┘  └──────────────────────┘  └──────────────────────┘
```

---

## File/Directory Map

```
src/
├── app/
│   ├── api/
│   │   ├── twilio/sms/route.ts           # Main SMS webhook handler
│   │   ├── spaces/                        # Space CRUD + nested resources
│   │   │   └── [slug]/{route,chat,members,invites,facts,uploads}/
│   │   ├── text-explorer/                 # Knowledge base: upload, process, search, facts
│   │   ├── cron/                          # Vercel cron jobs
│   │   │   ├── scheduled-announcements/   # Send due announcements
│   │   │   ├── event-nudges/             # Send event reminders (2h + 9am)
│   │   │   └── slack-sync/              # Auto-sync Slack messages
│   │   ├── slack/sync/route.ts           # Manual Slack sync trigger
│   │   └── admin/                        # Legacy admin endpoints
│   ├── auth/{login,verify,callback,signout}/ # Supabase phone OTP auth
│   ├── spaces/                           # Space UI pages (list, new, [slug] layout)
│   │   └── [slug]/{announcements,calendar,inbox,members,uploads,settings,chat}/
│   └── layout.tsx, page.tsx              # Root layout & redirect
│
├── lib/
│   ├── planner/                          # Intent classification & action routing
│   │   ├── index.ts                      # Main orchestrator
│   │   ├── classifier.ts                # LLM + pattern-based intent classification
│   │   ├── history.ts                   # Weighted conversation history
│   │   ├── personality.ts               # Tone/personality engine
│   │   ├── pollResponseParser.ts        # Poll response parsing
│   │   └── actions/                     # Handlers: draft, send, content, chat, poll, event
│   ├── repositories/                     # DB access: message, draft, conversation, poll, event, member
│   ├── auth/                            # Supabase server/client helpers
│   ├── db.ts                            # Airtable client (legacy) + normalizePhone
│   ├── prisma.ts                        # Prisma singleton
│   ├── openai.ts                        # OpenAI client
│   ├── twilio.ts                        # Twilio client & TwiML
│   ├── slack.ts                         # Slack Web API: fetch messages, resolve users, detect channel
│   ├── slackDeadline.ts                 # LLM-based deadline detection in Slack messages
│   └── spaceContext.ts                  # Space routing & context utilities
│
├── text-explorer/                        # Semantic search & knowledge extraction
│   ├── repository.ts                    # Fact storage & retrieval
│   ├── search.ts                        # pgvector semantic search
│   ├── embeddings.ts                    # OpenAI embeddings
│   ├── llmClient.ts                     # LLM fact extraction
│   ├── fileExtract.ts                   # PDF/DOCX text extraction
│   ├── processUpload.ts                 # Upload processing pipeline
│   └── reconcile.ts                     # Fact deduplication
│
├── components/                           # React: SpaceNav, MembersSection, UserMenu, etc.
└── middleware.ts                         # Auth redirect middleware

prisma/schema.prisma                      # DB schema (User, Space, SpaceMember, Fact, Event, etc.)
scripts/                                  # Utility scripts (setup-dev-schema, migrations, member mgmt)
```

---

## Feature Logic & Flows

### 1. SMS Inbound Message Flow
**Files:** `api/twilio/sms/route.ts` → `lib/planner/*` → `lib/repositories/*`

```
Inbound SMS → Normalize phone → Load user & active space
  → Load conversation context (weighted history, draft state, poll state)
  → Classify intent (pattern match fast-path, then LLM)
  → Route: draft_write | draft_send | content_query | poll_response | capability_query | chat
  → Apply personality → Log outbound → Return TwiML
```

### 2. Announcements & Polls
**Files:** `lib/planner/actions/{draft,send}.ts`, `lib/repositories/{draft,poll}Repository.ts`

```
"announce X" → draft_write → Create AnnouncementDraft (in_progress)
  → LLM generates preview → Show to admin → "send" confirms
  → Fetch opted-in members → Send SMS via Twilio → Mark finalized

"poll X?" → draft_write → Create draft with poll payload
  → Ask "require explanation for no?" → Preview → "send"
  → Create PollMeta → Send to members → Collect PollResponses
```

### 3. Text Explorer (Knowledge Base)
**Files:** `text-explorer/*`, `api/text-explorer/*`

```
Upload file (PDF/DOCX/TXT) → Extract text → LLM extracts structured facts
  → Generate embeddings → Store in pgvector → Reconcile duplicates

Search: Query → Embed → pgvector cosine similarity → Return top facts
```

### 4. Slack Sync & Deadline Detection
**Files:** `lib/slack.ts`, `lib/slackDeadline.ts`, `api/slack/sync/route.ts`

```
Trigger (manual or cron) → Detect announcements channel
  → Fetch messages since lastSyncedTs → For each message:
    → Resolve sender name → Extract facts + embeddings
    → Detect deadlines (LLM): strip URLs, resolve relative dates from msg sent time
    → Create ScheduledAnnouncement if deadline found (clean content + full URLs appended)
  → Update SlackSync state
```

### 5. Onboarding & Space Routing
**Files:** `api/twilio/sms/route.ts`, `lib/spaceContext.ts`

```
New user SMS → Check spaces: 0 → "JOIN <code>" prompt
  → 1 space → auto-set active → Check name → "what's your name?" → LLM parse name
  → 2+ spaces → "text JOIN <code> to pick one"
```

### 6. Scheduled Jobs (Vercel Cron)
- **Scheduled announcements:** Send due ScheduledAnnouncements via SMS
- **Event nudges:** 2-hour + 9am-day-of reminders to space members
- **Slack sync:** Auto-sync announcements channel periodically

---

## Branching & Git Strategy

**Current Branch:** `main` (production)

**Recent Commits:**
```
5c8822c Fix build: replace removed normalizedPhone variable
60bcd7d Remove AutoBypass that hardcoded test phone to Amia's Space
a2379dd Resolve relative time in Slack announcements from message sent date
6987bb2 Merge pull request #6 from saapai/henry/sms-onboard
9e2518a fix eslint errors
```

---

## Recent Changes Log

| Date | What | Why | Impact |
|------|-------|-----|--------|
| 2026-03-27 | Fix truncated URLs + wrong sender name in Slack scheduled announcements | LLM was mangling URLs and replacing "I" with "poster" | `slackDeadline.ts`: strip URLs before LLM, pass sender name; `slack.ts`: add `resolveSlackUserName()`; `sync/route.ts`: clean LLM content before appending full URLs. Verified `contentWithLinks` still appends regex-extracted URLs correctly |
| 2025-03-27 | Fix normalizePhone variable reference | Build error after removing old variable | SMS routing fixed |
| 2025-03-26 | Remove auto-bypass for test phone | Dev-only hardcode removed | Cleaner prod setup |
| 2025-03-25 | Relative time resolution in Slack | Deadline detection uses message sent date | Event dates parse correctly |
| 2025-02-24 | Multi-space onboarding flow | Support users in multiple spaces | JOIN command, active space routing |
| 2025-02-20 | Space-scoped facts + SMS uploads | Isolate knowledge base per space | Facts/events/drafts space-specific |
| 2025-01-29 | Stop using Airtable in admin UI | Transition to Prisma | Single source of truth |
| 2025-01-27 | Welcome messages on space join | Better onboarding | Greet new members |
| 2025-01-13 | LLM-based name extraction | Better name parsing | Handles varied responses |
| 2025-01-09 | Text Explorer with pgvector | Semantic search | Powerful knowledge queries |
