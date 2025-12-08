import { NextRequest, NextResponse } from 'next/server';
import { getPrisma } from '@/lib/prisma';

export async function GET() {
  try {
    const prisma = await getPrisma();
    const uploads = await prisma.upload.findMany({
      include: {
        _count: {
          select: { facts: true }
        }
      },
      orderBy: { createdAt: 'desc' },
    });

    const formatted = uploads.map((upload) => ({
      id: upload.id,
      name: upload.name,
      rawText: upload.rawText,
      factCount: upload._count.facts,
      createdAt: upload.createdAt.toISOString(),
    }));

    return NextResponse.json({ uploads: formatted });
  } catch (error) {
    console.error('Uploads fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch uploads' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Upload ID required' }, { status: 400 });
    }

    const prisma = await getPrisma();
    
    // Delete all facts for this upload first (cascade should handle this, but be explicit)
    await prisma.fact.deleteMany({ where: { uploadId: id } });
    await prisma.upload.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Upload delete error:', error);
    return NextResponse.json({ error: 'Failed to delete upload' }, { status: 500 });
  }
}


