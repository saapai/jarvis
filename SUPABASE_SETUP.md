# Supabase Setup Instructions

## Getting Your Anon Key

1. Go to your Supabase Dashboard: https://supabase.com/dashboard/project/ypoqnmmgjjzctzgjnpkr
2. Navigate to **Settings** → **API** (or go directly to: https://supabase.com/dashboard/project/ypoqnmmgjjzctzgjnpkr/settings/api)
3. Find the **Project API keys** section
4. Copy the **`anon`** or **`public`** key (NOT the `service_role` key)
   - This key is safe to expose in client-side code
   - It starts with `eyJ...` (JWT format)

## Local Development Setup

Add these to your `.env.local` file:

```bash
NEXT_PUBLIC_SUPABASE_URL="https://ypoqnmmgjjzctzgjnpkr.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your-anon-key-here"
```

**Important:** After adding these, restart your dev server (`npm run dev`)

## Vercel Production Setup

1. Go to your Vercel project: https://vercel.com/your-project/settings/environment-variables
2. Add these environment variables for **All Environments**:
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://ypoqnmmgjjzctzgjnpkr.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `your-anon-key-here`
3. **Redeploy** your application after adding the variables

## Key Differences

- **`SUPABASE_SERVICE_ROLE_KEY`**: Server-side only, has full access (already set)
- **`NEXT_PUBLIC_SUPABASE_ANON_KEY`**: Client-side, safe to expose, used for authentication (needs to be added)

The `NEXT_PUBLIC_` prefix makes the variable available in the browser, which is required for client-side authentication.
