import { NextRequest, NextResponse } from 'next/server';
import { processUpload, llmClient, textExplorerRepository } from '@/text-explorer';
import { enforceRateLimit } from '../rateLimit';

export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req);
  if (rateLimited) return rateLimited;

  try {
    const body = await req.json();
    const { name, rawText } = body;

    if (!rawText || typeof rawText !== 'string') {
      return NextResponse.json({ error: 'rawText is required' }, { status: 400 });
    }

    const uploadName = name ?? `Upload ${new Date().toISOString()}`;
    const uploadDate = new Date();

    const { id: uploadId } = await textExplorerRepository.createUpload({
      name: uploadName,
      rawText,
    });

    // Pass upload date as reference date for relative dates like "tomorrow"
    const processResult = await processUpload(rawText, llmClient, uploadDate);

    await textExplorerRepository.createFacts({
      uploadId,
      facts: processResult.facts,
    });

    return NextResponse.json({ uploadId, factCount: processResult.facts.length });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: 'Failed to process upload' }, { status: 500 });
  }
}




