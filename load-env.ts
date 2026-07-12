/**
 * Side-effect import for eval/tsx scripts: load .env.local into process.env.
 * These scripts run under `npx tsx` (not Next.js), which does NOT auto-load
 * .env.local — so without this, OPENAI_API_KEY is undefined, the OpenAI client
 * throws on every call, and the classifier silently falls back to `chat`,
 * making a healthy classifier look catastrophically broken. Import this FIRST:
 *   import './load-env'
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'

try {
  const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const key = m[1]
    if (process.env[key]) continue // don't clobber a value already exported
    process.env[key] = m[2].replace(/^["']|["']$/g, '')
  }
} catch {
  // no .env.local — rely on whatever is already exported in the shell
}
