declare module 'pdf-parse' {
  const pdfParse: (data: Buffer | Uint8Array | ArrayBuffer) => Promise<{ text?: string; [key: string]: any }>;
  export default pdfParse;
}

declare module 'mammoth' {
  interface ExtractResult {
    value?: string;
    messages?: Array<{ type: string; message: string }>;
  }

  const mammoth: {
    extractRawText(input: { buffer: Buffer | Uint8Array | ArrayBuffer }): Promise<ExtractResult>;
  };

  export default mammoth;
}


