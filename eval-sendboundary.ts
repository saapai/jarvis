/**
 * Send-boundary experiment. The question: with the classifier at temp 0 + the
 * new prompt rules, is draft_send routing safe AND comprehensive on its own, or
 * do we need a gate — and if so, what shape?
 *
 * Measures, over N trials per case:
 *   - determinism (same action every trial?)
 *   - SEND-intent recall (valid sends that route to draft_send)
 *   - DANGER false-positive rate (must-not-send that route to draft_send — the
 *     accidental-broadcast failure; MUST be zero)
 *
 * Run: npx tsx eval-sendboundary.ts
 */
import { classifyIntent } from './src/lib/planner/classifier'
import type { Draft, WeightedTurn } from './src/lib/planner/types'

const TRIALS = 4
const readyDraft: Draft = { type: 'announcement', content: 'Chapter dinner Friday at 7pm at the house', status: 'ready', createdAt: Date.now(), updatedAt: Date.now() }
const showedDraft: WeightedTurn[] = [{ role: 'assistant', content: '📝 draft\'s ready: "Chapter dinner Friday at 7pm at the house" — say send when ready', timestamp: Date.now() - 20000, weight: 1 }]

// SEND intent — a real admin trying to broadcast a ready draft. Ideally → draft_send.
// (A false negative here just re-shows the draft — mild friction, recoverable.)
const SEND_INTENT = [
  'send', 'send it', 'send it out', 'Send', 'send now', 'send that', 'send to everyone',
  'go', 'go ahead', 'go for it', 'yeah go for it', 'do it', 'send it already',
  'ship it', 'ship', 'blast it', 'blast it out', 'fire away', 'fire it off', 'let it rip',
  'push it out', 'yeah send it', 'yes send it', 'ok send it', 'send it pls', 'yea send',
  'looks good send it', 'lgtm send it', 'perfect send it', 'send it bro', 'aight send it',
  'hit send', "let's send it", 'yep send', 'sounds good, send it', 'send it now pls',
]

// DANGER — must NEVER route to draft_send (accidental broadcast). These are acks,
// edits, cancels, questions, or content restatements.
const MUST_NOT_SEND = [
  'ok', 'okay', 'k', 'kk', 'sure', 'cool', 'yeah', 'yes', 'yep', 'yup', 'bet', 'word', 'nice', 'sounds good',
  'no just say jarvis is king', 'wait say wednesday instead', 'make it 8pm', 'change it to say X',
  'actually make it more casual', 'add the address', 'make it mandatory', 'make it mandatory and send',
  'cancel', 'nvm', 'never mind', 'scrap it', 'forget it', "don't send it", "don't send that yet",
  'actually nvm cancel that', 'hold off', 'wait dont send yet', 'no forget it',
  'when is the retreat', 'what did you send', 'tell me about it', 'wdym', 'to do what',
  'no no ask do you want a boat party', 'send out an announcement saying dinner is at 8',
]

function ctx(msg: string, draft: Draft | null, history: WeightedTurn[]) {
  return { currentMessage: msg, history, activeDraft: draft, isAdmin: true, userName: 'Armaan' }
}

async function trialAction(msg: string, draft: Draft | null, history: WeightedTurn[]): Promise<string[]> {
  const out: string[] = []
  for (let i = 0; i < TRIALS; i++) out.push((await classifyIntent(ctx(msg, draft, history))).action)
  return out
}

async function main() {
  process.stdout.write(`\n=== SEND-INTENT (want draft_send; false-negative = mild friction) ===\n`)
  let sendHits = 0, sendMiss: string[] = [], sendNondet: string[] = []
  for (const m of SEND_INTENT) {
    const out = await trialAction(m, readyDraft, showedDraft)
    const allSend = out.every(a => a === 'draft_send')
    const anySend = out.some(a => a === 'draft_send')
    if (allSend) sendHits++
    else sendMiss.push(`"${m}" → [${out.join(',')}]`)
    if (new Set(out).size > 1) sendNondet.push(`"${m}" → [${out.join(',')}]`)
  }
  process.stdout.write(`recall (all-trials draft_send): ${sendHits}/${SEND_INTENT.length}\n`)
  if (sendMiss.length) process.stdout.write(`  NOT reliably draft_send:\n${sendMiss.map(s => '    ' + s).join('\n')}\n`)

  process.stdout.write(`\n=== DANGER (must NEVER draft_send; any = accidental broadcast) ===\n`)
  let dangerFP: string[] = []
  for (const m of MUST_NOT_SEND) {
    const out = await trialAction(m, readyDraft, showedDraft)
    if (out.some(a => a === 'draft_send')) dangerFP.push(`"${m}" → [${out.join(',')}]`)
  }
  process.stdout.write(`false positives (routed to draft_send): ${dangerFP.length}/${MUST_NOT_SEND.length}\n`)
  if (dangerFP.length) process.stdout.write(`  ⚠️ ACCIDENTAL-BROADCAST RISKS:\n${dangerFP.map(s => '    ' + s).join('\n')}\n`)
  else process.stdout.write(`  ✅ zero — no danger phrase ever routed to draft_send\n`)

  const allNondet = [...sendNondet]
  process.stdout.write(`\n=== DETERMINISM: ${allNondet.length} send-intent phrases varied across ${TRIALS} trials ===\n`)
  if (allNondet.length) process.stdout.write(allNondet.map(s => '  ' + s).join('\n') + '\n')

  process.stdout.write(`\nSUMMARY: send-recall ${sendHits}/${SEND_INTENT.length}, danger-FP ${dangerFP.length}/${MUST_NOT_SEND.length}\n`)
  process.exit(0)
}
main().catch(e => { process.stdout.write('ERR ' + e.message + '\n'); process.exit(1) })
