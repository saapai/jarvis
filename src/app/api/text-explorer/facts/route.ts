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

    const where: any = {};
    const baseFilters: any = {};

    if (category && category !== 'all') {
      baseFilters.category = category;
    }

    if (subcategory) {
      baseFilters.subcategory = { contains: subcategory };
    }

    if (timeRef) {
      baseFilters.timeRef = { contains: timeRef };
    }

    if (month) {
      baseFilters.dateStr = { startsWith: month };
    }

    if (entity) {
      // Search for entity/phrase in entities, sourceText, and content
      // This allows clicking on any phrase/keyword in the Wikipedia cards
      // Combine with other filters using AND
      const entityFilter = {
        OR: [
          { entities: { contains: entity, mode: 'insensitive' } },
          { sourceText: { contains: entity, mode: 'insensitive' } },
          { content: { contains: entity, mode: 'insensitive' } },
        ],
      };
      
      if (Object.keys(baseFilters).length > 0) {
        // Combine entity filter with other filters using AND
        where.AND = [entityFilter, baseFilters];
      } else {
        // Only entity filter, no need for AND
        Object.assign(where, entityFilter);
      }
    } else {
      Object.assign(where, baseFilters);
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
      calendarDates: fact.calendarDates ? JSON.parse(fact.calendarDates) : null,
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

