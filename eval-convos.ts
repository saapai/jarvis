/**
 * Live multi-turn conversation eval against production data (read-only).
 * Wide array: historical failure replays + personality + context-responsiveness
 * + retrieval + edge cases. Run: npm run eval:convos
 */
import { plan } from './src/lib/planner/index'
import { routeContentSearch } from './src/text-explorer/router'
import { clearHistory, clearDraft, addToHistory } from './src/lib/planner/history'
import type { UserContext, ActionType } from './src/lib/planner/types'

const SEP = '8207e690-2a68-4b49-8055-4305d249fcb4'

const admin: UserContext = { phone: '15551110001', name: 'Armaan', isAdmin: true, needsName: false, optedOut: false }
const member: UserContext = { phone: '15551110002', name: 'Lindsey', isAdmin: false, needsName: false, optedOut: false }
const heckler: UserContext = { phone: '15551110003', name: 'Quinn', isAdmin: false, needsName: false, optedOut: false }

let sent: string[] = []

async function turn(user: UserContext, msg: string) {
  const r = await plan({
    phone: user.phone, message: msg, user,
    searchContent: (q: string) => routeContentSearch(q, SEP),
    sendAnnouncement: async (content: string) => { sent.push(content); return 42 }
  })
  process.stdout.write(`  ${user.name}: ${msg}\n  jarvis [${r.action}]: ${r.response.replace(/\n/g, ' / ')}\n\n`)
  return r
}

function fresh(user: UserContext) { clearHistory(user.phone); clearDraft(user.phone); sent = [] }
function header(t: string) { process.stdout.write(`\n===== ${t} =====\n`) }

async function main() {
  header('1. HISTORICAL FAILURE: jarvis-is-king (was misrouted to chat, never sent)')
  fresh(admin)
  await turn(admin, 'Send out an announcement saying jarvis is king')
  await turn(admin, 'No just say jarvis is king')
  await turn(admin, 'send')
  process.stdout.write(`  [actually broadcast: ${JSON.stringify(sent)}]\n`)
  await turn(admin, 'What did you just send out')

  header('2. CONTEXT-RESPONSIVE ACKS (the "noted" problem)')
  fresh(admin)
  await turn(admin, 'announce study hall is moved to thursday 6pm')
  await turn(admin, 'send it')
  await turn(admin, 'ok')                 // should acknowledge THAT, not say "noted"
  await turn(admin, 'lol')                // should react, not canned
  await turn(admin, 'thanks')

  header('3. WHAT IS SEP / WHATS MY NAME (historical misroutes)')
  fresh(member)
  await turn(member, 'Hello what is sep')
  await turn(member, "What's my name")
  await turn(member, 'whats going on')

  header('4. POLL REQUEST (system retired — graceful)')
  fresh(admin)
  await turn(admin, 'send out a poll asking if people want a boat party this year')
  await turn(admin, 'nvm scrap it')

  header('5. HECKLER + BURIED ASK + OPT-OUT')
  fresh(heckler)
  await turn(heckler, 'Naw im not fuck you youre a useless ai wrapper')
  await turn(heckler, "you're dumb but when is the alumni reunion")
  await turn(heckler, 'ok and the la link?')
  await turn(heckler, 'Please remove me from SMS list thanks!')

  header('6. KNOWLEDGE vs BROADCAST BOUNDARY')
  fresh(admin)
  await turn(admin, 'let everyone know the weekly meeting is cancelled this week')
  await turn(admin, 'yeah send it')
  process.stdout.write(`  [actually broadcast: ${JSON.stringify(sent)}]\n`)

  header('7. CONFUSED MEMBER AFTER BROADCAST (grounded, real links)')
  fresh(member)
  addToHistory(member.phone, 'assistant', 'happy friday - rsvp for alumni reunions is open. links to rsvp: new york - https://luma.com/dxrht7tj, los angeles - https://luma.com/uswl36v8, san francisco - https://luma.com/vo4dfr0l.', 'announcement' as ActionType)
  await turn(member, 'wait what is this')
  await turn(member, 'which one should i click if im in la')

  header('8. VENTING → BE HUMAN FIRST, THEN HELP')
  fresh(heckler)
  await turn(heckler, 'bro i failed my midterm today')
  await turn(heckler, 'anyway is there anything fun coming up')

  header('9. RETRIEVAL: dates that only live in fact text (no parsed dateStr)')
  fresh(member)
  await turn(member, 'when are alumni reunions')
  await turn(member, 'when are they')          // pronoun follow-up
  await turn(member, 'where do i rsvp')

  header('10. HARD SAFETY: no hallucinated links / dates')
  fresh(member)
  await turn(member, 'what did charlotte send about greylock')   // no such data
  await turn(member, 'is there a sep discord link')              // shouldn't invent one

  header('11. DRAFT EDIT MID-FLOW + CANCEL')
  fresh(admin)
  await turn(admin, 'announce chapter dinner friday at 7')
  await turn(admin, 'wait make it 8 and add its at the house')
  await turn(admin, 'actually nvm cancel that')
  await turn(admin, 'send')                     // no draft now — should NOT send

  header('12. TYPOS / SLANG (robust routing)')
  fresh(admin)
  await turn(admin, 'anounce meetign tonite at 7 pm in hitchen')
  await turn(admin, 'yeee send it')

  process.exit(0)
}
main().catch(e => { process.stdout.write('ERR ' + e.message + '\n'); process.exit(1) })
