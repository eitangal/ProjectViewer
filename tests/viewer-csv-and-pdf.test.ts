import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FastifyInstance } from 'fastify';

import { buildApp } from '../src/backend/app.js';
import { BareGitManager } from '../src/backend/services/gitManager.js';
import {
  parseCsv,
  autoDetectDelimiter,
  compareCsvValues,
  exportToCsv,
  exportToJson,
} from '../src/frontend/utils/csvParser.js';
import { detectDocumentFormat } from '../src/frontend/utils/detectDocumentFormat.js';

const execFileAsync = promisify(execFile);

// Minimal valid PDF binary header & content
const SAMPLE_PDF_BUFFER = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000056 00000 n \n0000000111 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n162\n%%EOF\n',
  'utf8'
);

const SAMPLE_CSV_CONTENT = `id,name,role,salary,join_date
1,Alice,"Senior Engineer, Core",125000,2021-03-15
2,Bob,Product Manager,110000,2022-07-01
3,"Charlie ""The Rock""",DevOps,98000,2020-01-10
4,Diana,"Designer &
Illustrator",105000,2023-11-20
5,Evan,Intern,45000,
`;

describe('CSV Parser, Table Logic & Format Detection', () => {
  it('detectDocumentFormat identifies CSV, TSV, and PDF files correctly', () => {
    expect(detectDocumentFormat('data/analytics.csv')).toBe('csv');
    expect(detectDocumentFormat('exports/users.tsv')).toBe('csv');
    expect(detectDocumentFormat('reports/quarterly.pdf')).toBe('pdf');
    expect(detectDocumentFormat('CAPITAL.PDF')).toBe('pdf');
    expect(detectDocumentFormat('CAPITAL.CSV')).toBe('csv');
  });

  it('autoDetectDelimiter correctly identifies comma, semicolon, tab, and pipe', () => {
    expect(autoDetectDelimiter('id,name,age\n1,Alice,30')).toBe(',');
    expect(autoDetectDelimiter('id;name;age\n1;Bob;25')).toBe(';');
    expect(autoDetectDelimiter('id\tname\tage\n1\tCharlie\t28')).toBe('\t');
    expect(autoDetectDelimiter('id|name|age\n1|Diana|35')).toBe('|');
  });

  it('parseCsv parses standard RFC 4180 CSV with quotes, commas in quotes, and escaped quotes', () => {
    const rows = parseCsv(SAMPLE_CSV_CONTENT);

    expect(rows.length).toBe(6); // 1 header + 5 data rows
    expect(rows[0]).toEqual(['id', 'name', 'role', 'salary', 'join_date']);
    expect(rows[1]).toEqual(['1', 'Alice', 'Senior Engineer, Core', '125000', '2021-03-15']);
    expect(rows[2]).toEqual(['2', 'Bob', 'Product Manager', '110000', '2022-07-01']);
    expect(rows[3]).toEqual(['3', 'Charlie "The Rock"', 'DevOps', '98000', '2020-01-10']);
    expect(rows[4]).toEqual(['4', 'Diana', 'Designer &\nIllustrator', '105000', '2023-11-20']);
    expect(rows[5]).toEqual(['5', 'Evan', 'Intern', '45000', '']);
  });

  it('parseCsv handles TSV and semicolon delimited data seamlessly', () => {
    const tsvData = 'title\tcount\trate\nItem A\t100\t9.5\nItem B\t200\t8.2';
    const tsvRows = parseCsv(tsvData);
    expect(tsvRows.length).toBe(3);
    expect(tsvRows[0]).toEqual(['title', 'count', 'rate']);
    expect(tsvRows[1]).toEqual(['Item A', '100', '9.5']);

    const semiData = 'col1;col2;col3\nval1;val2;val3';
    const semiRows = parseCsv(semiData);
    expect(semiRows.length).toBe(2);
    expect(semiRows[0]).toEqual(['col1', 'col2', 'col3']);
    expect(semiRows[1]).toEqual(['val1', 'val2', 'val3']);
  });

  it('compareCsvValues sorts numbers numerically and handles empty values', () => {
    // Numeric sorting: 10 > 2
    expect(compareCsvValues('2', '10')).toBeLessThan(0);
    expect(compareCsvValues('10', '2')).toBeGreaterThan(0);
    expect(compareCsvValues('1,200', '300')).toBeGreaterThan(0);
    expect(compareCsvValues('-50', '20')).toBeLessThan(0);
    expect(compareCsvValues('10.5', '10.2')).toBeGreaterThan(0);

    // Empty values sort to the bottom
    expect(compareCsvValues('', 'any text')).toBeGreaterThan(0);
    expect(compareCsvValues('any text', '')).toBeLessThan(0);
    expect(compareCsvValues('', '')).toBe(0);

    // Text comparison
    expect(compareCsvValues('Alpha', 'Beta')).toBeLessThan(0);
    expect(compareCsvValues('beta', 'Alpha')).toBeGreaterThan(0);
  });

  it('exportToCsv and exportToJson serializes tabular data accurately', () => {
    const headers = ['id', 'name', 'notes'];
    const rows = [
      ['1', 'Alice', 'Engineer, Lead'],
      ['2', 'Bob "The Builder"', 'Contractor'],
    ];

    const csvOutput = exportToCsv(headers, rows);
    expect(csvOutput).toContain('id,name,notes');
    expect(csvOutput).toContain('1,Alice,"Engineer, Lead"');
    expect(csvOutput).toContain('2,"Bob ""The Builder""",Contractor');

    const jsonOutput = exportToJson(headers, rows);
    const parsed = JSON.parse(jsonOutput);
    expect(parsed.length).toBe(2);
    expect(parsed[0].name).toBe('Alice');
    expect(parsed[0].notes).toBe('Engineer, Lead');
    expect(parsed[1].name).toBe('Bob "The Builder"');
  });
});

describe('Backend PDF & CSV File Serving & MIME Handling', () => {
  let tempBaseDir: string;
  let sourceRepoDir: string;
  let reposDir: string;
  let dbPath: string;
  let db: any;
  let app: FastifyInstance;
  let gitManager: BareGitManager;
  let adminToken: string;
  let projectId: string;

  beforeEach(async () => {
    tempBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitlens-csv-pdf-test-'));
    sourceRepoDir = path.join(tempBaseDir, 'source-repo');
    reposDir = path.join(tempBaseDir, 'repos');
    dbPath = path.join(tempBaseDir, 'test.db');

    await fs.mkdir(sourceRepoDir, { recursive: true });
    await fs.mkdir(reposDir, { recursive: true });

    // Initialize Git repository with test CSV and PDF
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: sourceRepoDir });
    await execFileAsync('git', ['config', 'user.name', 'Test Author'], { cwd: sourceRepoDir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: sourceRepoDir });

    await fs.mkdir(path.join(sourceRepoDir, 'data'), { recursive: true });
    await fs.mkdir(path.join(sourceRepoDir, 'docs'), { recursive: true });

    await fs.writeFile(path.join(sourceRepoDir, 'data/records.csv'), SAMPLE_CSV_CONTENT, 'utf8');
    await fs.writeFile(path.join(sourceRepoDir, 'docs/specification.pdf'), SAMPLE_PDF_BUFFER);

    await execFileAsync('git', ['add', '.'], { cwd: sourceRepoDir });
    await execFileAsync('git', ['commit', '-m', 'Add CSV and PDF files'], { cwd: sourceRepoDir });

    const bundle = buildApp({
      dbPath,
      reposDir,
      bootstrapSysAdminEmail: 'root@gitlens-portal.local',
    });

    app = bundle.app;
    db = bundle.db;
    gitManager = bundle.gitManager;

    // Login SysAdmin to get auth token
    const mailer = (bundle.authService as any).mailer;
    await app.inject({
      method: 'POST',
      url: '/api/auth/request-code',
      payload: { email: 'root@gitlens-portal.local' },
    });

    const sentMail = mailer.getLastSentEmail('root@gitlens-portal.local');
    const authRes = await app.inject({
      method: 'POST',
      url: '/api/auth/verify',
      payload: { email: 'root@gitlens-portal.local', otpCode: sentMail!.otpCode },
    });
    adminToken = JSON.parse(authRes.payload).token;

    // Create a project pointing to sourceRepoDir
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'CsvPdfPortal',
        repoUrl: sourceRepoDir,
        branch: 'main',
        isLocalRepo: true,
        localSourcePath: sourceRepoDir,
      },
    });
    projectId = JSON.parse(createRes.payload).projectId;

    // Trigger initial sync
    await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/sync`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
  });

  afterEach(async () => {
    await app.close();
    try {
      await fs.rm(tempBaseDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('GET /api/viewer/:projectId/blob returns text content for CSV files', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/viewer/${projectId}/blob?path=data/records.csv`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.path).toBe('data/records.csv');
    expect(json.isBinary).toBe(false);
    expect(json.content).toContain('Alice');
    expect(json.content).toContain('Senior Engineer, Core');
  });

  it('GET /api/viewer/:projectId/raw/data/records.csv serves CSV with text/csv Content-Type', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/viewer/${projectId}/raw/data/records.csv`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.payload).toContain('Alice');
  });

  it('GET /api/viewer/:projectId/blob returns base64 data URI for PDF files', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/viewer/${projectId}/blob?path=docs/specification.pdf`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.path).toBe('docs/specification.pdf');
    expect(json.isBinary).toBe(true);
    expect(json.content).toMatch(/^data:application\/pdf;base64,/);

    const base64Data = json.content.replace(/^data:application\/pdf;base64,/, '');
    const decoded = Buffer.from(base64Data, 'base64');
    expect(decoded.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('GET /api/viewer/:projectId/raw/docs/specification.pdf serves PDF binary stream with application/pdf Content-Type', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/viewer/${projectId}/raw/docs/specification.pdf`,
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.rawPayload.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(res.rawPayload.length).toBe(SAMPLE_PDF_BUFFER.length);
  });
});
