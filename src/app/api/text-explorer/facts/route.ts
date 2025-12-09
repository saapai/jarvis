import { NextRequest, NextResponse } from 'next/server';
import { getPrisma } from '@/lib/prisma';
import { enforceRateLimit } from '../rateLimit';

export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const rateLimited = enforceRateLimit(req);
  if (rateLimited) return rateLimited;

  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');
    const subcategory = searchParams.get('subcategory');
    const entity = searchParams.get('entity');
    const timeRef = searchParams.get('timeRef');
    const month = searchParams.get('month');

    const where: {
      category?: string;
      subcategory?: { contains: string };
      entities?: { contains: string };
      timeRef?: { contains: string };
      dateStr?: { startsWith: string };
    } = {};

    if (category && category !== 'all') {
      where.category = category;
    }

    if (subcategory) {
      where.subcategory = { contains: subcategory };
    }

    if (entity) {
      where.entities = { contains: entity };
    }

    if (timeRef) {
      where.timeRef = { contains: timeRef };
    }

    if (month) {
      where.dateStr = { startsWith: month };
    }

    const prisma = await getPrisma();
    const facts = await prisma.fact.findMany({
      where,
      include: {
        upload: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const formatted = facts.map((fact) => ({
      id: fact.id,
      content: fact.content,
      sourceText: fact.sourceText,
      category: fact.category,
      subcategory: fact.subcategory,
      timeRef: fact.timeRef,
      dateStr: fact.dateStr,
      entities: JSON.parse(fact.entities),
      uploadName: fact.upload.name,
      createdAt: fact.createdAt.toISOString(),
    }));

    return NextResponse.json({ facts: formatted });
  } catch (error) {
    console.error('Facts fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch facts' }, { status: 500 });
  }
}

