import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

/**
 * Extract plain text from an uploaded file (PDF, DOCX, or plain text).
 *
 * This is a lightweight TypeScript port of the ppt_dump extraction idea:
 * get all the text out, then let the existing LLM pipeline turn it into facts/cards.
 */
export async function extractTextFromUploadedFile(
  file: { name?: string; arrayBuffer: () => Promise<ArrayBuffer> },
  fallbackName?: string
): Promise<string> {
  const name = (file.name as string | undefined) || fallbackName || 'upload';
  const lower = name.toLowerCase();

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Simple text files – just read as text
  if (lower.endsWith('.txt') || lower.endsWith('.md')) {
    return buffer.toString('utf8');
  }

  // PDF extraction
  if (lower.endsWith('.pdf')) {
    const data = await pdfParse(buffer);
    return data.text || '';
  }

  // DOCX extraction
  if (lower.endsWith('.docx')) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  }

  // Fallback: try to treat as text if nothing else matched
  const maybeText = buffer.toString('utf8');
  if (maybeText && maybeText.trim().length > 0) {
    return maybeText;
  }

  throw new Error(`Unsupported file type for upload: ${name}. Supported: .pdf, .docx, .txt, .md`);
}


