This backend implementation uses **TypeScript / Node.js (Node 22+)** with picomatch for high-speed compiled glob evaluation, native child\_process.execFile against bare Git repositories (zero working-tree disk overhead), @google/genai for embeddings and grounded RAG generation, and better-sqlite3 \+ sqlite-vec for single-file embedded vector storage.

## **1\. Key Encryption & Security Utility (crypto.ts)**

Publisher GitHub tokens and Gemini API keys are encrypted at rest using **AES-256-GCM** with a master key injected via environment variable (MASTER\_ENCRYPTION\_KEY), and decrypted strictly in memory during worker execution.

TypeScript  
// src/utils/crypto.ts  
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM \= 'aes-256-gcm';  
const MASTER\_KEY \= Buffer.from(process.env.MASTER\_ENCRYPTION\_KEY\!, 'hex'); // 32-byte hex (64 chars)

export function encryptSecret(plaintext: string): string {  
  const iv \= randomBytes(12);  
  const cipher \= createCipheriv(ALGORITHM, MASTER\_KEY, iv);  
  const encrypted \= Buffer.concat(\[cipher.update(plaintext, 'utf8'), cipher.final()\]);  
  const authTag \= cipher.getAuthTag();  
  return \`\${iv.toString('hex')}:\${authTag.toString('hex')}:\${encrypted.toString('hex')}\`;  
}

export function decryptSecret(cipherPayload: string): string {  
  const \[ivHex, tagHex, encryptedHex\] \= cipherPayload.split(':');  
  const decipher \= createDecipheriv(ALGORITHM, MASTER\_KEY, Buffer.from(ivHex, 'hex'));  
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));  
  const decrypted \= Buffer.concat(\[  
    decipher.update(Buffer.from(encryptedHex, 'hex')),  
    decipher.final(),  
  \]);  
  return decrypted.toString('utf8');  
}

## **2\. Compiled ACL Glob Matcher Engine (aclMatcher.ts)**

A Viewer may belong to multiple Viewer Groups. A file is accessible if it satisfies **at least one** assigned group's positive criteria (allowedFolders AND allowedExtensions) AND does **not** match that group's excludeGlobs.

TypeScript  
// src/services/aclMatcher.ts  
import picomatch from 'picomatch';  
import path from 'node:path';

export interface GroupAclRule {  
  groupId: string;  
  allowedFolders: string\[\];    // e.g., \["docs/arch", "specs"\] or \["\*"\] for root  
  allowedExtensions: string\[\]; // e.g., \[".md", ".yaml", ".json", ".mmd"\]  
  excludeGlobs: string\[\];      // e.g., \["\*\*/\*.secret.\*", "\*\*/internal/\*\*", "\*\*/.env\*"\]  
  maxFileSizeBytes: number;    // e.g., 1048576 (1 MB)  
}

export interface RepoFileEntry {  
  filePath: string; // Normalized POSIX relative path, e.g., "docs/arch/overview.md"  
  sizeBytes: number;  
}

export class CompiledGroupMatcher {  
  private readonly folderPrefixes: string\[\];  
  private readonly allowAllFolders: boolean;  
  private readonly extSet: Set\<string\>;  
  private readonly isExcluded: picomatch.Matcher;  
  private readonly maxBytes: number;

  constructor(rule: GroupAclRule) {  
    this.allowAllFolders \= rule.allowedFolders.includes('\*') \|\| rule.allowedFolders.includes('/');  
    this.folderPrefixes \= rule.allowedFolders  
      .map((f) \=\> f.replace(/^\\/+\|\\/+\$/g, ''))  
      .filter(Boolean);

    this.extSet \= new Set(  
      rule.allowedExtensions.map((ext) \=\> (ext.startsWith('.') ? ext.toLowerCase() : \`.\${ext.toLowerCase()}\`))  
    );

    this.isExcluded \=  
      rule.excludeGlobs.length \> 0  
        ? picomatch(rule.excludeGlobs, { dot: true, nocase: true })  
        : () \=\> false;

    this.maxBytes \= rule.maxFileSizeBytes \|\| 2 \* 1024 \* 1024;  
  }

  public matches(file: RepoFileEntry): boolean {  
    if (file.sizeBytes \> this.maxBytes) return false;

    // 1\. Explicit exclusion globs always win  
    if (this.isExcluded(file.filePath)) return false;

    // 2\. Extension check  
    const ext \= path.posix.extname(file.filePath).toLowerCase();  
    if (this.extSet.size \> 0 && \!this.extSet.has(ext)) return false;

    // 3\. Allowed folder prefix check  
    if (this.allowAllFolders) return true;  
    return this.folderPrefixes.some(  
      (prefix) \=\> file.filePath \=== prefix \|\| file.filePath.startsWith(\`\${prefix}/\`)  
    );  
  }  
}

/\*\*  
 \* Evaluates the union of permissions across all Viewer Groups assigned to a user  
 \* and returns the exact sorted list of authorized relative file paths.  
 \*/  
export function resolveAuthorizedFiles(  
  allRepoFiles: RepoFileEntry\[\],  
  userGroupRules: GroupAclRule\[\]  
): string\[\] {  
  if (userGroupRules.length \=== 0) return \[\];  
  const compiledMatchers \= userGroupRules.map((rule) \=\> new CompiledGroupMatcher(rule));

  return allRepoFiles  
    .filter((file) \=\> compiledMatchers.some((matcher) \=\> matcher.matches(file)))  
    .map((file) \=\> file.filePath);  
}

## **3\. Shallow Bare-Clone Git Manager (gitManager.ts)**

By maintaining a **bare repository** (--bare \--depth 2 \--single-branch), the server never writes working-tree copies to disk. File trees, commit diffs, and blob contents are streamed directly from Git packfiles into memory.

TypeScript  
// src/services/gitManager.ts  
import { execFile } from 'node:child\_process';  
import { promisify } from 'node:util';  
import fs from 'node:fs/promises';  
import path from 'node:path';  
import { RepoFileEntry } from './aclMatcher.js';

const execFileAsync \= promisify(execFile);

export interface FileDelta {  
  status: 'A' \| 'M' \| 'D';  
  filePath: string;  
}

export class BareGitManager {  
  constructor(private readonly baseReposDir: string) {}

  private getRepoDir(projectId: string): string {  
    return path.join(this.baseReposDir, \`\${projectId}.git\`);  
  }

  /\*\*  
   \* Builds an authenticated HTTPS URL in-memory without persisting tokens in .git/config  
   \*/  
  private buildAuthHeader(githubPat?: string): string\[\] {  
    if (\!githubPat) return \[\];  
    const basicAuth \= Buffer.from(\`x-access-token:\${githubPat}\`).toString('base64');  
    return \['-c', \`http.extraHeader=Authorization: Basic \${basicAuth}\`\];  
  }

  /\*\*  
   \* Initializes a bare clone or fetches the latest commit on the target branch.  
   \* Returns the newly fetched HEAD commit SHA.  
   \*/  
  public async syncBareRepo(  
    projectId: string,  
    repoUrl: string,  
    branch: string,  
    githubPat?: string  
  ): Promise\<string\> {  
    const repoDir \= this.getRepoDir(projectId);  
    const authArgs \= this.buildAuthHeader(githubPat);

    const exists \= await fs  
      .stat(repoDir)  
      .then(() \=\> true)  
      .catch(() \=\> false);

    if (\!exists) {  
      await fs.mkdir(repoDir, { recursive: true });  
      await execFileAsync('git', \[  
        ...authArgs,  
        'clone',  
        '--bare',  
        '--depth',  
        '2',  
        '--single-branch',  
        '--branch',  
        branch,  
        repoUrl,  
        repoDir,  
      \]);  
    } else {  
      await execFileAsync(  
        'git',  
        \[  
          ...authArgs,  
          'fetch',  
          'origin',  
          \`\${branch}:\${branch}\`,  
          '--depth',  
          '2',  
          '--prune',  
        \],  
        { cwd: repoDir }  
      );  
    }

    const { stdout } \= await execFileAsync('git', \['rev-parse', branch\], { cwd: repoDir });  
    return stdout.trim();  
  }

  /\*\*  
   \* Lists all files and their byte sizes in a commit tree (\`git ls-tree \-r \-l\`).  
   \*/  
  public async listRepoFiles(projectId: string, commitSha: string): Promise\<RepoFileEntry\[\]\> {  
    const repoDir \= this.getRepoDir(projectId);  
    const { stdout } \= await execFileAsync(  
      'git',  
      \['ls-tree', '-r', '-l', '--full-tree', commitSha\],  
      { cwd: repoDir, maxBuffer: 25 \* 1024 \* 1024 }  
    );

    const entries: RepoFileEntry\[\] \= \[\];  
    for (const line of stdout.split('\\n')) {  
      if (\!line.trim()) continue;  
      // Format: "\<mode\> \<type\> \<object\> \<size\>\\t\<file\>"  
      const \[meta, filePath\] \= line.split('\\t');  
      const parts \= meta.trim().split(/\\s+/);  
      const type \= parts\[1\];  
      const sizeBytes \= parseInt(parts\[3\], 10);  
      if (type \=== 'blob' && filePath && \!Number.isNaN(sizeBytes)) {  
        entries.push({ filePath, sizeBytes });  
      }  
    }  
    return entries;  
  }

  /\*\*  
   \* Computes changed files between two commits (\`git diff \--name-status\`).  
   \* If oldSha is null (initial sync), treats all files in newSha as Added ('A').  
   \*/  
  public async getCommitDelta(  
    projectId: string,  
    oldSha: string \| null,  
    newSha: string  
  ): Promise\<FileDelta\[\]\> {  
    if (\!oldSha) {  
      const allFiles \= await this.listRepoFiles(projectId, newSha);  
      return allFiles.map((f) \=\> ({ status: 'A', filePath: f.filePath }));  
    }  
    if (oldSha \=== newSha) return \[\];

    const repoDir \= this.getRepoDir(projectId);  
    try {  
      const { stdout } \= await execFileAsync(  
        'git',  
        \['diff', '--name-status', '--no-renames', oldSha, newSha\],  
        { cwd: repoDir, maxBuffer: 25 \* 1024 \* 1024 }  
      );

      const deltas: FileDelta\[\] \= \[\];  
      for (const line of stdout.split('\\n')) {  
        if (\!line.trim()) continue;  
        const \[rawStatus, filePath\] \= line.split('\\t');  
        const statusChar \= rawStatus.trim()\[0\] as 'A' \| 'M' \| 'D';  
        if (\['A', 'M', 'D'\].includes(statusChar) && filePath) {  
          deltas.push({ status: statusChar, filePath });  
        }  
      }  
      return deltas;  
    } catch {  
      // Fallback if shallow history was force-pushed past depth window  
      const allFiles \= await this.listRepoFiles(projectId, newSha);  
      return allFiles.map((f) \=\> ({ status: 'M', filePath: f.filePath }));  
    }  
  }

  /\*\*  
   \* Reads a file blob directly from the bare repository into memory.  
   \*/  
  public async readFileBlob(  
    projectId: string,  
    commitSha: string,  
    filePath: string  
  ): Promise\<string\> {  
    const repoDir \= this.getRepoDir(projectId);  
    const { stdout } \= await execFileAsync(  
      'git',  
      \['cat-file', 'blob', \`\${commitSha}:\${filePath}\`\],  
      { cwd: repoDir, maxBuffer: 10 \* 1024 \* 1024 }  
    );  
    return stdout;  
  }  
}

## **4\. Semantic Chunker & Gemini Embedding Pipeline (geminiRagService.ts)**

Chunks text files while preserving line-number boundaries (startLine, endLine) so the Viewer UI can highlight exact sections when a user clicks a RAG citation. Uses the official @google/genai SDK.

TypeScript  
// src/services/geminiRagService.ts  
import { GoogleGenAI } from '@google/genai';

export interface DocumentChunk {  
  filePath: string;  
  chunkIndex: number;  
  startLine: number;  
  endLine: number;  
  content: string;  
}

const INDEXABLE\_EXTENSIONS \= new Set(\[  
  '.md', '.mdx', '.txt', '.yaml', '.yml', '.json',  
  '.mmd', '.mermaid', '.ts', '.tsx', '.js', '.py', '.go', '.sql', '.html'  
\]);

export function isIndexableFile(filePath: string): boolean {  
  const dotIdx \= filePath.lastIndexOf('.');  
  if (dotIdx \=== \-1) return false;  
  return INDEXABLE\_EXTENSIONS.has(filePath.slice(dotIdx).toLowerCase());  
}

/\*\*  
 \* Splits a file into overlapping line-aware chunks (\~1200 chars per chunk, 15 lines overlap)  
 \*/  
export function chunkFileContent(filePath: string, rawText: string): DocumentChunk\[\] {  
  const lines \= rawText.split(/\\r?\\n/);  
  const chunks: DocumentChunk\[\] \= \[\];

  const MAX\_CHARS \= 1200;  
  const OVERLAP\_LINES \= 10;

  let startLine \= 1;  
  let currentLines: string\[\] \= \[\];  
  let currentCharCount \= 0;  
  let chunkIndex \= 0;

  for (let i \= 0; i \< lines.length; i++) {  
    const line \= lines\[i\];  
    currentLines.push(line);  
    currentCharCount \+= line.length \+ 1;

    // Trigger split on markdown heading boundary or character budget  
    const isHeadingBreak \= /^\#{1,3}\\s/.test(line) && currentCharCount \> 400;  
    if (currentCharCount \>= MAX\_CHARS \|\| isHeadingBreak \|\| i \=== lines.length \- 1) {  
      const endLine \= startLine \+ currentLines.length \- 1;  
      chunks.push({  
        filePath,  
        chunkIndex: chunkIndex++,  
        startLine,  
        endLine,  
        content: \`File: \${filePath} (Lines \${startLine}-\${endLine})\\n---\\n\${currentLines.join('\\n')}\`,  
      });

      if (i \< lines.length \- 1) {  
        const overlap \= currentLines.slice(-OVERLAP\_LINES);  
        currentLines \= \[...overlap\];  
        currentCharCount \= overlap.reduce((acc, l) \=\> acc \+ l.length \+ 1, 0);  
        startLine \= endLine \- overlap.length \+ 1;  
      }  
    }  
  }

  return chunks;  
}

export class GeminiRagService {  
  /\*\*  
   \* Generates 768-dimensional embeddings in batches using Publisher's Gemini API key  
   \*/  
  public async embedChunks(  
    decryptedGeminiKey: string,  
    texts: string\[\]  
  ): Promise\<Float32Array\[\]\> {  
    const ai \= new GoogleGenAI({ apiKey: decryptedGeminiKey });  
    const BATCH\_SIZE \= 50;  
    const vectors: Float32Array\[\] \= \[\];

    for (let i \= 0; i \< texts.length; i \+= BATCH\_SIZE) {  
      const batch \= texts.slice(i, i \+ BATCH\_SIZE);  
      const response \= await ai.models.embedContent({  
        model: 'text-embedding-004',  
        contents: batch,  
        config: { outputDimensionality: 768 },  
      });

      for (const emb of response.embeddings ?? \[\]) {  
        vectors.push(new Float32Array(emb.values ?? \[\]));  
      }  
    }  
    return vectors;  
  }

  /\*\*  
   \* Streams grounded RAG answers strictly from ACL-authorized chunks  
   \*/  
  public async \*streamGroundedAnswer(  
    decryptedGeminiKey: string,  
    userQuestion: string,  
    retrievedChunks: { filePath: string; startLine: number; endLine: number; content: string }\[\]  
  ): AsyncGenerator\<string\> {  
    const ai \= new GoogleGenAI({ apiKey: decryptedGeminiKey });

    const contextBlock \= retrievedChunks  
      .map(  
        (c, idx) \=\>  
          \`\[Source \${idx \+ 1}\] \[\${c.filePath}\#L\${c.startLine}-L\${c.endLine}\]\\n\${c.content}\`  
      )  
      .join('\\n\\n====================\\n\\n');

    const systemInstruction \= \[  
      'You are a technical repository assistant.',  
      'Answer strictly using the provided repository context blocks.',  
      'If the answer is not in the context, state clearly that the information is not available in the accessible project files.',  
      'Always cite sources inline using exact bracket notation like \[docs/arch/overview.md\#L12-L40\].',  
    \].join(' ');

    const responseStream \= await ai.models.generateContentStream({  
      model: 'gemini-2.5-flash',  
      contents: \`Context:\\n\${contextBlock}\\n\\nQuestion: \${userQuestion}\`,  
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

## **5\. Delta Sync & ACL-Scoped Vector Orchestrator (syncWorker.ts)**

Coordinates the Git delta sync, deletes stale vectors for modified/deleted files, embeds only changed files, and executes the **ACL-Filtered KNN Vector Search** at query time.

TypeScript  
// src/workers/syncWorker.ts  
import Database from 'better-sqlite3';  
import \* as sqliteVec from 'sqlite-vec';  
import { BareGitManager } from '../services/gitManager.js';  
import {  
  GeminiRagService,  
  chunkFileContent,  
  isIndexableFile,  
} from '../services/geminiRagService.js';  
import { decryptSecret } from '../utils/crypto.js';  
import {  
  GroupAclRule,  
  resolveAuthorizedFiles,  
} from '../services/aclMatcher.js';

export class ProjectSyncAndRagOrchestrator {  
  private db: Database.Database;

  constructor(  
    sqlitePath: string,  
    private readonly gitManager: BareGitManager,  
    private readonly geminiService: GeminiRagService  
  ) {  
    this.db \= new Database(sqlitePath);  
    sqliteVec.load(this.db);  
    this.initSchema();  
  }

  private initSchema(): void {  
    this.db.exec(\`  
      CREATE TABLE IF NOT EXISTS projects (  
        id TEXT PRIMARY KEY,  
        repo\_url TEXT NOT NULL,  
        branch TEXT NOT NULL DEFAULT 'main',  
        encrypted\_github\_pat TEXT,  
        encrypted\_gemini\_key TEXT,  
        last\_synced\_sha TEXT  
      );

      CREATE TABLE IF NOT EXISTS doc\_chunks (  
        id INTEGER PRIMARY KEY AUTOINCREMENT,  
        project\_id TEXT NOT NULL,  
        file\_path TEXT NOT NULL,  
        start\_line INTEGER NOT NULL,  
        end\_line INTEGER NOT NULL,  
        content TEXT NOT NULL  
      );

      CREATE INDEX IF NOT EXISTS idx\_chunks\_proj\_path  
        ON doc\_chunks(project\_id, file\_path);

      CREATE VIRTUAL TABLE IF NOT EXISTS vec\_chunks USING vec0(  
        chunk\_id INTEGER PRIMARY KEY,  
        embedding float\[768\]  
      );  
    \`);  
  }

  /\*\*  
   \* Executes incremental Git sync \+ delta Gemini vector indexing  
   \*/  
  public async syncProject(projectId: string): Promise\<{  
    oldSha: string \| null;  
    newSha: string;  
    indexedFiles: number;  
  }\> {  
    const project \= this.db  
      .prepare(\`SELECT \* FROM projects WHERE id \= ?\`)  
      .get(projectId) as any;  
    if (\!project) throw new Error(\`Project \${projectId} not found\`);

    const githubPat \= project.encrypted\_github\_pat  
      ? decryptSecret(project.encrypted\_github\_pat)  
      : undefined;  
    const geminiKey \= project.encrypted\_gemini\_key  
      ? decryptSecret(project.encrypted\_gemini\_key)  
      : undefined;

    // 1\. Fetch bare repository and resolve HEAD SHA  
    const newSha \= await this.gitManager.syncBareRepo(  
      projectId,  
      project.repo\_url,  
      project.branch,  
      githubPat  
    );

    if (project.last\_synced\_sha \=== newSha) {  
      return { oldSha: project.last\_synced\_sha, newSha, indexedFiles: 0 };  
    }

    // 2\. Compute file delta between last\_synced\_sha and newSha  
    const deltas \= await this.gitManager.getCommitDelta(  
      projectId,  
      project.last\_synced\_sha,  
      newSha  
    );

    // 3\. If Publisher provided a Gemini API key, incrementally update embeddings  
    let indexedFiles \= 0;  
    if (geminiKey && deltas.length \> 0) {  
      const pathsToRemove \= deltas.map((d) \=\> d.filePath);

      // Delete old chunks and vectors for Modified ('M') and Deleted ('D') files  
      const deleteTx \= this.db.transaction((paths: string\[\]) \=\> {  
        const selectIds \= this.db.prepare(  
          \`SELECT id FROM doc\_chunks WHERE project\_id \= ? AND file\_path \= ?\`  
        );  
        const delVec \= this.db.prepare(\`DELETE FROM vec\_chunks WHERE chunk\_id \= ?\`);  
        const delChunk \= this.db.prepare(\`DELETE FROM doc\_chunks WHERE id \= ?\`);

        for (const p of paths) {  
          const rows \= selectIds.all(projectId, p) as { id: number }\[\];  
          for (const r of rows) {  
            delVec.run(r.id);  
            delChunk.run(r.id);  
          }  
        }  
      });  
      deleteTx(pathsToRemove);

      // Chunk and embed Added ('A') and Modified ('M') files  
      const upsertTargets \= deltas.filter(  
        (d) \=\> (d.status \=== 'A' \|\| d.status \=== 'M') && isIndexableFile(d.filePath)  
      );

      const insertChunk \= this.db.prepare(\`  
        INSERT INTO doc\_chunks (project\_id, file\_path, start\_line, end\_line, content)  
        VALUES (?, ?, ?, ?, ?)  
      \`);  
      const insertVec \= this.db.prepare(\`  
        INSERT INTO vec\_chunks (chunk\_id, embedding) VALUES (?, ?)  
      \`);

      for (const item of upsertTargets) {  
        const rawText \= await this.gitManager.readFileBlob(  
          projectId,  
          newSha,  
          item.filePath  
        );  
        const chunks \= chunkFileContent(item.filePath, rawText);  
        if (chunks.length \=== 0) continue;

        const embeddings \= await this.geminiService.embedChunks(  
          geminiKey,  
          chunks.map((c) \=\> c.content)  
        );

        const insertFileTx \= this.db.transaction(() \=\> {  
          for (let i \= 0; i \< chunks.length; i++) {  
            const c \= chunks\[i\];  
            const info \= insertChunk.run(  
              projectId,  
              c.filePath,  
              c.startLine,  
              c.endLine,  
              c.content  
            );  
            insertVec.run(  
              BigInt(info.lastInsertRowid),  
              new Uint8Array(embeddings\[i\].buffer)  
            );  
          }  
        });  
        insertFileTx();  
        indexedFiles++;  
      }  
    }

    // 4\. Commit new sync watermark  
    this.db  
      .prepare(\`UPDATE projects SET last\_synced\_sha \= ? WHERE id \= ?\`)  
      .run(newSha, projectId);

    return { oldSha: project.last\_synced\_sha, newSha, indexedFiles };  
  }

  /\*\*  
   \* Executes ACL-Filtered Vector Retrieval:  
   \* Only chunks belonging to files permitted by the viewer's ACL groups can be retrieved.  
   \*/  
  public async retrieveAuthorizedContext(  
    projectId: string,  
    userGroupRules: GroupAclRule\[\],  
    userQuestion: string,  
    topK \= 6  
  ) {  
    const project \= this.db  
      .prepare(\`SELECT \* FROM projects WHERE id \= ?\`)  
      .get(projectId) as any;  
    if (\!project?.encrypted\_gemini\_key \|\| \!project?.last\_synced\_sha) {  
      throw new Error('RAG assistant is not configured for this project.');  
    }

    // 1\. Resolve exact authorized file list for this viewer's groups  
    const allRepoFiles \= await this.gitManager.listRepoFiles(  
      projectId,  
      project.last\_synced\_sha  
    );  
    const authorizedPaths \= resolveAuthorizedFiles(allRepoFiles, userGroupRules);  
    if (authorizedPaths.length \=== 0) return \[\];

    // 2\. Embed user query using Publisher's Gemini API key  
    const geminiKey \= decryptSecret(project.encrypted\_gemini\_key);  
    const \[queryVector\] \= await this.geminiService.embedChunks(geminiKey, \[  
      userQuestion,  
    \]);

    // 3\. Query sqlite-vec joined strictly against authorized file paths  
    const placeholders \= authorizedPaths.map(() \=\> '?').join(',');  
    const sql \= \`  
      SELECT  
        c.file\_path AS filePath,  
        c.start\_line AS startLine,  
        c.end\_line AS endLine,  
        c.content AS content,  
        vec\_distance\_cosine(v.embedding, ?) AS distance  
      FROM vec\_chunks v  
      JOIN doc\_chunks c ON c.id \= v.chunk\_id  
      WHERE c.project\_id \= ?  
        AND c.file\_path IN (\${placeholders})  
      ORDER BY distance ASC  
      LIMIT ?  
    \`;

    return this.db  
      .prepare(sql)  
      .all(  
        new Uint8Array(queryVector.buffer),  
        projectId,  
        ...authorizedPaths,  
        topK  
      ) as {  
      filePath: string;  
      startLine: number;  
      endLine: number;  
      content: string;  
      distance: number;  
    }\[\];  
  }  
}  
