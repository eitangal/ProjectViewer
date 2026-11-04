import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  generateVerificationChallenge,
  safeCompareHex,
  sha256Hex,
  signSessionJwt,
} from './tokenService.js';
import { MailDispatcher } from './mailer.js';
import { GlobalRole } from '@/shared/types.js';

export interface VerifyResult {
  jwt: string;
  user: {
    id: string;
    email: string;
    globalRole: GlobalRole;
  };
  redirectProjectId: string | null;
}

export class AuthService {
  private readonly CHALLENGE_TTL_MS = 15 * 60 * 1000; // 15 minutes
  private readonly MAX_OTP_ATTEMPTS = 5;

  constructor(
    private readonly db: Database.Database,
    private readonly mailer: MailDispatcher,
    private readonly portalBaseUrl: string = 'http://localhost:5173'
  ) {}

  /**
   * Seeds the root SysAdmin account on server startup if not already seeded
   */
  public bootstrapSysAdmin(sysAdminEmail: string): void {
    const email = sysAdminEmail.trim().toLowerCase();
    this.db
      .prepare(`
        INSERT INTO users (id, email, global_role, status, max_repos, max_disk_quota_bytes, max_viewers, created_at)
        VALUES (?, ?, 'SYSADMIN', 'ACTIVE', 9999, 107374182400, 99999, ?)
        ON CONFLICT(email) DO UPDATE SET global_role = 'SYSADMIN', status = 'ACTIVE'
      `)
      .run(randomUUID(), email, Date.now());
  }

  /**
   * SysAdmin Action: Invite a new or existing user to become a Project Publisher
   */
  public async invitePublisher(
    sysAdminUserId: string,
    targetEmail: string,
    quotas?: { maxRepos?: number; maxDiskQuotaBytes?: number; maxViewers?: number }
  ): Promise<string> {
    const email = targetEmail.trim().toLowerCase();
    const existing = this.db.prepare(`SELECT id, global_role FROM users WHERE email = ?`).get(email) as any;
    let userId = existing?.id;

    if (!existing) {
      userId = randomUUID();
      this.db
        .prepare(`
          INSERT INTO users (id, email, global_role, status, max_repos, max_disk_quota_bytes, max_viewers, created_at)
          VALUES (?, ?, 'PUBLISHER', 'INVITED', ?, ?, ?, ?)
        `)
        .run(
          userId,
          email,
          quotas?.maxRepos ?? 5,
          quotas?.maxDiskQuotaBytes ?? 524288000,
          quotas?.maxViewers ?? 50,
          Date.now()
        );
    } else if (existing.global_role !== 'SYSADMIN') {
      this.db
        .prepare(`
          UPDATE users SET
            global_role = 'PUBLISHER',
            max_repos = COALESCE(?, max_repos),
            max_disk_quota_bytes = COALESCE(?, max_disk_quota_bytes),
            max_viewers = COALESCE(?, max_viewers)
          WHERE id = ?
        `)
        .run(
          quotas?.maxRepos ?? null,
          quotas?.maxDiskQuotaBytes ?? null,
          quotas?.maxViewers ?? null,
          userId
        );
    }

    await this.issueChallengeAndSendEmail(
      email,
      'INVITE_PUBLISHER',
      null,
      'You have been invited as a Project Publisher'
    );

    return userId;
  }

  /**
   * Publisher Action: Invite a Viewer to specific Viewer Groups on a Project
   */
  public async inviteViewerToGroups(params: {
    publisherUserId: string;
    projectId: string;
    viewerEmail: string;
    groupIds: string[];
  }): Promise<void> {
    const email = params.viewerEmail.trim().toLowerCase();

    // Verify Publisher owns this project (or caller is SysAdmin)
    const project = this.db
      .prepare(`SELECT id, name, owner_id FROM projects WHERE id = ?`)
      .get(params.projectId) as { id: string; name: string; owner_id: string } | undefined;

    if (!project) {
      throw new Error('Project not found');
    }

    const caller = this.db
      .prepare(`SELECT global_role, max_viewers FROM users WHERE id = ?`)
      .get(params.publisherUserId) as { global_role: GlobalRole; max_viewers: number } | undefined;

    const isOwner = project.owner_id === params.publisherUserId || caller?.global_role === 'SYSADMIN';
    if (!isOwner) {
      throw new Error('Unauthorized: You do not own this project.');
    }

    // Check project viewer count against publisher limit
    if (caller?.global_role !== 'SYSADMIN') {
      const viewerCountRow = this.db
        .prepare(`
          SELECT COUNT(DISTINCT user_id) as count
          FROM user_group_memberships
          WHERE project_id = ?
        `)
        .get(params.projectId) as { count: number };

      if (viewerCountRow.count >= (caller?.max_viewers ?? 50)) {
        throw new Error(`Viewer quota reached (max ${caller?.max_viewers ?? 50} viewers per publisher).`);
      }
    }

    const tx = this.db.transaction(() => {
      // Upsert Viewer user record
      this.db
        .prepare(`
          INSERT INTO users (id, email, global_role, status, created_at)
          VALUES (?, ?, 'VIEWER', 'INVITED', ?)
          ON CONFLICT(email) DO NOTHING
        `)
        .run(randomUUID(), email, Date.now());

      const user = this.db
        .prepare(`SELECT id FROM users WHERE email = ?`)
        .get(email) as { id: string };

      const insertMembership = this.db.prepare(`
        INSERT OR IGNORE INTO user_group_memberships
          (user_id, project_id, group_id, invited_by, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const groupId of params.groupIds) {
        insertMembership.run(
          user.id,
          params.projectId,
          groupId,
          params.publisherUserId,
          Date.now()
        );
      }
    });

    tx();

    await this.issueChallengeAndSendEmail(
      email,
      'INVITE_VIEWER',
      params.projectId,
      `You have been invited to view project "${project.name}"`
    );
  }

  /**
   * Publisher Action: Bulk invite viewers
   */
  public async bulkInviteViewers(params: {
    publisherUserId: string;
    projectId: string;
    entries: { email: string; groupIds: string[] }[];
  }): Promise<{ invited: number; errors: { email: string; error: string }[] }> {
    let invited = 0;
    const errors: { email: string; error: string }[] = [];

    for (const item of params.entries) {
      try {
        await this.inviteViewerToGroups({
          publisherUserId: params.publisherUserId,
          projectId: params.projectId,
          viewerEmail: item.email,
          groupIds: item.groupIds,
        });
        invited++;
      } catch (err: any) {
        errors.push({ email: item.email, error: err.message || 'Invitation failed' });
      }
    }

    return { invited, errors };
  }

  /**
   * Any Invited User: Request a fresh OTP / Magic Link to sign in
   */
  public async requestLoginChallenge(
    rawEmail: string
  ): Promise<{ magicToken: string; otpCode: string } | undefined> {
    const email = rawEmail.trim().toLowerCase();
    const user = this.db
      .prepare(`SELECT id, status FROM users WHERE email = ?`)
      .get(email) as { id: string; status: string } | undefined;

    // Silent return if email is not registered/invited (prevents user enumeration)
    if (!user || user.status === 'SUSPENDED') return;

    return await this.issueChallengeAndSendEmail(
      email,
      'LOGIN',
      null,
      'Your sign-in verification code'
    );
  }

  /**
   * Verifies either a Magic Link token OR (email + 6-digit OTP) and returns a signed JWT
   */
  public async verifyChallenge(
    input: { magicToken: string } | { email: string; otpCode: string }
  ): Promise<VerifyResult> {
    const now = Date.now();
    let challenge: any;

    if ('magicToken' in input && input.magicToken) {
      const tokenHash = sha256Hex(input.magicToken);
      challenge = this.db
        .prepare(`
          SELECT * FROM auth_challenges
          WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?
        `)
        .get(tokenHash, now);

      if (!challenge) throw new Error('Invalid or expired magic link.');
    } else if ('email' in input && 'otpCode' in input) {
      const email = input.email.trim().toLowerCase();
      challenge = this.db
        .prepare(`
          SELECT * FROM auth_challenges
          WHERE email = ? AND consumed_at IS NULL AND expires_at > ?
          ORDER BY expires_at DESC LIMIT 1
        `)
        .get(email, now);

      if (!challenge || challenge.attempts >= this.MAX_OTP_ATTEMPTS) {
        throw new Error('Verification code expired or maximum attempts exceeded.');
      }

      const expectedOtpHash = sha256Hex(`${email}:${input.otpCode.trim()}`);
      if (!safeCompareHex(challenge.otp_hash, expectedOtpHash)) {
        this.db
          .prepare(`UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = ?`)
          .run(challenge.id);
        throw new Error('Incorrect verification code.');
      }
    } else {
      throw new Error('Missing verification credentials.');
    }

    // Atomically consume challenge and mark user as ACTIVE
    const user = this.db.transaction(() => {
      this.db
        .prepare(`UPDATE auth_challenges SET consumed_at = ? WHERE id = ?`)
        .run(now, challenge.id);

      this.db
        .prepare(`
          UPDATE users
          SET status = CASE WHEN status = 'INVITED' THEN 'ACTIVE' ELSE status END,
              last_login_at = ?
          WHERE email = ?
        `)
        .run(now, challenge.email);

      return this.db
        .prepare(`SELECT id, email, global_role, status FROM users WHERE email = ?`)
        .get(challenge.email) as {
        id: string;
        email: string;
        global_role: GlobalRole;
        status: string;
      };
    })();

    if (!user || user.status === 'SUSPENDED') {
      throw new Error('Account is suspended.');
    }

    const jwt = await signSessionJwt({
      sub: user.id,
      email: user.email,
      role: user.global_role,
    });

    return {
      jwt,
      user: {
        id: user.id,
        email: user.email,
        globalRole: user.global_role,
      },
      redirectProjectId: challenge.project_id ?? null,
    };
  }

  private async issueChallengeAndSendEmail(
    email: string,
    purpose: string,
    projectId: string | null,
    subject: string
  ): Promise<{ magicToken: string; otpCode: string }> {
    const { rawMagicToken, rawOtp, tokenHash, otpHash } =
      generateVerificationChallenge(email);

    this.db
      .prepare(`
        INSERT INTO auth_challenges
          (id, email, token_hash, otp_hash, purpose, project_id, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        randomUUID(),
        email,
        tokenHash,
        otpHash,
        purpose,
        projectId,
        Date.now() + this.CHALLENGE_TTL_MS
      );

    const magicLinkUrl = `${this.portalBaseUrl}/auth/verify?token=${encodeURIComponent(
      rawMagicToken
    )}`;

    await this.mailer.sendAuthEmail({
      to: email,
      subject,
      magicLinkUrl,
      otpCode: rawOtp,
      contextLabel: subject,
    });

    return { magicToken: rawMagicToken, otpCode: rawOtp };
  }
}
