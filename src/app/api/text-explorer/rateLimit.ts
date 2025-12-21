import { NextRequest, NextResponse } from 'next/server'

type Bucket = {
  count: number
  windowStart: number
}

const WINDOW_MS = 60_000
const DEFAULT_LIMIT = 30
const buckets = new Map<string, Bucket>()

function getClientKey(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || 'unknown'
  }
  // NextRequest.ip is only available in the node runtime
  return (req as any).ip || 'unknown'
}

export function enforceRateLimit(
  req: NextRequest,
  limit: number = DEFAULT_LIMIT,
  windowMs: number = WINDOW_MS
): NextResponse | null {
  const key = getClientKey(req)
  const now = Date.now()

  const bucket = buckets.get(key) || { count: 0, windowStart: now }

  // reset window if expired
  if (now - bucket.windowStart > windowMs) {
    bucket.count = 0
    bucket.windowStart = now
  }

  bucket.count += 1
  buckets.set(key, bucket)

  if (bucket.count > limit) {
    return NextResponse.json(
      { error: 'rate limit exceeded, please retry shortly' },
      { status: 429 }
    )
  }

  return null
}








