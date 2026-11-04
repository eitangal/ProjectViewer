import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createDatabase } from '../src/backend/db/schema.js';
import { PortalMailer, formatBrevoApiError, parseSender } from '../src/backend/auth/mailer.js';

describe('Brevo Transactional Email REST API Mailer (mailer.ts)', () => {
  let db: Database.Database;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    db = createDatabase(':memory:');
    delete process.env.BREVO_API_KEY;
    delete process.env.BREVO_SENDER_EMAIL;
    delete process.env.BREVO_SENDER_NAME;
    delete process.env.BREVO_FROM;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('reports isConfigured = false when no database setting and no environment variables exist', () => {
    const mailer = new PortalMailer(db);
    expect(mailer.isConfigured()).toBe(false);
    expect(mailer.getBrevoConfig()).toBeNull();
  });

  it('resolves Brevo configuration using BREVO_API_KEY environment variables', () => {
    process.env.BREVO_API_KEY = 'xkeysib-my-brevo-api-key-12345';
    process.env.BREVO_SENDER_EMAIL = 'noreply@mycompany.com';
    process.env.BREVO_SENDER_NAME = 'GitLens Platform';

    const mailer = new PortalMailer(db);
    expect(mailer.isConfigured()).toBe(true);
    const config = mailer.getBrevoConfig();
    expect(config).toEqual({
      apiKey: 'xkeysib-my-brevo-api-key-12345',
      senderEmail: 'noreply@mycompany.com',
      senderName: 'GitLens Platform',
    });
  });

  it('parses formatted sender strings into name and email', () => {
    const parsed = parseSender('Custom Brand <auth@brand.io>');
    expect(parsed.name).toBe('Custom Brand');
    expect(parsed.email).toBe('auth@brand.io');

    const simple = parseSender('direct@brand.io');
    expect(simple.name).toBe('GitLens Portal');
    expect(simple.email).toBe('direct@brand.io');
  });

  it('allows database configuration to take precedence over environment variables', () => {
    process.env.BREVO_API_KEY = 'xkeysib-env-key';
    process.env.BREVO_SENDER_EMAIL = 'env-sender@domain.com';

    const dbConfig = {
      apiKey: 'xkeysib-db-key',
      senderEmail: 'db-sender@domain.com',
      senderName: 'DB Portal',
    };

    db.prepare(`
      INSERT INTO system_settings (key, value_json, updated_at)
      VALUES ('brevo_config', ?, ?)
    `).run(JSON.stringify(dbConfig), Date.now());

    const mailer = new PortalMailer(db);
    const config = mailer.getBrevoConfig();
    expect(config).toEqual(dbConfig);
  });

  it('rejects test connection if an SMTP key (xsmtpsib-) is provided instead of an API key', async () => {
    const mailer = new PortalMailer(db);
    const res = await mailer.testBrevoConnection({
      apiKey: 'xsmtpsib-wrong-type-of-key',
      senderEmail: 'noreply@domain.com',
      senderName: 'GitLens',
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('xsmtpsib-');
    expect(res.error).toContain('xkeysib-');
  });

  it('formats Brevo sender validation errors clearly', () => {
    const formatted = formatBrevoApiError('sender is not valid. It should be a valid email and present in your senders list', 'unverified@test.com');
    expect(formatted).toContain('Brevo Error: The sender address');
    expect(formatted).toContain('unverified@test.com');
  });

  it('formats Brevo 401 unauthorized errors with API key guidance', () => {
    const formatted = formatBrevoApiError('Key not found');
    expect(formatted).toContain('Brevo Error: Unauthorized');
    expect(formatted).toContain('xkeysib-');
  });

  it('dispatches email via Brevo REST API endpoint when configured', async () => {
    process.env.BREVO_API_KEY = 'xkeysib-valid-test-key';
    process.env.BREVO_SENDER_EMAIL = 'auth@company.com';

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ messageId: '<20261104.test@smtp-relay.mailin.fr>' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const mailer = new PortalMailer(db);
    const res = await mailer.sendAuthEmail({
      to: 'recipient@client.com',
      subject: 'GitLens Login Challenge',
      magicLinkUrl: 'http://localhost/auth?token=abc',
      otpCode: '654321',
      contextLabel: 'Viewer Invitation',
    });

    expect(res.sent).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(options.method).toBe('POST');
    expect(options.headers['api-key']).toBe('xkeysib-valid-test-key');

    const body = JSON.parse(options.body);
    expect(body.to[0].email).toBe('recipient@client.com');
    expect(body.sender.email).toBe('auth@company.com');
    expect(body.subject).toBe('GitLens Login Challenge');

    const log = db.prepare(`SELECT * FROM email_delivery_logs WHERE recipient_email = ?`).get('recipient@client.com') as any;
    expect(log).toBeDefined();
    expect(log.status).toBe('SENT');
  });

  it('records delivery fallback to server console when API key is missing', async () => {
    const mailer = new PortalMailer(db);
    const res = await mailer.sendAuthEmail({
      to: 'dev@test.local',
      subject: 'Console Login',
      magicLinkUrl: 'http://localhost/auth?token=dev',
      otpCode: '112233',
      contextLabel: 'SysAdmin Login',
    });

    expect(res.sent).toBe(false);
    expect(res.error).toBeDefined();

    const log = db.prepare(`SELECT * FROM email_delivery_logs WHERE recipient_email = ?`).get('dev@test.local') as any;
    expect(log).toBeDefined();
    expect(log.status).toBe('NOT_CONFIGURED');
  });
});
