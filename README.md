# 🤖 Jarvis SMS

SMS-powered announcements, polls, and intelligent Q&A powered by a knowledge base.

## Features

- **SMS Announcements** - Broadcast messages to all subscribers
- **Polls** - Ask yes/no/maybe questions with smart response parsing
- **Text Explorer** - Dump text and extract structured facts with AI
- **Smart Q&A** - Users can text questions and get answers from the knowledge base

## Quick Start

### 1. Install & Run

```bash
npm install
npx prisma generate
npx prisma db push
npm run dev
```

### 2. Environment Variables

Create `.env` for local development:

```env
# Database (local SQLite)
DATABASE_URL="file:./dev.db"

# OpenAI (for text extraction)
OPENAI_API_KEY=your_openai_key

# Twilio
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx

# Airtable (for SMS users)
AIRTABLE_API_KEY=your_airtable_key
AIRTABLE_BASE_ID=your_base_id
AIRTABLE_TABLE_NAME=your_table_name

# Admin
ADMIN_PHONE_NUMBERS=1234567890

# App URL
APP_URL=http://localhost:3000
```

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

### 1. Set up Turso Database (Free)

```bash
# Install Turso CLI
brew install tursodatabase/tap/turso

# Login and create database
turso auth login
turso db create jarvis-db
turso db show jarvis-db --url
turso db tokens create jarvis-db
```

### 2. Configure Vercel Environment Variables

In your Vercel project settings, add:

```
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your_turso_token
OPENAI_API_KEY=your_openai_key
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx
AIRTABLE_API_KEY=your_airtable_key
AIRTABLE_BASE_ID=your_base_id
AIRTABLE_TABLE_NAME=your_table_name
ADMIN_PHONE_NUMBERS=1234567890
APP_URL=https://your-app.vercel.app
DATABASE_URL=file:./dev.db
```

### 3. Initialize Turso Database Schema

After deploying, run this locally to push schema to Turso:

```bash
# Set Turso as the database temporarily
export DATABASE_URL="libsql://your-db.turso.io?authToken=your_token"
npx prisma db push
```

Or use Turso's web shell:
```sql
CREATE TABLE Upload (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rawText TEXT NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Fact (
  id TEXT PRIMARY KEY,
  uploadId TEXT NOT NULL,
  content TEXT NOT NULL,
  sourceText TEXT,
  category TEXT NOT NULL,
  subcategory TEXT,
  timeRef TEXT,
  dateStr TEXT,
  entities TEXT NOT NULL,
  parentId TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (uploadId) REFERENCES Upload(id) ON DELETE CASCADE,
  FOREIGN KEY (parentId) REFERENCES Fact(id)
);
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
