/**
 * Live multi-turn conversation eval against production data (read-only).
 * Replays real historical failure conversations + edge-case scenarios.
 * Run: npx tsx eval-convos.ts
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

async function main() {
  process.stdout.write('\n===== 1. HISTORICAL FAILURE REPLAY: the jarvis-is-king session =====\n')
  fresh(admin)
  await turn(admin, 'Send out an announcement saying jarvis is king')
  await turn(admin, 'No just say jarvis is king')
  await turn(admin, 'send')
  process.stdout.write(`  [broadcast actually sent: ${JSON.stringify(sent)}]\n`)
  await turn(admin, 'What did you just send out')

  process.stdout.write('\n===== 2. HISTORICAL FAILURE REPLAY: what is sep / whats my name =====\n')
  fresh(member)
  await turn(member, 'Hello what is sep')
  await turn(member, "What's my name")
  await turn(member, 'whats going on')

  process.stdout.write('\n===== 3. POLL REQUEST (system removed — graceful) =====\n')
  fresh(admin)
  await turn(admin, 'send out a poll asking if people want a boat party this year')
  await turn(admin, 'nvm scrap it')

  process.stdout.write('\n===== 4. HECKLER + BURIED ASKS =====\n')
  fresh(heckler)
  await turn(heckler, 'Naw im not fuck you youre a useless ai wrapper')
  await turn(heckler, "you're dumb but when is the alumni reunion")
  await turn(heckler, 'ok and the la link?')
  await turn(heckler, 'Please remove me from SMS list thanks!')

  process.stdout.write('\n===== 5. KNOWLEDGE vs BROADCAST BOUNDARY =====\n')
  fresh(admin)
  await turn(admin, 'let everyone know the weekly meeting is cancelled this week')
  await turn(admin, 'yeah send it')
  process.stdout.write(`  [broadcast actually sent: ${JSON.stringify(sent)}]\n`)

  process.stdout.write('\n===== 6. CONFUSED MEMBER AFTER BROADCAST (grounded, real links) =====\n')
  fresh(member)
  addToHistory(member.phone, 'assistant', 'happy friday - rsvp for alumni reunions is open. links to rsvp: new york - https://luma.com/dxrht7tj, los angeles - https://luma.com/uswl36v8, san francisco - https://luma.com/vo4dfr0l.', 'announcement' as ActionType)
  await turn(member, 'wait what is this')
  await turn(member, 'which one should i click if im in la')

  process.stdout.write('\n===== 7. EMOTIONAL / OFF-TOPIC (personality with judgment) =====\n')
  fresh(heckler)
  await turn(heckler, 'bro i failed my midterm today')
  await turn(heckler, 'anyway is there anything fun coming up')

  process.exit(0)
}
main().catch(e => { process.stdout.write('ERR ' + e.message + '\n'); process.exit(1) })
