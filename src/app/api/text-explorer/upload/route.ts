import { NextRequest, NextResponse } from 'next/server';
import { processUpload, llmClient, textExplorerRepository } from '@/text-explorer';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, rawText } = body;

    if (!rawText || typeof rawText !== 'string') {
      return NextResponse.json({ error: 'rawText is required' }, { status: 400 });
    }

    const uploadName = name ?? `Upload ${new Date().toISOString()}`;

    const { id: uploadId } = await textExplorerRepository.createUpload({
      name: uploadName,
      rawText,
    });

    const processResult = await processUpload(rawText, llmClient);

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


