import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { filename, contentType } = body as {
      filename?: string;
      contentType?: string;
    };

    if (!filename || typeof filename !== 'string') {
      return NextResponse.json(
        { error: 'filename is required' },
        { status: 400 }
      );
    }

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const blobPath = `text-explorer/${Date.now()}-${safeName}`;

    // Create an empty blob with upload authorization; client will overwrite via returned URL
    const blob = await put(
      blobPath,
      Buffer.alloc(0),
      {
        contentType: contentType || 'application/octet-stream',
        // Vercel Blob currently only supports "public" here; URLs are still hard to guess due to random suffix
        access: 'public',
        addRandomSuffix: true,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      }
    );

    return NextResponse.json({
      url: blob.url,
      pathname: blob.pathname,
    });
  } catch (error) {
    console.error('[TextExplorer UploadTarget] Error creating upload target', error);
    return NextResponse.json(
      { error: 'Failed to create upload target' },
      { status: 500 }
    );
  }
}


