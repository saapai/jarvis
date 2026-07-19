import { NextRequest, NextResponse } from 'next/server'

// Full message thread for one phone, proxied from canvas and cached so
// reopening a conversation doesn't refetch the whole thread from upstream.

const CANVAS_URL = (process.env.CANVAS_STATS_URL || 'https://canvas-eosin-eta.vercel.app').replace(/\/$/, '')
const CACHE_SECONDS = 120

export async function GET(
  _request: NextRequest,
  { params }: { params: { phone: string } }
) {
  const phone = params.phone
  if (!/^\d{7,15}$/.test(phone)) {
    return NextResponse.json({ error: 'Invalid phone' }, { status: 400 })
  }

  try {
    const res = await fetch(`${CANVAS_URL}/api/stats/conversations/${encodeURIComponent(phone)}`, {
      next: { revalidate: CACHE_SECONDS }
    })
    if (!res.ok) {
      throw new Error(`canvas responded ${res.status}`)
    }
    const data = await res.json()

    return NextResponse.json(data, {
      headers: { 'Cache-Control': `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=600` }
    })
  } catch (error) {
    console.error(`[Admin] Failed to load canvas conversation ${phone}:`, error)
    return NextResponse.json({ error: 'Failed to load conversation' }, { status: 502 })
  }
}
