import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST() {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  }

  try {
    await prisma.fact.deleteMany({});
    await prisma.upload.deleteMany({});

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('Reset error:', error);
    return NextResponse.json({ error: 'Failed to reset' }, { status: 500 });
  }
}

