// This route is no longer used; file uploads now go directly to Vercel Blob from the client.
// Kept as a stub to avoid breaking any existing callers.
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { error: 'Direct upload target is no longer used; client uploads directly to Blob.' },
    { status: 410 }
  );
}


