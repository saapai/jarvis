# Scripts

## add-sep-members.ts

Adds phone numbers to the SEP (Enclave) workspace.

### Usage

```bash
# Make sure DATABASE_URL and DIRECT_URL are set in your environment
npx tsx scripts/add-sep-members.ts
```

### What it does

1. Finds or creates the SEP space (slug: `sep`, joinCode: `SEP`)
2. For each phone number in the list:
   - Normalizes the phone number (removes formatting, handles country codes)
   - Creates a User record if it doesn't exist
   - Adds the user as a member of the SEP space (skips if already a member)

### Phone Number Formats

The script handles various phone number formats:
- `+13853687238` (E.164 with country code)
- `(408) 763-6262` (formatted US number)
- `4087636262` (digits only)

All formats are normalized to 10-digit US phone numbers.
