# 🤖 Jarvis SMS

SMS-powered announcements and polls - all data in **one Airtable table**.

## Quick Start

### 1. Install & Run

```bash
npm install
npm run dev
```

### 2. Add Fields to Your Airtable

Add these fields to your existing table:

| Field | Type | Description |
|-------|------|-------------|
| Phone | Single line text | User's phone (10 digits) |
| Name | Single line text | User's name |
| Needs_Name | Checkbox | Waiting for name? |
| Opted_Out | Checkbox | Unsubscribed? |
| Pending_Poll | Single line text | Current poll question |
| Last_Response | Single select | Yes, No, Maybe |
| Last_Notes | Long text | Response notes |

### 3. Environment Variables

Create `.env.local` with your credentials:

```env
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx

AIRTABLE_API_KEY=your_airtable_key
AIRTABLE_BASE_ID=your_base_id
AIRTABLE_TABLE_NAME=your_table_name

ADMIN_PHONE_NUMBERS=1234567890

APP_URL=http://localhost:3000
```

### 4. Configure Twilio Webhook

Set webhook URL to: `https://your-app.vercel.app/api/twilio/sms` (POST)

## Usage

### Admin Commands

```
announce meeting tonight at 7pm
→ ✅ sent to 15 people!

poll active meeting tonight?
→ ✅ poll sent to 15 people!
```

Or step-by-step:
```
you: make an announcement
bot: what would you like to announce?
you: meeting at 7pm
bot: 📝 ready to send: "meeting at 7pm"
     reply "send" or "cancel"
you: send
bot: ✅ sent to 15 people!
```

### User Flow

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
```

### Commands

| Command | Who | What it does |
|---------|-----|--------------|
| `announce [msg]` | Admin | Send message to everyone |
| `poll [question]` | Admin | Ask everyone a question |
| `STOP` | Anyone | Unsubscribe |
| `START` | Anyone | Re-subscribe |
| `HELP` | Anyone | Show commands |

## Deploy

1. Push to GitHub
2. Import to Vercel
3. Add environment variables in Vercel dashboard
4. Update Twilio webhook URL

```bash
vercel deploy --prod
```
