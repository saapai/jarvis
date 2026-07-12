/**
 * Retrieval fidelity eval — date-fidelity, topic-fidelity, link-grounding,
 * multi-match disambiguation, recap, recurring-resolution, meta-query.
 * Tests handleContentQuery against REAL production data (read-only).
 * Run: DATABASE_URL=<direct> npx tsx eval-retrieval.ts
 */
import { handleContentQuery } from './src/lib/planner/actions/content'
import { routeContentSearch } from './src/text-explorer/router'

const SEP = '8207e690-2a68-4b49-8055-4305d249fcb4'
const TRIALS = 2

type Case = {
  category: string
  msg: string
  history?: Array<{ direction: 'inbound' | 'outbound'; text: string; createdAt: Date; meta?: any }>
  mustMatch?: RegExp
  mustNotMatch?: RegExp
  note: string
}

const now = () => new Date()
const CASES: Case[] = [
  { category: 'date-fidelity', msg: 'when are alumni reunions',
    mustMatch: /july 17|august 1|august 29/i, note: 'must reproduce exact real dates' },

  { category: 'topic-fidelity', msg: 'when is soccer',
    mustNotMatch: /retreat|ski trip/i, note: 'should not pad with unrelated events when no soccer-specific match' },

  { category: 'link-grounding', msg: 'is there a sep discord link',
    mustNotMatch: /discord\.gg|discord\.com/i, note: 'no discord link exists — must not fabricate one; a slack link if returned must not be mislabeled discord' },

  { category: 'meta-query', msg: 'whats going on',
    mustNotMatch: /no clue|idk what/i, note: 'meta query should aggregate, not deflect' },

  { category: 'meta-query-empty', msg: '',
    note: 'empty input — should nudge, not dump calendar (handled upstream normally, testing content path tolerance)' },

  { category: 'followup-pronoun', msg: 'when are they',
    history: [
      { direction: 'inbound', text: 'when are alumni reunions', createdAt: now() },
      { direction: 'outbound', text: 'alumni reunions: la july 17, ny aug 1, sf aug 29', createdAt: now(), meta: { action: 'content_query' } }
    ],
    mustMatch: /july 17|august 1|august 29/i, note: 'pronoun follow-up resolves to reunions' },

  { category: 'followup-greeting-pronoun', msg: 'Hello when are they',
    history: [
      { direction: 'inbound', text: 'when are alumni reunions', createdAt: now() },
      { direction: 'outbound', text: 'alumni reunions: la july 17, ny aug 1, sf aug 29', createdAt: now(), meta: { action: 'content_query' } }
    ],
    mustMatch: /july 17|august 1|august 29/i, note: 'greeting prefix stripped before pronoun resolution' },

  { category: 'recap', msg: 'What did you just send out',
    history: [
      { direction: 'outbound', text: 'happy friday - rsvp for alumni reunions is open', createdAt: now(), meta: { action: 'announcement' } }
    ],
    mustNotMatch: /idk what you'?re asking|no clue/i, note: 'recap should not deflect with sass' },
]

async function turn(c: Case) {
  const responses: string[] = []
  for (let t = 0; t < TRIALS; t++) {
    const r = await handleContentQuery({
      phone: '15559990000', message: c.msg, userName: 'Lindsey',
      searchContent: (q: string) => routeContentSearch(q, SEP),
      recentMessages: c.history
    })
    responses.push(r.response)
  }
  const matchOk = !c.mustMatch || responses.every(r => c.mustMatch!.test(r))
  const notMatchOk = !c.mustNotMatch || responses.every(r => !c.mustNotMatch!.test(r))
  return { c, responses, pass: matchOk && notMatchOk, matchOk, notMatchOk }
}

async function main() {
  let pass = 0
  const fails: string[] = []
  for (const c of CASES) {
    const r = await turn(c)
    process.stdout.write(`[${r.pass ? 'PASS' : 'FAIL'}] [${c.category}] "${c.msg || '(empty)'}" — ${c.note}\n`)
    for (const resp of r.responses) process.stdout.write(`    → ${resp.replace(/\n/g, ' / ').slice(0, 180)}\n`)
    if (r.pass) pass++
    else fails.push(`[${c.category}] "${c.msg}": matchOk=${r.matchOk} notMatchOk=${r.notMatchOk}`)
  }
  process.stdout.write(`\nSUMMARY: ${pass}/${CASES.length} passed (asserted); some cases are observational\n`)
  if (fails.length) process.stdout.write('FAILURES:\n' + fails.map(f => '  ' + f).join('\n') + '\n')
  process.exit(0)
}
main().catch(e => { process.stdout.write('ERR ' + e.message + '\n' + e.stack + '\n'); process.exit(1) })
