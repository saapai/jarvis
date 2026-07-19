import { NextResponse } from 'next/server'

// Conversation list proxied from the live canvas (Duttapad) SMS pipeline.
// Canvas's own /api/stats/conversations does a full-table scan, so we cache
// the upstream fetch — the admin page must not pay that cost on every load.

const CANVAS_URL = (process.env.CANVAS_STATS_URL || 'https://canvas-eosin-eta.vercel.app').replace(/\/$/, '')
const CACHE_SECONDS = 120

export interface CanvasConversation {
  phone_normalized: string
  direction: string
  last_message: string | null
  last_message_at: string
  member_name: string | null
  total_count: number
}

export async function GET() {
  try {
    const res = await fetch(`${CANVAS_URL}/api/stats/conversations`, {
      next: { revalidate: CACHE_SECONDS }
    })
    if (!res.ok) {
      throw new Error(`canvas responded ${res.status}`)
    }
    const conversations: CanvasConversation[] = await res.json()

    return NextResponse.json(
      { conversations },
      { headers: { 'Cache-Control': `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=600` } }
    )
  } catch (error) {
    console.error('[Admin] Failed to load canvas conversations:', error)
    return NextResponse.json({ error: 'Failed to load conversations' }, { status: 502 })
  }
}
