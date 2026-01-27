# Supabase Phone Authentication Setup

## The "Unsupported phone provider" Error

This error means that **phone authentication is not enabled** in your Supabase project, or no SMS provider is configured.

## How to Fix

1. **Go to your Supabase Dashboard:**
   - Navigate to: https://supabase.com/dashboard/project/ypoqnmmgjjzctzgjnpkr/auth/providers

2. **Enable Phone Authentication:**
   - Find "Phone" in the list of providers
   - Toggle it to **Enabled**

3. **Configure an SMS Provider:**
   Supabase requires one of these SMS providers:
   - **Twilio** (recommended - you already have Twilio set up)
   - MessageBird
   - Vonage
   - TextLocal

4. **If using Twilio:**
   - In Supabase Dashboard → Auth → Providers → Phone
   - Select "Twilio" as the provider
   - Enter your Twilio credentials (found in your Vercel environment variables or Twilio dashboard):
     - Account SID
     - Auth Token
     - Phone Number (your Twilio number)

## Alternative: Use Twilio Verify

If you have Twilio Verify set up, you can use that instead:
- Select "Twilio Verify" as the provider
- Enter your Twilio Verify Service SID

## After Configuration

Once phone authentication is enabled and an SMS provider is configured:
1. The error should disappear
2. Users will be able to receive SMS verification codes
3. The login flow will work end-to-end

## Note

The code already adds `+1` by default for US phone numbers, so that's not the issue. The problem is that Supabase needs phone authentication enabled in the dashboard.
