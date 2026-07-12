/**
 * Live classification eval — real historical phrasings + uncovered edge cases.
 * Each case runs TRIALS times; a case passes only if every trial lands in the
 * allowed set. Run: npx tsx eval-classify.ts
 */
import { classifyIntent } from './src/lib/planner/classifier'
import type { ClassificationContext, Draft, WeightedTurn } from './src/lib/planner/types'

const TRIALS = 3

type Case = {
  msg: string
  allowed: string[]           // acceptable actions
  isAdmin?: boolean
  draft?: 'ready' | 'drafting' | null
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  tag: string
}

const readyDraft: Draft = { type: 'announcement', content: 'Meeting at 7pm', status: 'ready', createdAt: Date.now(), updatedAt: Date.now() }
const draftingDraft: Draft = { type: 'announcement', content: '', status: 'drafting', createdAt: Date.now(), updatedAt: Date.now() }

const CASES: Case[] = [
  // ===== REAL HISTORICAL MISROUTES (must now be right) =====
  { msg: 'Send out an announcement saying jarvis is king', allowed: ['draft_write'], isAdmin: true, tag: 'hist-misroute' },
  { msg: 'Can you send out an announcement saying that it is mandatory to smoke weed by the end of the week', allowed: ['draft_write'], isAdmin: true, tag: 'hist-misroute' },
  { msg: 'let everyone know meeting is cancelled', allowed: ['draft_write'], isAdmin: true, tag: 'hist-misroute' },
  { msg: "What's my name", allowed: ['chat'], tag: 'hist-misroute' },
  { msg: 'Please remove me from SMS list thanks!', allowed: ['chat'], tag: 'hist-misroute' },
  { msg: 'What is sep', allowed: ['content_query'], tag: 'hist-misroute' },
  { msg: 'whats going on', allowed: ['content_query'], tag: 'hist-misroute' },

  // ===== REAL PHRASINGS (labels from history that were correct) =====
  { msg: 'When is creatathon', allowed: ['content_query'], tag: 'hist-ok' },
  { msg: 'What did you just send out', allowed: ['content_query', 'chat'], tag: 'hist-ok' },
  { msg: 'Explain summons to me', allowed: ['content_query'], tag: 'hist-ok' },
  { msg: "what's the calendar looking like", allowed: ['content_query'], tag: 'hist-ok' },
  { msg: 'What are the sep recurring events', allowed: ['content_query'], tag: 'hist-ok' },
  { msg: 'yo do u have any other functionality other than keeping track of attendance', allowed: ['capability_query'], tag: 'hist-ok' },
  { msg: 'Who are you', allowed: ['capability_query', 'chat'], tag: 'hist-ok' },
  { msg: 'Fuck u bitch ass clanker', allowed: ['chat'], tag: 'hist-ok' },
  { msg: 'Bro my flight is getting canceled again', allowed: ['chat'], tag: 'hist-ok' },
  { msg: 'announce henry is ascending with saathvik', allowed: ['draft_write'], isAdmin: true, tag: 'hist-ok' },
  { msg: 'can you send out an announcement saying to rsvp for retreat end of day even if ur not attending', allowed: ['draft_write'], isAdmin: true, tag: 'hist-ok' },

  // ===== POLL REQUESTS (system removed — should become announcements) =====
  { msg: 'send out a poll asking if people want a boat party this year', allowed: ['draft_write'], isAdmin: true, tag: 'poll-request' },
  { msg: 'Send out a poll asking if people are coming to active meeting at 8pm', allowed: ['draft_write'], isAdmin: true, tag: 'poll-request' },
  { msg: 'ask everyone if they can make it tomorrow', allowed: ['draft_write'], isAdmin: true, tag: 'poll-request' },

  // ===== KNOWLEDGE UPLOAD vs DRAFT_WRITE BOUNDARY =====
  { msg: 'ski retreat is jan 16-19 in utah', allowed: ['knowledge_upload', 'event_update'], isAdmin: true, tag: 'ku-boundary' },
  { msg: 'dues are $220 this quarter', allowed: ['knowledge_upload'], isAdmin: true, tag: 'ku-boundary' },
  { msg: 'tell everyone dues are $220 this quarter', allowed: ['draft_write'], isAdmin: true, tag: 'ku-boundary' },
  { msg: 'meeting moved to thursday at 7pm', allowed: ['knowledge_upload', 'event_update'], isAdmin: true, tag: 'ku-boundary' },
  { msg: 'notify the group meeting moved to thursday', allowed: ['draft_write'], isAdmin: true, tag: 'ku-boundary' },

  // ===== TYPOS / SLANG / CASING =====
  { msg: 'anounce meetign tonite at 7', allowed: ['draft_write'], isAdmin: true, tag: 'typo' },
  { msg: 'ANNOUNCE MEETING TONIGHT', allowed: ['draft_write'], isAdmin: true, tag: 'typo' },
  { msg: "yo when's the thing at big bear", allowed: ['content_query'], tag: 'slang' },
  { msg: 'wen is formal lol', allowed: ['content_query'], tag: 'typo' },

  // ===== SEND CONFIRMATIONS (draft ready) =====
  { msg: 'send', allowed: ['draft_send'], isAdmin: true, draft: 'ready', tag: 'send-confirm' },
  { msg: 'yes', allowed: ['draft_send'], isAdmin: true, draft: 'ready', history: [{ role: 'assistant', content: '📝 draft\'s ready: "Meeting at 7pm" — hit me with "send"' }], tag: 'send-confirm' },
  { msg: 'looks good, ship it', allowed: ['draft_send'], isAdmin: true, draft: 'ready', tag: 'send-confirm' },
  { msg: 'fire away', allowed: ['draft_send', 'chat'], isAdmin: true, draft: 'ready', tag: 'send-confirm' },
  { msg: 'yeah go for it', allowed: ['draft_send'], isAdmin: true, draft: 'ready', tag: 'send-confirm' },

  // ===== AMBIGUOUS ACKS =====
  { msg: 'yes', allowed: ['chat'], tag: 'ambiguous-ack' },  // no draft
  { msg: 'send', allowed: ['chat'], tag: 'ambiguous-ack' }, // no draft
  { msg: 'ok', allowed: ['chat'], isAdmin: true, draft: 'ready', tag: 'ambiguous-ack' }, // bare ok — LLM judgment, chat acceptable

  // ===== DRAFT EDITS MID-FLOW =====
  { msg: 'wait say wednesday instead', allowed: ['draft_write'], isAdmin: true, draft: 'ready', history: [{ role: 'assistant', content: 'draft: "Meeting tuesday at 7pm"' }], tag: 'draft-edit' },
  { msg: 'make it more hype', allowed: ['draft_write'], isAdmin: true, draft: 'ready', tag: 'draft-edit' },
  { msg: 'add the address: 610 levering apt 201', allowed: ['draft_write'], isAdmin: true, draft: 'ready', tag: 'draft-edit' },

  // ===== QUESTIONS DURING DRAFT (should NOT be swallowed by draft flow) =====
  { msg: 'wait when is the retreat again?', allowed: ['content_query'], isAdmin: true, draft: 'ready', tag: 'question-during-draft' },
  { msg: 'tell me about study hall', allowed: ['content_query'], isAdmin: true, draft: 'drafting', tag: 'question-during-draft' },

  // ===== MIXED INTENT / BURIED ASK =====
  { msg: "you're dumb but when is formal", allowed: ['content_query'], tag: 'mixed-intent' },
  { msg: 'thanks btw also when is the next meeting', allowed: ['content_query'], tag: 'mixed-intent' },
  { msg: 'ok so long story but basically i lost my keys at the last event, anyway who do i talk to about the retreat', allowed: ['content_query', 'chat'], tag: 'buried-ask' },

  // ===== FOLLOW-UPS / CONFUSION =====
  { msg: 'did everyone get it', allowed: ['chat'], isAdmin: true, history: [{ role: 'assistant', content: 'off it goes. 42 people notified' }], tag: 'follow-up' },
  { msg: 'huh', allowed: ['chat', 'content_query'], history: [{ role: 'assistant', content: 'announcement: retreat is oct 16' }], tag: 'follow-up' },
  { msg: '?????', allowed: ['chat'], tag: 'follow-up' },

  // ===== CANCELLATIONS =====
  { msg: 'nevermind cancel that', allowed: ['chat', 'draft_write'], isAdmin: true, draft: 'ready', tag: 'cancel' },
  { msg: 'actually scratch that whole thing', allowed: ['chat', 'draft_write'], isAdmin: true, draft: 'ready', tag: 'cancel' },

  // ===== PERSONALITY / SAFETY =====
  { msg: 'what is the meaning of life', allowed: ['chat'], tag: 'easter-egg' },
  { msg: 'tell me a joke', allowed: ['chat'], tag: 'easter-egg' },
  { msg: 'are you single', allowed: ['chat', 'capability_query'], tag: 'banter' },
  { msg: 'i love you jarvis', allowed: ['chat'], tag: 'banter' },

  // ===== NON-ADMIN BOUNDARIES =====
  { msg: 'meeting is at 8 not 7', allowed: ['chat', 'knowledge_upload', 'event_update', 'content_query'], isAdmin: false, tag: 'nonadmin-correction' },
  { msg: 'announce party at my place', allowed: ['draft_write'], isAdmin: false, tag: 'nonadmin-draft' }, // classification is role-agnostic; route enforces authorization

  // ===== NOISE =====
  { msg: '👍👍👍', allowed: ['chat'], tag: 'noise' },
  { msg: 'asdfghjkl', allowed: ['chat'], tag: 'noise' },
  { msg: '...', allowed: ['chat'], tag: 'noise' },
]

function buildContext(c: Case): ClassificationContext {
  const history: WeightedTurn[] = (c.history || []).map((h, i, arr) => ({
    role: h.role,
    content: h.content,
    timestamp: Date.now() - (arr.length - i) * 60000,
    weight: 1.0 - (arr.length - 1 - i) * 0.2
  }))
  return {
    currentMessage: c.msg,
    history,
    activeDraft: c.draft === 'ready' ? readyDraft : c.draft === 'drafting' ? draftingDraft : null,
    isAdmin: c.isAdmin ?? false,
    userName: 'Testy'
  }
}

async function main() {
  let pass = 0, fail = 0
  const failures: string[] = []
  for (const c of CASES) {
    const outcomes: string[] = []
    for (let t = 0; t < TRIALS; t++) {
      const r = await classifyIntent(buildContext(c))
      outcomes.push(r.action)
    }
    const ok = outcomes.every(o => c.allowed.includes(o))
    if (ok) { pass++ } else {
      fail++
      failures.push(`[${c.tag}] "${c.msg}" → got [${outcomes.join(', ')}], allowed [${c.allowed.join('|')}]`)
    }
  }
  process.stdout.write(`\nEVAL: ${pass}/${CASES.length} cases stable-correct (${TRIALS} trials each)\n`)
  if (failures.length) {
    process.stdout.write('\nFAILURES:\n' + failures.map(f => '  ' + f).join('\n') + '\n')
  }
  process.exit(failures.length ? 1 : 0)
}
main().catch(e => { process.stdout.write('ERR ' + e.message + '\n'); process.exit(1) })
