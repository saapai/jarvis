import { NextRequest, NextResponse } from 'next/server';
import { processUpload, llmClient, textExplorerRepository } from '@/text-explorer';
import { extractTextFromUploadedFile } from '@/text-explorer/fileExtract';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const contentType = req.headers.get('content-type') || '';

  console.log('[TextExplorer Upload] Incoming request', {
    method: req.method,
    contentType,
  });

  try {
    let uploadName: string | undefined;
    let rawText: string | null = null;

    // Multipart form-data (file upload)
    if (contentType.includes('multipart/form-data')) {
      console.log('[TextExplorer Upload] Detected multipart/form-data');

      const form = await req.formData();
      const nameField = form.get('name');
      const fileField = form.get('file');
      const rawTextField = form.get('rawText');

      console.log('[TextExplorer Upload] Form fields presence', {
        hasName: !!nameField,
        hasFile: !!fileField,
        hasRawText: !!rawTextField,
        fileType: fileField ? typeof fileField : null,
      });

      if (typeof nameField === 'string') {
        uploadName = nameField;
      }

      if (typeof rawTextField === 'string' && rawTextField.trim().length > 0) {
        rawText = rawTextField;
      }

      if (!rawText && fileField && typeof fileField === 'object' && 'arrayBuffer' in (fileField as any)) {
        const uploaded: any = fileField;

        console.log('[TextExplorer Upload] Extracting text from uploaded file', {
          name: typeof uploaded.name === 'string' ? uploaded.name : undefined,
        });

        try {
          rawText = await extractTextFromUploadedFile(
            uploaded,
            typeof uploaded.name === 'string' ? uploaded.name : undefined
          );
        } catch (extractError) {
          console.error('[TextExplorer Upload] File extraction error', extractError);
          return NextResponse.json(
            { error: 'Failed to extract text from uploaded file' },
            { status: 400 }
          );
        }

        if (!uploadName && typeof uploaded.name === 'string') {
          uploadName = uploaded.name;
        }
      }
    } else {
      // JSON body (existing behaviour)
      console.log('[TextExplorer Upload] Detected JSON body');

      const body = await req.json();
      const { name, rawText: bodyRawText } = body;
      uploadName = name;
      rawText = typeof bodyRawText === 'string' ? bodyRawText : null;
    }

    if (!rawText || typeof rawText !== 'string' || rawText.trim().length === 0) {
      console.warn('[TextExplorer Upload] Missing or empty text content');
      return NextResponse.json(
        { error: 'Either rawText or a supported file is required' },
        { status: 400 }
      );
    }

    const finalName = uploadName ?? `Upload ${new Date().toISOString()}`;

    console.log('[TextExplorer Upload] Creating upload record', {
      name: finalName,
      textLength: rawText.length,
    });

    const { id: uploadId } = await textExplorerRepository.createUpload({
      name: finalName,
      rawText,
    });

    console.log('[TextExplorer Upload] Processing upload with LLM', {
      uploadId,
    });

    const processResult = await processUpload(rawText, llmClient);

    console.log('[TextExplorer Upload] Saving facts', {
      uploadId,
      factCount: processResult.facts.length,
    });

    await textExplorerRepository.createFacts({
      uploadId,
      facts: processResult.facts,
    });

    console.log('[TextExplorer Upload] Upload completed successfully', {
      uploadId,
      factCount: processResult.facts.length,
    });

    return NextResponse.json({ uploadId, factCount: processResult.facts.length });
  } catch (error) {
    console.error('[TextExplorer Upload] Upload error', error);
    return NextResponse.json({ error: 'Failed to process upload' }, { status: 500 });
  }
}




