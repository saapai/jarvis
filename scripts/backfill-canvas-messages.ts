/**
 * Backfill Jarvis's Message table from the canvas (Duttapad) SMS history.
 *
 * Canvas ran its own SMS pipeline and logged everything to its own Postgres
 * (sms_messages). This script pulls that history through canvas's stats API
 * and inserts it into Jarvis's Message table so /admin shows the full picture.
 *
 * Idempotent: every imported row carries meta.canvasId, so re-runs skip rows
 * already imported. Rows that were dual-logged by both apps (same phone,
 * direction, and text within 10 minutes) are also skipped.
 *
 * Run with:  npx tsx scripts/backfill-canvas-messages.ts
 * Options:   CANVAS_STATS_URL=https://duttapad.com   (default)
 *            DRY_RUN=1   report what would be imported without writing
 */

import '../load-env'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const BASE_URL = (process.env.CANVAS_STATS_URL || 'https://duttapad.com').replace(/\/$/, '')
const DRY_RUN = process.env.DRY_RUN === '1'

// Duplicate window for messages logged by BOTH apps (e.g. announcements both
// pipelines sent). Canvas and Jarvis clocks are both Postgres-side, so drift
// is small; 10 minutes is generous.
const DUP_WINDOW_MS = 10 * 60 * 1000

function normalizePhone(phone: string): string {
  const digits = (phone || '').replace(/[^\d]/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.substring(1)
  }
  return digits.slice(-10)
}

interface CanvasConvo {
  phone_normalized: string
  member_name: string | null
  total_count: string | number
}

interface CanvasMessage {
  id: string
  phone_normalized: string
  direction: 'inbound' | 'outbound'
  text: string
  meta: string | Record<string, unknown> | null
  created_at: string
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

async function main() {
  console.log(`Backfilling from ${BASE_URL}${DRY_RUN ? ' (DRY RUN)' : ''}\n`)

  // 1. Everything already in Jarvis, for dedupe
  const existing = await prisma.message.findMany({
    select: { phoneNumber: true, direction: true, text: true, createdAt: true, meta: true }
  })
  console.log(`Jarvis DB currently has ${existing.length} messages`)

  const importedCanvasIds = new Set<string>()
  const byContentKey = new Map<string, number[]>()

  for (const msg of existing) {
    if (msg.meta) {
      try {
        const meta = JSON.parse(msg.meta)
        if (meta?.canvasId) importedCanvasIds.add(meta.canvasId)
      } catch {}
    }
    const key = `${normalizePhone(msg.phoneNumber)}|${msg.direction}|${msg.text}`
    const times = byContentKey.get(key) || []
    times.push(msg.createdAt.getTime())
    byContentKey.set(key, times)
  }
  console.log(`${importedCanvasIds.size} messages were imported by a previous run\n`)

  // 2. Canvas conversation list
  const convos = await fetchJson<CanvasConvo[]>(`${BASE_URL}/api/stats/conversations`)
  console.log(`Canvas has ${convos.length} conversations\n`)

  let totalImported = 0
  let totalSkippedImported = 0
  let totalSkippedDual = 0

  for (const convo of convos) {
    const phone = normalizePhone(convo.phone_normalized)
    if (phone.length < 10) {
      console.log(`  skipping invalid phone "${convo.phone_normalized}"`)
      continue
    }

    const data = await fetchJson<{ messages: CanvasMessage[] }>(
      `${BASE_URL}/api/stats/conversations/${encodeURIComponent(convo.phone_normalized)}`
    )
    const messages = data.messages || []

    const toInsert: { phoneNumber: string; direction: string; text: string; meta: string; createdAt: Date }[] = []
    let skippedImported = 0
    let skippedDual = 0

    for (const msg of messages) {
      if (importedCanvasIds.has(msg.id)) {
        skippedImported++
        continue
      }

      const createdAt = new Date(msg.created_at)
      const key = `${phone}|${msg.direction}|${msg.text}`
      const times = byContentKey.get(key)
      if (times && times.some(t => Math.abs(t - createdAt.getTime()) < DUP_WINDOW_MS)) {
        skippedDual++
        continue
      }

      let originalMeta: Record<string, unknown> = {}
      if (msg.meta) {
        try {
          originalMeta = typeof msg.meta === 'string' ? JSON.parse(msg.meta) : msg.meta
        } catch {}
      }

      toInsert.push({
        phoneNumber: phone,
        direction: msg.direction,
        text: msg.text || '',
        meta: JSON.stringify({ ...originalMeta, canvasId: msg.id, backfilledFrom: 'canvas' }),
        createdAt
      })
      // Guard against duplicate rows inside the canvas feed itself
      importedCanvasIds.add(msg.id)
      const insertedTimes = byContentKey.get(key) || []
      insertedTimes.push(createdAt.getTime())
      byContentKey.set(key, insertedTimes)
    }

    if (!DRY_RUN && toInsert.length > 0) {
      await prisma.message.createMany({ data: toInsert })
    }

    totalImported += toInsert.length
    totalSkippedImported += skippedImported
    totalSkippedDual += skippedDual

    const name = convo.member_name || phone
    console.log(
      `  ${name}: ${toInsert.length} imported, ${skippedImported} already imported, ${skippedDual} dual-logged`
    )
  }

  console.log(`\nDone. ${DRY_RUN ? 'Would import' : 'Imported'} ${totalImported} messages ` +
    `(${totalSkippedImported} previously imported, ${totalSkippedDual} dual-logged skips).`)
}

main()
  .catch(err => {
    console.error('Backfill failed:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
