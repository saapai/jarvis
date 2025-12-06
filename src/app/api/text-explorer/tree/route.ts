import { NextResponse } from 'next/server';
import { getPrisma } from '@/lib/prisma';

// Helper to parse dateStr for sorting
function parseDateForSort(dateStr: string | null): number {
  if (!dateStr) return Infinity;
  if (dateStr.startsWith('recurring:')) return Infinity - 1;
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? Infinity : date.getTime();
}

export async function GET() {
  try {
    const prisma = await getPrisma();
    const facts = await prisma.fact.findMany({
      select: {
        id: true,
        category: true,
        subcategory: true,
        timeRef: true,
        dateStr: true,
        entities: true,
      },
    });

    // Build category tree with subcategories
    const categories: Record<string, { count: number; subcategories: Record<string, number> }> = {};
    const entities: Record<string, number> = {};
    const timeRefs: { name: string; dateStr: string | null; count: number }[] = [];
    const timeRefMap: Record<string, { dateStr: string | null; count: number }> = {};

    for (const fact of facts) {
      // Categories with subcategories
      if (!categories[fact.category]) {
        categories[fact.category] = { count: 0, subcategories: {} };
      }
      categories[fact.category].count++;
      
      if (fact.subcategory) {
        const subcat = fact.subcategory.toLowerCase().trim();
        categories[fact.category].subcategories[subcat] = 
          (categories[fact.category].subcategories[subcat] || 0) + 1;
      }

      // Count entities
      const parsedEntities = JSON.parse(fact.entities) as string[];
      for (const entity of parsedEntities) {
        const normalized = entity.toLowerCase().trim();
        if (normalized) {
          entities[normalized] = (entities[normalized] || 0) + 1;
        }
      }

      // Time refs with date for sorting
      if (fact.timeRef) {
        const normalized = fact.timeRef.toLowerCase().trim();
        if (!timeRefMap[normalized]) {
          timeRefMap[normalized] = { dateStr: fact.dateStr, count: 0 };
        }
        timeRefMap[normalized].count++;
        // Keep the most specific dateStr
        if (fact.dateStr && !timeRefMap[normalized].dateStr) {
          timeRefMap[normalized].dateStr = fact.dateStr;
        }
      }
    }

    // Convert timeRefMap to sorted array
    for (const [name, data] of Object.entries(timeRefMap)) {
      timeRefs.push({ name, dateStr: data.dateStr, count: data.count });
    }
    timeRefs.sort((a, b) => parseDateForSort(a.dateStr) - parseDateForSort(b.dateStr));

    const tree = {
      categories: Object.entries(categories)
        .map(([name, data]) => ({
          name,
          count: data.count,
          subcategories: Object.entries(data.subcategories)
            .map(([subName, subCount]) => ({ name: subName, count: subCount }))
            .sort((a, b) => b.count - a.count),
        }))
        .sort((a, b) => b.count - a.count),
      entities: Object.entries(entities)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      timeRefs,
      totalFacts: facts.length,
    };

    return NextResponse.json(tree);
  } catch (error) {
    console.error('Tree fetch error:', error);
    return NextResponse.json({ error: 'Failed to build tree' }, { status: 500 });
  }
}

