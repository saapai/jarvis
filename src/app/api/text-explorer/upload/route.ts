import { NextRequest, NextResponse } from 'next/server';
import { processUpload, llmClient, textExplorerRepository } from '@/text-explorer';
import { extractTextFromUploadedFile } from '@/text-explorer/fileExtract';

export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';

    let uploadName: string | undefined;
    let rawText: string | null = null;

    // Multipart form-data (file upload)
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const nameField = form.get('name');
      const fileField = form.get('file');
      const rawTextField = form.get('rawText');

      if (typeof nameField === 'string') {
        uploadName = nameField;
      }

      if (typeof rawTextField === 'string' && rawTextField.trim().length > 0) {
        rawText = rawTextField;
      }

      if (!rawText && fileField && typeof fileField === 'object' && 'arrayBuffer' in (fileField as any)) {
        const uploaded: any = fileField;
        rawText = await extractTextFromUploadedFile(uploaded, typeof uploaded.name === 'string' ? uploaded.name : undefined);
        if (!uploadName && typeof uploaded.name === 'string') {
          uploadName = uploaded.name;
        }
      }
    } else {
      // JSON body (existing behaviour)
      const body = await req.json();
      const { name, rawText: bodyRawText } = body;
      uploadName = name;
      rawText = typeof bodyRawText === 'string' ? bodyRawText : null;
    }

    if (!rawText || typeof rawText !== 'string' || rawText.trim().length === 0) {
      return NextResponse.json({ error: 'Either rawText or a supported file is required' }, { status: 400 });
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

    return NextResponse.json({ uploadId, factCount: processResult.facts.length });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: 'Failed to process upload' }, { status: 500 });
  }
}




