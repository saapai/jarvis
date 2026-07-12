/**
 * Onboarding eval — extractName hardening. Verifies questions/commands never
 * poison the stored name, and conversational prefixes get stripped.
 * Run: npx tsx eval-onboarding.ts
 */
import { extractName } from './src/lib/planner/nameExtraction'

const TRIALS = 3

type Case = { input: string; expectName: string | null; note: string }
const CASES: Case[] = [
  { input: 'When is summons', expectName: null, note: 'question must never become a stored name' },
  { input: 'what is sep', expectName: null, note: 'question must never become a stored name' },
  { input: 'When is ski trip', expectName: null, note: 'question' },
  { input: 'When is general meeting', expectName: null, note: 'question' },
  { input: 'no im saathvik', expectName: 'Saathvik', note: 'strip conversational prefix' },
  { input: "I'm Sarah", expectName: 'Sarah', note: 'strip "I\'m"' },
  { input: 'my name is John', expectName: 'John', note: 'strip "my name is"' },
  { input: 'call me Mike', expectName: 'Mike', note: 'strip "call me"' },
  { input: 'Saathvik', expectName: 'Saathvik', note: 'bare name' },
  { input: 'Herro', expectName: null, note: 'greeting typo, not a name (LLM judgment — observe)' },
  { input: 'Yo what up', expectName: null, note: 'greeting' },
  { input: 'Hi', expectName: null, note: 'greeting' },
]

async function main() {
  let pass = 0
  const fails: string[] = []
  for (const c of CASES) {
    const results: (string | null)[] = []
    for (let t = 0; t < TRIALS; t++) results.push(await extractName(c.input))
    const allMatch = results.every(r => r === c.expectName)
    process.stdout.write(`[${allMatch ? 'PASS' : 'FAIL'}] "${c.input}" → [${results.join(', ')}] (expect ${c.expectName}) — ${c.note}\n`)
    if (allMatch) pass++
    else fails.push(`"${c.input}": got [${results.join(', ')}], expected ${c.expectName}`)
  }
  process.stdout.write(`\nSUMMARY: ${pass}/${CASES.length} passed\n`)
  if (fails.length) process.stdout.write('FAILURES:\n' + fails.map(f => '  ' + f).join('\n') + '\n')
  process.exit(fails.length ? 1 : 0)
}
main().catch(e => { process.stdout.write('ERR ' + e.message + '\n'); process.exit(1) })
