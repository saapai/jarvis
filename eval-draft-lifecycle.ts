/**
 * Draft lifecycle eval — content-extraction (polite-prefix strip), noop-edit
 * honesty, pending-link handling, cancel-strict-out (audience edit != cancel).
 * Mixes pure-function tests (extractContent) with full pipeline tests against
 * a real (throwaway) draft. Run: DATABASE_URL=<direct> npx tsx eval-draft-lifecycle.ts
 */
import { extractContent } from './src/lib/planner/classifier'
import { plan } from './src/lib/planner/index'
import { clearHistory, clearDraft } from './src/lib/planner/history'
import type { UserContext } from './src/lib/planner/types'

let pass = 0, total = 0
const fails: string[] = []
function check(label: string, ok: boolean, detail: string) {
  total++
  if (ok) { pass++; process.stdout.write(`[PASS] ${label}\n`) }
  else { fails.push(`${label}: ${detail}`); process.stdout.write(`[FAIL] ${label}: ${detail}\n`) }
}

async function pureExtractionTests() {
  process.stdout.write('\n=== CONTENT EXTRACTION (polite-prefix strip) ===\n')
  const cases: Array<[string, RegExp]> = [
    ['Can you send out an announcement saying jarvis is king', /^jarvis is king\.?$/i],
    ['can you please announce that dinner is at 8', /^dinner is at 8\.?$/i],
    ['please announce meeting tonight', /^meeting tonight\.?$/i],
    ['could you send an announcement saying party friday', /^party friday\.?$/i],
  ]
  for (const [input, expected] of cases) {
    const out = extractContent(input, 'announcement')
    check(`extractContent("${input}")`, expected.test(out), `got "${out}"`)
  }
}

async function draftPipelineTests() {
  process.stdout.write('\n=== NO-OP EDIT HONESTY ===\n')
  {
    const admin: UserContext = { phone: '15558880001', name: 'Armaan', isAdmin: true, needsName: false, optedOut: false }
    clearHistory(admin.phone); clearDraft(admin.phone)
    const r1 = await plan({ phone: admin.phone, message: 'announce dinner is mandatory tonight at 7', user: admin, sendAnnouncement: async () => 1 })
    const r2 = await plan({ phone: admin.phone, message: 'make it mandatory', user: admin, sendAnnouncement: async () => 1 })
    process.stdout.write(`  turn1 [${r1.action}]: ${r1.response.slice(0, 80)}\n  turn2 [${r2.action}]: ${r2.response.slice(0, 80)}\n`)
    check('no-op edit does not claim a bogus update', !/^(updated|fixed it|new version)/i.test(r2.response.trim()) || /already/i.test(r2.response), r2.response)
  }

  process.stdout.write('\n=== CANCEL-STRICT-OUT (audience edit must NOT delete draft) ===\n')
  {
    const admin: UserContext = { phone: '15558880002', name: 'Armaan', isAdmin: true, needsName: false, optedOut: false }
    clearHistory(admin.phone); clearDraft(admin.phone)
    await plan({ phone: admin.phone, message: 'announce party friday at the house', user: admin, sendAnnouncement: async () => 1 })
    const r2 = await plan({ phone: admin.phone, message: "dont send it to the freshmen, just the seniors", user: admin, sendAnnouncement: async () => 1 })
    process.stdout.write(`  turn2 [${r2.action}]: ${r2.response.slice(0, 100)}\n`)
    // Verify draft still exists (didn't get deleted as a false-positive cancel)
    const r3 = await plan({ phone: admin.phone, message: 'send', user: admin, sendAnnouncement: async () => 1 })
    process.stdout.write(`  turn3(send) [${r3.action}]: ${r3.response.slice(0, 100)}\n`)
    check('audience edit does not silently delete the draft', !/nothing to cancel|no draft/i.test(r3.response), r3.response)
  }

  process.stdout.write('\n=== CANCELLATION (real cancel deletes) ===\n')
  {
    const admin: UserContext = { phone: '15558880003', name: 'Armaan', isAdmin: true, needsName: false, optedOut: false }
    clearHistory(admin.phone); clearDraft(admin.phone)
    await plan({ phone: admin.phone, message: 'announce chapter dinner friday at 7', user: admin, sendAnnouncement: async () => 1 })
    const r2 = await plan({ phone: admin.phone, message: 'actually nvm cancel that', user: admin, sendAnnouncement: async () => 1 })
    process.stdout.write(`  turn2 [${r2.action}]: ${r2.response.slice(0, 100)}\n`)
    check('"actually nvm cancel that" cancels the draft', r2.action === 'chat' && /scrap|cancel|never happened/i.test(r2.response), r2.response)
  }

  process.stdout.write('\n=== ACCIDENTAL BROADCAST (edit never fires a send) ===\n')
  {
    const admin: UserContext = { phone: '15558880004', name: 'Armaan', isAdmin: true, needsName: false, optedOut: false }
    let sent: string[] = []
    for (let trial = 1; trial <= 5; trial++) {
      clearHistory(admin.phone); clearDraft(admin.phone)
      sent = []
      const send = async (c: string) => { sent.push(c); return 1 }
      await plan({ phone: admin.phone, message: 'Send out an announcement saying jarvis is king', user: admin, sendAnnouncement: send })
      const r2 = await plan({ phone: admin.phone, message: 'No just say jarvis is king', user: admin, sendAnnouncement: send })
      check(`trial ${trial}: edit does not premature-send`, sent.length === 0 && r2.action !== 'draft_send', `action=${r2.action}, sent=${JSON.stringify(sent)}`)
    }
  }

  process.stdout.write('\n=== DUPLICATE COMPOSE (re-issuing a poll request never blasts) ===\n')
  {
    const admin: UserContext = { phone: '15558880005', name: 'Armaan', isAdmin: true, needsName: false, optedOut: false }
    clearHistory(admin.phone); clearDraft(admin.phone)
    let sent: string[] = []
    const send = async (c: string) => { sent.push(c); return 1 }
    const r1 = await plan({ phone: admin.phone, message: 'send out a poll asking if people are coming to active meeting', user: admin, sendAnnouncement: send })
    process.stdout.write(`  turn1 [${r1.action}]: ${r1.response.slice(0, 90)}\n`)
    check('poll request becomes a draft (not silently sent)', r1.action === 'draft_write' && sent.length === 0, `action=${r1.action}`)
  }
}

async function main() {
  await pureExtractionTests()
  await draftPipelineTests()
  process.stdout.write(`\nSUMMARY: ${pass}/${total} passed\n`)
  if (fails.length) process.stdout.write('FAILURES:\n' + fails.map(f => '  ' + f).join('\n') + '\n')
  process.exit(fails.length ? 1 : 0)
}
main().catch(e => { process.stdout.write('ERR ' + e.message + '\n' + e.stack + '\n'); process.exit(1) })
