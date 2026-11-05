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

  it('bootstraps root SysAdmin account (single or multiple comma-separated)', () => {
    authService.bootstrapSysAdmin('admin@gitlens-portal.local, eitanga@gmail.com');
    const user1 = db.prepare('SELECT * FROM users WHERE email = ?').get('admin@gitlens-portal.local') as any;
    expect(user1).toBeDefined();
    expect(user1.global_role).toBe('SYSADMIN');
    expect(user1.status).toBe('ACTIVE');

    const user2 = db.prepare('SELECT * FROM users WHERE email = ?').get('eitanga@gmail.com') as any;
    expect(user2).toBeDefined();
    expect(user2.global_role).toBe('SYSADMIN');
    expect(user2.status).toBe('ACTIVE');
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

  it('allows invited publisher to verify using original invite code even after requesting a fresh login code', async () => {
    authService.bootstrapSysAdmin('admin@gitlens-portal.local');
    const admin = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@gitlens-portal.local') as any;

    const publisherEmail = 'freshpub@startup.io';
    const inviteRes = await authService.invitePublisher(admin.id, publisherEmail);
    const inviteOtp = inviteRes.otpCode;

    // Simulate publisher visiting the login page and clicking "Send Verification Code",
    // which issues a secondary login challenge
    const loginChallenge = await authService.requestLoginChallenge(publisherEmail);
    expect(loginChallenge).toBeDefined();
    expect(loginChallenge?.otpCode).not.toBe(inviteOtp);

    // Publisher enters the code from their original invitation email
    const result = await authService.verifyChallenge({
      email: `  ${publisherEmail.toUpperCase()}  `,
      otpCode: inviteOtp,
    });

    expect(result.jwt).toBeTypeOf('string');
    expect(result.user.globalRole).toBe('PUBLISHER');

    // Sibling pending challenges for this email should be retired
    const pendingChallenges = db
      .prepare('SELECT COUNT(*) as count FROM auth_challenges WHERE email = ? AND consumed_at IS NULL')
      .get(publisherEmail) as { count: number };
    expect(pendingChallenges.count).toBe(0);
  });

  it('allows invited publisher to verify beyond 15 minutes due to extended invitation TTL', async () => {
    authService.bootstrapSysAdmin('admin@gitlens-portal.local');
    const admin = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@gitlens-portal.local') as any;

    const publisherEmail = 'latepub@domain.com';
    const inviteRes = await authService.invitePublisher(admin.id, publisherEmail);

    // Simulate 30 minutes passing (older 15-minute TTL would have expired)
    const thirtyMinutesMs = 30 * 60 * 1000;
    const challengeRow = db
      .prepare('SELECT expires_at FROM auth_challenges WHERE email = ? ORDER BY expires_at DESC LIMIT 1')
      .get(publisherEmail) as { expires_at: number };

    // Ensure the expiration is set to 48 hours (~172,800,000 ms), well past 30 minutes
    const remainingMs = challengeRow.expires_at - Date.now();
    expect(remainingMs).toBeGreaterThan(24 * 60 * 60 * 1000);

    // Verifying now succeeds without expired error
    const result = await authService.verifyChallenge({
      email: publisherEmail,
      otpCode: inviteRes.otpCode,
    });

    expect(result.user.globalRole).toBe('PUBLISHER');
  });

  it('allows user to sign in with 6-digit OTP code even if magic link was already consumed by an automated scanner', async () => {
    authService.bootstrapSysAdmin('admin@gitlens-portal.local');
    const admin = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@gitlens-portal.local') as any;
    const email = 'eitan@s-strategy.com';
    await authService.invitePublisher(admin.id, email);

    const challenge = await authService.requestLoginChallenge(email);
    expect(challenge).toBeDefined();

    // 1. Simulate an automated email scanner (e.g. Defender SafeLinks) consuming the magic link
    const magicVerifyRes = await authService.verifyChallenge({
      magicToken: challenge!.magicToken,
    });
    expect(magicVerifyRes.jwt).toBeTypeOf('string');

    // Verify token_consumed_at is recorded
    const row = db
      .prepare('SELECT token_consumed_at, otp_consumed_at FROM auth_challenges WHERE email = ? ORDER BY expires_at DESC LIMIT 1')
      .get(email) as any;
    expect(row.token_consumed_at).toBeGreaterThan(0);

    // 2. The human user opens the email and enters the 6-digit OTP code in the web interface
    // OTP verification MUST succeed because the human entered the genuine OTP delivered to their inbox!
    const otpVerifyRes = await authService.verifyChallenge({
      email,
      otpCode: challenge!.otpCode,
    });

    expect(otpVerifyRes.user.email).toBe(email);
    expect(otpVerifyRes.jwt).toBeTypeOf('string');

    // 3. Verifying the same OTP code again is rejected because otp_consumed_at is now set
    await expect(
      authService.verifyChallenge({
        email,
        otpCode: challenge!.otpCode,
      })
    ).rejects.toThrow(/already been used/i);
  });
});
