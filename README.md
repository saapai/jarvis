# 🤖 Jarvis SMS (Enclave v2.0)

SMS-powered organizational assistant with LLM-based intent classification, weighted conversation history, and normalized poll tracking.

## Features

- **SMS Announcements** - Broadcast messages to all subscribers with draft/edit/send workflow
- **Polls** - Create polls with yes/no/maybe responses, tracked in normalized database tables
- **Text Explorer** - Upload documents and extract structured facts with AI
- **Slack Integration** - Automatically sync messages from Slack announcements channel to knowledge base
- **Smart Q&A** - Users can text questions and get answers from the knowledge base (semantic search via pgvector + OpenAI embeddings)
- **LLM Routing** - OpenAI-powered intent classification with conversation context
- **Personality Engine** - Jarvis's sassy personality applied to all responses
- **Conversation History** - Weighted message history for better context understanding
- **Poll Replies Captured** - Active poll responses are parsed and persisted automatically
- **API Guardrails** - Text Explorer endpoints are rate-limited per IP

## Architecture

### Data Layer (Hybrid Approach)

**Airtable** (user management):
- Members table with Phone, Name, Needs_Name, Opted_Out fields
- Admin can manually manage users

**Prisma/Postgres (Supabase)** (application data):
- `Message` - SMS history (inbound + outbound)
- `ConversationState` - Ephemeral state tracking
- `AnnouncementDraft` - Persistent drafts with structured fields
- `PollMeta` - Poll questions with metadata
- `PollResponse` - Normalized poll responses
- `Fact` - Knowledge base extracted from documents
- `SlackSync` - Tracks last synced timestamp for Slack channels

### SMS Pipeline

```
Twilio Webhook → /api/twilio/sms
  ↓
1. Log inbound message
  ↓
2. Get/create member (Airtable)
  ↓
3. Load conversation context:
   - Recent messages (weighted history)
   - Active draft
   - Conversation state
  ↓
4. LLM Intent Classification
   - Pattern matching (fast path)
   - OpenAI classification (fallback)
  ↓
5. Route to action handler:
   - draft_write → Create/edit drafts
   - draft_send → Send to all members
   - content_query → Search knowledge base
   - capability_query → About Jarvis
   - chat → Personality responses
  ↓
6. Apply personality (rule-based or LLM)
  ↓
7. Log outbound message
  ↓
8. Return TwiML response
```

## Quick Start

### 1. Install & Run

```bash
npm install
```

### 2. Set Up Dev Environment

The project uses PostgreSQL schemas to isolate dev data from production. Local development uses the `dev` schema, while production uses the `public` schema.

**First-time setup:**

1. **Set up the dev schema:**
   ```bash
   # Set your production DATABASE_URL (without schema parameter)
   export DATABASE_URL="postgresql://postgres:password@db.yourproject.supabase.co:5432/postgres"
   
   # Run the setup script to create dev schema and run migrations
   node scripts/setup-dev-schema.js
   ```

2. **Create `.env.local` file:**
   ```bash
   # Copy the example template (if it exists) or create manually
   # .env.local is already in .gitignore
   ```

   Add the following to `.env.local`:
   ```env
   # Database (Supabase Postgres) - uses dev schema for local development
   # IMPORTANT: Add ?schema=dev&search_path=dev,public to use dev schema
   # The 'public' in search_path allows access to extensions (like pgvector) installed in public schema
   DATABASE_URL=postgresql://postgres:password@db.yourproject.supabase.co:5432/postgres?schema=dev&search_path=dev,public
   DIRECT_URL=postgresql://postgres:password@db.yourproject.supabase.co:5432/postgres?schema=dev&search_path=dev,public
   SUPABASE_URL=https://yourproject.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   
   # OpenAI
   OPENAI_API_KEY=your_openai_key
   
   # Twilio (use test credentials for local dev)
   TWILIO_ACCOUNT_SID=your_twilio_sid
   TWILIO_AUTH_TOKEN=your_twilio_token
   TWILIO_PHONE_NUMBER=+1xxxxxxxxxx
   
   # Airtable (for SMS users)
   AIRTABLE_API_KEY=your_airtable_key
   AIRTABLE_BASE_ID=your_base_id
   AIRTABLE_TABLE_NAME=your_table_name
   
   # Slack (for knowledge base sync)
   SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
   SLACK_ANNOUNCEMENTS_CHANNEL=announcements
   
   # Admin phone numbers (comma-separated)
   ADMIN_PHONE_NUMBERS=1234567890
   
   # App URL (for local development)
   APP_URL=http://localhost:3000
   ```

3. **Run the app:**
   ```bash
   npm run dev
   ```

**Note:** The `?schema=dev&search_path=dev` parameters in `DATABASE_URL` ensure all database operations use the `dev` schema, keeping your local development data completely isolated from production.

#### pgvector setup (embeddings for semantic search)
- Enable the `pgvector` extension on your Postgres instance.
- The dev schema setup script will handle migrations automatically.

### 3. Environment Variables (Legacy - use .env.local instead)

For reference, here are all environment variables. **Use `.env.local` for local development** (already in `.gitignore`):

```env
# Database (Supabase Postgres)
DATABASE_URL=postgresql://postgres:password@db.yourproject.supabase.co:5432/postgres
DIRECT_URL=postgresql://postgres:password@db.yourproject.supabase.co:5432/postgres
SUPABASE_URL=https://yourproject.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# OpenAI
OPENAI_API_KEY=your_openai_key

# Twilio
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx

# Airtable (for SMS users)
AIRTABLE_API_KEY=your_airtable_key
AIRTABLE_BASE_ID=your_base_id
AIRTABLE_TABLE_NAME=your_table_name

# Slack (for knowledge base sync)
# Note: Must be a bot token (xoxb-), not an app-level token (xapp-)
# Get this from: https://api.slack.com/apps → Your App → OAuth & Permissions → Bot User OAuth Token
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
SLACK_ANNOUNCEMENTS_CHANNEL=announcements  # Optional: fallback if LLM detection fails

### 4. Airtable Fields

Add these fields to your Airtable table:

| Field | Type | Description |
|-------|------|-------------|
| Phone | Single line text | User's phone (10 digits) |
| Name | Single line text | User's name |
| Needs_Name | Checkbox | Waiting for name? |
| Opted_Out | Checkbox | Unsubscribed? |
| Pending_Poll | Single line text | Current poll question |
| Last_Response | Single select | Yes, No, Maybe |
| Last_Notes | Long text | Response notes |

### 5. Configure Twilio Webhook

Set webhook URL to: `https://your-app.vercel.app/api/twilio/sms` (POST)

## Usage

### Web Interface

Visit the app to see two tabs:
- **? (How It Works)** - SMS documentation and phone number
- **🏠 (Text Explorer)** - Dump text and explore extracted facts

### Admin SMS Commands

```
announce meeting tonight at 7pm
→ ✅ sent to 15 people!

poll active meeting tonight?
→ ✅ poll sent to 15 people!
```

### User SMS Flow

```
user: (first text)
bot: hey! i'm jarvis. what's your name?

user: John
bot: nice to meet you John! 👋

(receives poll)
bot: 📊 yo are you coming to active meeting tonight?
     reply yes/no/maybe

user: ya but running 15 late
bot: got it! recorded: Yes (note: "running 15 late")

user: when is study hall?
bot: 📋 Weekly study session for pledges...
     ⏰ every Wednesday, 6:30 PM
     📁 Study Hall
```

## Deploy to Vercel

### 1. Configure Supabase (Postgres)
- Create a Supabase project and note:\n  - SUPABASE_URL\n  - SUPABASE_SERVICE_ROLE_KEY\n  - Postgres connection string (for DATABASE_URL/DIRECT_URL)
- Use the primary connection for `DATABASE_URL` and (optionally) the pooler for `DIRECT_URL`.

### 2. Configure Vercel Environment Variables

In your Vercel project settings, add:

```
DATABASE_URL=postgresql://postgres:password@db.yourproject.supabase.co:5432/postgres
DIRECT_URL=postgresql://postgres:password@db.yourproject.supabase.co:5432/postgres
SUPABASE_URL=https://yourproject.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
OPENAI_API_KEY=your_openai_key
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx
AIRTABLE_API_KEY=your_airtable_key
AIRTABLE_BASE_ID=your_base_id
AIRTABLE_TABLE_NAME=your_table_name
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
SLACK_ANNOUNCEMENTS_CHANNEL=announcements
ADMIN_PHONE_NUMBERS=1234567890
APP_URL=https://your-app.vercel.app
```

### 3. Initialize Database Schema on Supabase

Run locally (with DATABASE_URL/DIRECT_URL set to Supabase):

```bash
npx prisma migrate deploy
npx prisma generate
```

### 4. Deploy

```bash
git push origin main
# or
vercel deploy --prod
```

## Slack Integration

### Setup

1. Create a Slack app at https://api.slack.com/apps
2. Add a bot token with the following OAuth scopes:
   - `channels:history` - Read messages from public channels
   - `groups:history` - Read messages from private channels
   - `channels:read` - View basic information about public channels
   - `groups:read` - View basic information about private channels
3. Install the app to your workspace
4. Copy the bot token (starts with `xoxb-`) and set it as `SLACK_BOT_TOKEN`
5. Set `SLACK_ANNOUNCEMENTS_CHANNEL` to the name of your announcements channel (default: `announcements`)

### Syncing Messages

**IMPORTANT**: After deployment, you must manually trigger the first sync to import messages into the knowledge base.

Sync messages from your Slack announcements channel to the knowledge base:

```bash
# Auto-detect announcements channel and sync new messages (incremental)
curl -X POST https://your-app.vercel.app/api/slack/sync \
  -H "Content-Type: application/json" \
  -d '{}'

# Force full sync (re-sync all messages from beginning)
curl -X POST https://your-app.vercel.app/api/slack/sync \
  -H "Content-Type: application/json" \
  -d '{"forceFullSync": true}'

# Sync specific channel
curl -X POST https://your-app.vercel.app/api/slack/sync \
  -H "Content-Type: application/json" \
  -d '{"channelName": "winter26-announcements"}'

# Check sync status
curl https://your-app.vercel.app/api/slack/sync
```

The sync process:
1. Fetches messages from the specified Slack channel
2. Processes each message through the same LLM extraction pipeline as document uploads
3. Extracts structured facts (events, dates, entities, etc.)
4. Generates embeddings for semantic search
5. Stores facts in the knowledge base
6. Tracks the last synced timestamp to avoid re-processing

### Automated Syncing

You can set up a cron job (e.g., using Vercel Cron) to automatically sync new messages:

```json
// vercel.json
{
  "crons": [{
    "path": "/api/slack/sync",
    "schedule": "0 */6 * * *"
  }]
}
```

## Commands Reference

| Command | Who | What it does |
|---------|-----|--------------|
| `announce [msg]` | Admin | Send message to everyone |
| `poll [question]` | Admin | Ask everyone a question |
| `STOP` | Anyone | Unsubscribe |
| `START` | Anyone | Re-subscribe |
| `HELP` | Anyone | Show commands |
| Any question | Anyone | Search knowledge base |

vercel deploy --prod
```

## Commands Reference

| Command | Who | What it does |
|---------|-----|--------------|
| `announce [msg]` | Admin | Send message to everyone |
| `poll [question]` | Admin | Ask everyone a question |
| `STOP` | Anyone | Unsubscribe |
| `START` | Anyone | Re-subscribe |
| `HELP` | Anyone | Show commands |
| Any question | Anyone | Search knowledge base |
