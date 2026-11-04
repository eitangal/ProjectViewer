import { GoogleGenAI } from '@google/genai';

export interface DocumentChunk {
  filePath: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  content: string;
}

const INDEXABLE_EXTENSIONS = new Set([
  '.md', '.mdx', '.txt', '.yaml', '.yml', '.json',
  '.mmd', '.mermaid', '.ts', '.tsx', '.js', '.jsx',
  '.py', '.go', '.sql', '.html', '.css', '.toml'
]);

export function isIndexableFile(filePath: string): boolean {
  const dotIdx = filePath.lastIndexOf('.');
  if (dotIdx === -1) return false;
  return INDEXABLE_EXTENSIONS.has(filePath.slice(dotIdx).toLowerCase());
}

/**
 * Splits a file into overlapping line-aware chunks (~1200 chars per chunk, 10 lines overlap)
 */
export function chunkFileContent(filePath: string, rawText: string): DocumentChunk[] {
  const lines = rawText.split(/\r?\n/);
  const chunks: DocumentChunk[] = [];

  const MAX_CHARS = 1200;
  const OVERLAP_LINES = 10;

  let startLine = 1;
  let currentLines: string[] = [];
  let currentCharCount = 0;
  let chunkIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    currentLines.push(line);
    currentCharCount += line.length + 1;

    // Trigger split on markdown heading boundary or character budget
    const isHeadingBreak = /^#{1,3}\s/.test(line) && currentCharCount > 400;
    if (currentCharCount >= MAX_CHARS || isHeadingBreak || i === lines.length - 1) {
      const endLine = startLine + currentLines.length - 1;
      chunks.push({
        filePath,
        chunkIndex: chunkIndex++,
        startLine,
        endLine,
        content: `File: ${filePath} (Lines ${startLine}-${endLine})\n---\n${currentLines.join('\n')}`,
      });

      if (i < lines.length - 1) {
        const overlap = currentLines.slice(-OVERLAP_LINES);
        currentLines = [...overlap];
        currentCharCount = overlap.reduce((acc, l) => acc + l.length + 1, 0);
        startLine = endLine - overlap.length + 1;
      }
    }
  }

  return chunks;
}

export class GeminiRagService {
  /**
   * Validates a Gemini API key by making a lightweight request
   */
  public async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const resp = await ai.models.embedContent({
        model: 'text-embedding-004',
        contents: 'test connection',
        config: { outputDimensionality: 768 },
      });
      return !!resp.embeddings?.[0]?.values?.length;
    } catch (err: any) {
      throw new Error(`Invalid Gemini API key: ${err.message || 'Validation failed'}`);
    }
  }

  /**
   * Generates 768-dimensional embeddings in batches using Publisher's Gemini API key
   */
  public async embedChunks(
    decryptedGeminiKey: string,
    texts: string[],
    model: string = 'text-embedding-004'
  ): Promise<Float32Array[]> {
    const ai = new GoogleGenAI({ apiKey: decryptedGeminiKey });
    const BATCH_SIZE = 50;
    const vectors: Float32Array[] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);

      // Support batch contents or individual calls
      for (const text of batch) {
        const response = await ai.models.embedContent({
          model,
          contents: text,
          config: { outputDimensionality: 768 },
        });

        const values = response.embeddings?.[0]?.values;
        if (!values || values.length === 0) {
          throw new Error('Gemini API returned empty embedding vector');
        }
        vectors.push(new Float32Array(values));
      }
    }
    return vectors;
  }

  /**
   * Streams grounded RAG answers strictly from ACL-authorized chunks
   */
  public async *streamGroundedAnswer(params: {
    decryptedGeminiKey: string;
    model?: string;
    systemPrompt?: string;
    userQuestion: string;
    retrievedChunks: { filePath: string; startLine: number; endLine: number; content: string }[];
  }): AsyncGenerator<string> {
    const {
      decryptedGeminiKey,
      model = 'gemini-2.5-flash',
      systemPrompt,
      userQuestion,
      retrievedChunks,
    } = params;

    const ai = new GoogleGenAI({ apiKey: decryptedGeminiKey });

    const contextBlock = retrievedChunks
      .map(
        (c, idx) =>
          `[Source ${idx + 1}] [${c.filePath}#L${c.startLine}-L${c.endLine}]\n${c.content}`
      )
      .join('\n\n====================\n\n');

    const defaultSystemInstruction = [
      'You are a technical repository assistant.',
      'Answer strictly using the provided repository context blocks.',
      'If the answer is not in the context, state clearly that the information is not available in the accessible project files.',
      'Always cite sources inline using exact bracket notation like [filepath#Lstart-Lend] (e.g. [docs/arch/overview.md#L12-L40]).',
    ].join(' ');

    const systemInstruction = systemPrompt
      ? `${systemPrompt} Always cite sources inline using exact bracket notation like [filepath#Lstart-Lend].`
      : defaultSystemInstruction;

    const responseStream = await ai.models.generateContentStream({
      model,
      contents: `Context:\n${contextBlock}\n\nQuestion: ${userQuestion}`,
      config: {
        systemInstruction,
        temperature: 0.1,
      },
    });

    for await (const chunk of responseStream) {
      if (chunk.text) {
        yield chunk.text;
      }
    }
  }
}
