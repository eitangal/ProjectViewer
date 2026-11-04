import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { encryptSecret, decryptSecret, verifyGithubWebhookSignature } from '../src/backend/utils/crypto.js';
import {
  generateVerificationChallenge,
  sha256Hex,
  safeCompareHex,
  signSessionJwt,
  verifySessionJwt,
} from '../src/backend/auth/tokenService.js';
import { AuthService } from '../src/backend/auth/authService.js';
import { PortalMailer } from '../src/backend/auth/mailer.js';
import { createDatabase } from '../src/backend/db/schema.js';

describe('1. Key Encryption & Security Utility (crypto.ts)', () => {
  it('encrypts and decrypts secrets with AES-256-GCM', () => {
    const original = 'AIzaSyDemoGoogleGeminiApiKey123456789';
    const encrypted = encryptSecret(original);

    expect(encrypted).not.toBe(original);
    expect(encrypted.split(':')).toHaveLength(3); // iv:tag:data

    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(original);
  });

  it('fails decryption if cipher payload is tampered', () => {
    const original = 'ghp_SampleGitHubPersonalAccessToken';
    const encrypted = encryptSecret(original);
    const [iv, tag, data] = encrypted.split(':');

    // Tamper with data
    const tamperedData = (data[0] === 'a' ? 'b' : 'a') + data.slice(1);
    const tamperedPayload = `${iv}:${tag}:${tamperedData}`;

    expect(() => decryptSecret(tamperedPayload)).toThrow();
  });

  it('verifies GitHub webhook signature using HMAC-SHA256', () => {
    const secret = 'webhook-secret-xyz';
    const payload = JSON.stringify({ ref: 'refs/heads/main', after: 'abc123' });
    const { createHmac } = require('node:crypto');
    const validSig = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');

    expect(verifyGithubWebhookSignature(payload, validSig, secret)).toBe(true);
    expect(verifyGithubWebhookSignature(payload, 'sha256=invalidhash', secret)).toBe(false);
    expect(verifyGithubWebhookSignature(payload, undefined, secret)).toBe(false);
  });
});

describe('2. Dual-Mode Token & JWT Service (tokenService.ts)', () => {
  it('generates high-entropy magic token and 6-digit OTP', () => {
    const email = 'user@example.com';
    const challenge = generateVerificationChallenge(email);

    expect(challenge.rawMagicToken).toBeTypeOf('string');
    expect(challenge.rawMagicToken.length).toBeGreaterThanOrEqual(32);
    expect(challenge.rawOtp).toMatch(/^\d{6}$/);
    expect(challenge.tokenHash).toHaveLength(64);
    expect(challenge.otpHash).toHaveLength(64);
  });

  it('signs and verifies session JWT with EdDSA/HS256', async () => {
    const payload = {
      sub: 'user-123',
      email: 'viewer@client.com',
      role: 'VIEWER' as const,
    };

    const token = await signSessionJwt(payload);
    expect(token).toBeTypeOf('string');

    const verified = await verifySessionJwt(token);
    expect(verified.sub).toBe('user-123');
    expect(verified.email).toBe('viewer@client.com');
    expect(verified.role).toBe('VIEWER');
  });
});

describe('3. Passwordless Invitation & Verification Service (authService.ts)', () => {
  let db: Database.Database;
  let mailer: PortalMailer;
  let authService: AuthService;

  beforeEach(() => {
    db = createDatabase(':memory:');
    mailer = new PortalMailer(db);
    authService = new AuthService(db, mailer, 'http://localhost:5173');
  });

  it('bootstraps root SysAdmin account', () => {
    authService.bootstrapSysAdmin('admin@gitlens-portal.local');
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get('admin@gitlens-portal.local') as any;
    expect(user).toBeDefined();
    expect(user.global_role).toBe('SYSADMIN');
    expect(user.status).toBe('ACTIVE');
  });

  it('allows SysAdmin to invite a Publisher and verifies with OTP', async () => {
    authService.bootstrapSysAdmin('admin@gitlens-portal.local');
    const admin = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@gitlens-portal.local') as any;

    const publisherEmail = 'publisher@org.com';
    await authService.invitePublisher(admin.id, publisherEmail, { maxRepos: 10 });

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(publisherEmail) as any;
    expect(user.global_role).toBe('PUBLISHER');
    expect(user.status).toBe('INVITED');
    expect(user.max_repos).toBe(10);

    const sentMail = mailer.getLastSentEmail(publisherEmail);
    expect(sentMail).toBeDefined();
    expect(sentMail?.otpCode).toMatch(/^\d{6}$/);

    // Verify using OTP
    const verifyResult = await authService.verifyChallenge({
      email: publisherEmail,
      otpCode: sentMail!.otpCode,
    });

    expect(verifyResult.jwt).toBeTypeOf('string');
    expect(verifyResult.user.globalRole).toBe('PUBLISHER');

    // User status is now ACTIVE
    const updatedUser = db.prepare('SELECT * FROM users WHERE email = ?').get(publisherEmail) as any;
    expect(updatedUser.status).toBe('ACTIVE');
  });

  it('locks out after 5 consecutive incorrect OTP attempts', async () => {
    authService.bootstrapSysAdmin('admin@gitlens-portal.local');
    const admin = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@gitlens-portal.local') as any;

    const targetEmail = 'target@firm.com';
    await authService.invitePublisher(admin.id, targetEmail);

    // Fail 5 times
    for (let i = 0; i < 5; i++) {
      await expect(
        authService.verifyChallenge({ email: targetEmail, otpCode: '000000' })
      ).rejects.toThrow();
    }

    // Even with the correct OTP now, challenge must be rejected
    const sentMail = mailer.getLastSentEmail(targetEmail);
    await expect(
      authService.verifyChallenge({ email: targetEmail, otpCode: sentMail!.otpCode })
    ).rejects.toThrow(/expired or maximum attempts/i);
  });
});
