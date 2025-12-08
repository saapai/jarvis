# 🤖 Jarvis SMS (Enclave v2.0)

SMS-powered organizational assistant with LLM-based intent classification, weighted conversation history, and normalized poll tracking.

## Features

- **SMS Announcements** - Broadcast messages to all subscribers with draft/edit/send workflow
- **Polls** - Create polls with yes/no/maybe responses, tracked in normalized database tables
- **Text Explorer** - Upload documents and extract structured facts with AI
- **Smart Q&A** - Users can text questions and get answers from the knowledge base
- **LLM Routing** - OpenAI-powered intent classification with conversation context
- **Personality Engine** - Jarvis's sassy personality applied to all responses
- **Conversation History** - Weighted message history for better context understanding

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
# set DATABASE_URL and DIRECT_URL for Supabase Postgres before running:
# export DATABASE_URL=\"postgresql://...\" 
# export DIRECT_URL=\"postgresql://...\" 
npx prisma migrate dev --name supabase-init
npm run dev
```

### 2. Environment Variables

Create `.env` for local development (no secrets committed):

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

### 3. Airtable Fields

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

### 4. Configure Twilio Webhook

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

## Commands Reference

| Command | Who | What it does |
|---------|-----|--------------|
| `announce [msg]` | Admin | Send message to everyone |
| `poll [question]` | Admin | Ask everyone a question |
| `STOP` | Anyone | Unsubscribe |
| `START` | Anyone | Re-subscribe |
| `HELP` | Anyone | Show commands |
| Any question | Anyone | Search knowledge base |
