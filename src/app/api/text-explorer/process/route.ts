import { NextRequest, NextResponse } from 'next/server';
import { processUpload, llmClient, textExplorerRepository, reconcileFactsAfterUpload } from '@/text-explorer';
import { extractTextFromUploadedFile } from '@/text-explorer/fileExtract';

export const dynamic = 'force-dynamic';

type ProcessBody = {
  name?: string;
  fileUrl?: string;
  rawText?: string;
};

async function fetchFileAsFile(url: string, name?: string): Promise<{ name?: string; arrayBuffer: () => Promise<ArrayBuffer> }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch file from storage: ${res.status}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return {
    name,
    arrayBuffer: async () => arrayBuffer,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body: ProcessBody = await req.json();
    const { name, fileUrl, rawText: bodyRawText } = body;

    let uploadName = name;
    let rawText: string | null = typeof bodyRawText === 'string' ? bodyRawText : null;

    if (!rawText && fileUrl) {
      console.log('[TextExplorer Process] Fetching file from storage', { fileUrl });
      const file = await fetchFileAsFile(fileUrl, name);
      rawText = await extractTextFromUploadedFile(file, name);
    }

    if (!rawText || rawText.trim().length === 0) {
      return NextResponse.json(
        { error: 'Either rawText or a fileUrl with supported content is required' },
        { status: 400 }
      );
    }

    const finalName = uploadName ?? `Upload ${new Date().toISOString()}`;

    const { id: uploadId } = await textExplorerRepository.createUpload({
      name: finalName,
      rawText,
    });

    const processResult = await processUpload(rawText, llmClient);

    await textExplorerRepository.createFacts({
      uploadId,
      facts: processResult.facts,
    });

    await reconcileFactsAfterUpload(uploadId);

    return NextResponse.json({ uploadId, factCount: processResult.facts.length });
  } catch (error) {
    console.error('[TextExplorer Process] Error processing upload', error);
    return NextResponse.json(
      { error: 'Failed to process upload' },
      { status: 500 }
    );
  }
}


