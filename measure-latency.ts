/**
 * End-to-end latency measurement, message-in → reply-ready.
 * Classify floor is measured with zero side effects; full pipeline runs against
 * real infra (DB + LLM) with the outbound send MOCKED so no real texts go out.
 * Run: npx tsx measure-latency.ts
 */
import './load-env'
import { classifyIntent } from './src/lib/planner/classifier'
import { plan } from './src/lib/planner'
import { clearHistory, clearDraft } from './src/lib/planner/history'
import * as draftRepo from './src/lib/repositories/draftRepository'
import type { Draft } from './src/lib/planner/types'

const PHONE = '15550110011' // fake, not a real member
const user = { phone: PHONE, name: 'Testuser', isAdmin: true, needsName: false, optedOut: false }
const noSend = async () => 15 // mock: pretend 15 recipients, no real Twilio

const readyDraft: Draft = { type: 'announcement', content: 'Chapter meeting tonight at 8pm', status: 'ready', createdAt: Date.now(), updatedAt: Date.now() }

type Case = { type: string; msg: string; draft: Draft | null; fullPlan: boolean }
const CASES: Case[] = [
  { type: 'chat',             msg: "how's it going",                          draft: null,       fullPlan: true },
  { type: 'capability_query', msg: 'what can you do',                         draft: null,       fullPlan: true },
  { type: 'content_query',    msg: 'when is the next meeting',                draft: null,       fullPlan: true },
  { type: 'draft_write',      msg: 'announce chapter meeting tonight at 8',   draft: null,       fullPlan: true },
  { type: 'draft_send',       msg: 'send it',                                 draft: readyDraft, fullPlan: false },
  { type: 'draft_cancel',     msg: 'nvm cancel that',                         draft: readyDraft, fullPlan: false },
]

const CLS_TRIALS = 5
const PLAN_TRIALS = 4

async function timeMs(fn: () => Promise<unknown>): Promise<number> {
  const t0 = process.hrtime.bigint()
  await fn()
  return Number(process.hrtime.bigint() - t0) / 1e6
}

function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b)
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length
  return { avg, min: s[0], max: s[s.length - 1], p50: s[Math.floor(s.length / 2)] }
}

async function main() {
  const rows: { type: string; cls: ReturnType<typeof stats>; full?: ReturnType<typeof stats> }[] = []

  for (const c of CASES) {
    // --- classify floor (no side effects; synthetic draft context) ---
    const clsTimes: number[] = []
    for (let i = 0; i < CLS_TRIALS; i++) {
      clsTimes.push(await timeMs(() => classifyIntent({
        currentMessage: c.msg, history: [], activeDraft: c.draft,
        isAdmin: user.isAdmin, userName: user.name,
      } as any)))
    }
    const row: any = { type: c.type, cls: stats(clsTimes) }

    // --- full pipeline (real DB + LLM, send mocked) ---
    if (c.fullPlan) {
      const planTimes: number[] = []
      for (let i = 0; i < PLAN_TRIALS; i++) {
        clearHistory(PHONE); clearDraft(PHONE)
        await draftRepo.deleteDraft(PHONE).catch(() => {})
        planTimes.push(await timeMs(() => plan({ phone: PHONE, message: c.msg, user, conversationHistoryJson: null, sendAnnouncement: noSend })))
      }
      row.full = stats(planTimes)
    }
    rows.push(row)
    console.log(`done: ${c.type}`)
  }

  await draftRepo.deleteDraft(PHONE).catch(() => {})

  console.log('\n================ LATENCY (ms) ================')
  console.log('type                | classify (gpt-4o)      | full pipeline (classify+handler+gen)')
  console.log('                    | avg   p50   min-max     | avg    p50    min-max')
  console.log('--------------------|------------------------|--------------------------------------')
  for (const r of rows) {
    const c = r.cls
    const clsCol = `${c.avg.toFixed(0).padStart(4)}  ${c.p50.toFixed(0).padStart(4)}  ${c.min.toFixed(0)}-${c.max.toFixed(0)}`.padEnd(22)
    let fullCol = '—'
    if (r.full) { const f = r.full; fullCol = `${f.avg.toFixed(0).padStart(4)}   ${f.p50.toFixed(0).padStart(4)}   ${f.min.toFixed(0)}-${f.max.toFixed(0)}` }
    console.log(`${r.type.padEnd(19)} | ${clsCol} | ${fullCol}`)
  }
  console.log('=============================================')
}

main().catch(e => console.error('ERR', e))
