export type RootCategory = 'social' | 'professional' | 'pledging' | 'events' | 'meetings' | 'other';

export interface ExtractedFact {
  content: string;
  sourceText: string | null;
  category: RootCategory;
  subcategory: string | null;
  timeRef: string | null;
  dateStr: string | null;
  entities: string[];
  embedding?: number[]; // Optional embedding vector
}

export interface ProcessResult {
  facts: ExtractedFact[];
}

export interface LLMClient {
  extractFacts(text: string): Promise<ExtractedFact[]>;
}

export interface TextExplorerRepository {
  createUpload(params: { name: string; rawText: string }): Promise<{ id: string }>;
  createFacts(params: { uploadId: string; facts: ExtractedFact[] }): Promise<void>;
}

export interface FactNode {
  id: string;
  content: string;
  sourceText: string | null;
  category: RootCategory;
  subcategory: string | null;
  timeRef: string | null;
  dateStr: string | null;
  entities: string[];
  uploadName?: string;
  createdAt?: string;
}




