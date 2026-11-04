This authentication and authorization subsystem implements strict invite-only, passwordless email verification across all three actors (**SysAdmin**, **Publisher**, and **Viewer**) using **Fastify**, jose (EdDSA/HS256 JWTs), native Node crypto for SHA-256 hashed Magic Links and 6-digit OTPs, and better-sqlite3.

## **1\. Identity, Invitations & ACL Membership Schema (authSchema.ts)**

Invite tokens and OTPs are never stored in plaintext—only their **SHA-256 hashes** are persisted. A single user email can hold multiple project memberships across different Viewer Groups, or act as a Publisher for their own projects.  
// src/auth/authSchema.ts  
import Database from 'better-sqlite3';

export function initAuthSchema(db: Database.Database): void {  
  db.exec(\`  
    \-- Core identity table (strictly invite-only)  
    CREATE TABLE IF NOT EXISTS users (  
      id TEXT PRIMARY KEY,  
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,  
      global\_role TEXT NOT NULL DEFAULT 'VIEWER', \-- 'SYSADMIN' \| 'PUBLISHER' \| 'VIEWER'  
      status TEXT NOT NULL DEFAULT 'INVITED',     \-- 'INVITED' \| 'ACTIVE' \| 'SUSPENDED'  
      created\_at INTEGER NOT NULL,  
      last\_login\_at INTEGER  
    );

    \-- Project-scoped Viewer Group definitions  
    CREATE TABLE IF NOT EXISTS viewer\_groups (  
      id TEXT PRIMARY KEY,  
      project\_id TEXT NOT NULL,  
      name TEXT NOT NULL,  
      allowed\_folders\_json TEXT NOT NULL,    \-- JSON string\[\]  
      allowed\_extensions\_json TEXT NOT NULL, \-- JSON string\[\]  
      exclude\_globs\_json TEXT NOT NULL,      \-- JSON string\[\]  
      max\_file\_size\_bytes INTEGER NOT NULL DEFAULT 2097152  
    );

    \-- Maps Viewers to specific Viewer Groups within a Project  
    CREATE TABLE IF NOT EXISTS user\_group\_memberships (  
      user\_id TEXT NOT NULL,  
      project\_id TEXT NOT NULL,  
      group\_id TEXT NOT NULL,  
      invited\_by TEXT NOT NULL,  
      created\_at INTEGER NOT NULL,  
      PRIMARY KEY (user\_id, project\_id, group\_id)  
    );

    \-- Ephemeral passwordless verification challenges (Magic Link \+ 6-digit OTP)  
    CREATE TABLE IF NOT EXISTS auth\_challenges (  
      id TEXT PRIMARY KEY,  
      email TEXT NOT NULL COLLATE NOCASE,  
      token\_hash TEXT NOT NULL UNIQUE, \-- SHA-256 of URL Magic Token  
      otp\_hash TEXT NOT NULL,          \-- SHA-256 of 6-digit code \+ email salt  
      purpose TEXT NOT NULL,           \-- 'INVITE\_PUBLISHER' \| 'INVITE\_VIEWER' \| 'LOGIN'  
      project\_id TEXT,                 \-- Nullable for global login / SysAdmin  
      expires\_at INTEGER NOT NULL,  
      attempts INTEGER NOT NULL DEFAULT 0,  
      consumed\_at INTEGER  
    );

    CREATE INDEX IF NOT EXISTS idx\_challenges\_email ON auth\_challenges(email);  
  \`);  
}

## **2\. Cryptographic Challenge & JWT Service (tokenService.ts)**

Generates dual-mode verification credentials (every email contains **both** a 1-click Magic Link and a 6-digit OTP code in case enterprise email scanners pre-fetch links), and issues short-lived HTTP-only session JWTs.  
// src/auth/tokenService.ts  
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';  
import { SignJWT, jwtVerify, JWTPayload } from 'jose';

const JWT\_SECRET \= new TextEncoder().encode(process.env.JWT\_SECRET\_KEY\!); // Min 32 bytes  
const ISSUER \= 'gitlens-portal';

export type GlobalRole \= 'SYSADMIN' \| 'PUBLISHER' \| 'VIEWER';

export interface SessionJwtPayload extends JWTPayload {  
  sub: string;       // user.id  
  email: string;     // user.email  
  role: GlobalRole;  // Highest global role  
}

export function sha256Hex(input: string): string {  
  return createHash('sha256').update(input).digest('hex');  
}

export function safeCompareHex(aHex: string, bHex: string): boolean {  
  const bufA \= Buffer.from(aHex, 'hex');  
  const bufB \= Buffer.from(bHex, 'hex');  
  if (bufA.length \!== bufB.length) return false;  
  return timingSafeEqual(bufA, bufB);  
}

/\*\*  
 \* Generates a paired URL Magic Token (256-bit entropy) and 6-digit OTP code.  
 \*/  
export function generateVerificationChallenge(email: string) {  
  const normalizedEmail \= email.trim().toLowerCase();  
  const rawMagicToken \= randomBytes(32).toString('base64url');  
  const rawOtp \= randomInt(100000, 999999).toString();

  return {  
    rawMagicToken,  
    rawOtp,  
    tokenHash: sha256Hex(rawMagicToken),  
    otpHash: sha256Hex(\`$normalizedEmail:${rawOtp}\`),  
  };  
}

export async function signSessionJwt(payload: SessionJwtPayload): Promise\<string\> {  
  return new SignJWT(payload)  
    .setProtectedHeader({ alg: 'HS256' })  
    .setIssuedAt()  
    .setIssuer(ISSUER)  
    .setExpirationTime('12h')  
    .sign(JWT\_SECRET);  
}

export async function verifySessionJwt(token: string): Promise\<SessionJwtPayload\> {  
  const { payload } \= await jwtVerify(token, JWT\_SECRET, { issuer: ISSUER });  
  return payload as SessionJwtPayload;  
}

## **3\. Invitation & OTP Verification Service (authService.ts)**

Enforces the strict invitation hierarchy:

> 1. **Bootstrap:** On first boot, the SYSADMIN\_BOOTSTRAP\_EMAIL environment variable seeds the initial SysAdmin.  
> 2. **SysAdmin \\rightarrow Publisher:** SysAdmin invites an email; user is upserted with global\_role \= 'PUBLISHER'.  
> 3. **Publisher \\rightarrow Viewer:** Publisher invites an email to one or more groupIds within a project they own; user is upserted and linked in user\_group\_memberships.  
> 4. **Subsequent Logins:** Only users already present in users (and not SUSPENDED) can request a login OTP/Magic Link.

// src/auth/authService.ts  
import Database from 'better-sqlite3';  
import { randomUUID } from 'node:crypto';  
import {  
  generateVerificationChallenge,  
  GlobalRole,  
  safeCompareHex,  
  sha256Hex,  
  signSessionJwt,  
} from './tokenService.js';

export interface MailDispatcher {  
  sendAuthEmail(params: {  
    to: string;  
    subject: string;  
    magicLinkUrl: string;  
    otpCode: string;  
    contextLabel: string;  
  }): Promise\<void\>;  
}

export class AuthService {  
  private readonly CHALLENGE\_TTL\_MS \= 15 \* 60 \* 1000; // 15 minutes  
  private readonly MAX\_OTP\_ATTEMPTS \= 5;

  constructor(  
    private readonly db: Database.Database,  
    private readonly mailer: MailDispatcher,  
    private readonly portalBaseUrl: string  
  ) {}

  /\*\*  
   \* Seeds the root SysAdmin account on server startup  
   \*/  
  public bootstrapSysAdmin(sysAdminEmail: string): void {  
    const email \= sysAdminEmail.trim().toLowerCase();  
    this.db  
      .prepare(\`  
        INSERT INTO users (id, email, global\_role, status, created\_at)  
        VALUES (?, ?, 'SYSADMIN', 'ACTIVE', ?)  
        ON CONFLICT(email) DO UPDATE SET global\_role \= 'SYSADMIN'  
      \`)  
      .run(randomUUID(), email, Date.now());  
  }

  /\*\*  
   \* SysAdmin Action: Invite a new or existing user to become a Project Publisher  
   \*/  
  public async invitePublisher(sysAdminUserId: string, targetEmail: string): Promise\<void\> {  
    const email \= targetEmail.trim().toLowerCase();

    this.db  
      .prepare(\`  
        INSERT INTO users (id, email, global\_role, status, created\_at)  
        VALUES (?, ?, 'PUBLISHER', 'INVITED', ?)  
        ON CONFLICT(email) DO UPDATE SET  
          global\_role \= CASE WHEN global\_role \= 'SYSADMIN' THEN 'SYSADMIN' ELSE 'PUBLISHER' END  
      \`)  
      .run(randomUUID(), email, Date.now());

    await this.issueChallengeAndSendEmail(  
      email,  
      'INVITE\_PUBLISHER',  
      null,  
      'You have been invited as a Project Publisher'  
    );  
  }

  /\*\*  
   \* Publisher Action: Invite a Viewer to specific Viewer Groups on a Project  
   \*/  
  public async inviteViewerToGroups(params: {  
    publisherUserId: string;  
    projectId: string;  
    viewerEmail: string;  
    groupIds: string\[\];  
  }): Promise\<void\> {  
    const email \= params.viewerEmail.trim().toLowerCase();

    // Verify Publisher owns this project  
    const project \= this.db  
      .prepare(\`SELECT id, name FROM projects WHERE id \= ? AND owner\_id \= ?\`)  
      .get(params.projectId, params.publisherUserId) as { id: string; name: string } \| undefined;

    if (\!project) {  
      throw new Error('Unauthorized: You do not own this project.');  
    }

    const tx \= this.db.transaction(() \=\> {  
      // Upsert Viewer user record  
      this.db  
        .prepare(\`  
          INSERT INTO users (id, email, global\_role, status, created\_at)  
          VALUES (?, ?, 'VIEWER', 'INVITED', ?)  
          ON CONFLICT(email) DO NOTHING  
        \`)  
        .run(randomUUID(), email, Date.now());

      const user \= this.db  
        .prepare(\`SELECT id FROM users WHERE email \= ?\`)  
        .get(email) as { id: string };

      const insertMembership \= this.db.prepare(\`  
        INSERT OR IGNORE INTO user\_group\_memberships  
          (user\_id, project\_id, group\_id, invited\_by, created\_at)  
        VALUES (?, ?, ?, ?, ?)  
      \`);

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
      'INVITE\_VIEWER',  
      params.projectId,  
      \`You have been invited to view project "\${project.name}"\`  
    );  
  }

  /\*\*  
   \* Any Invited User: Request a fresh OTP / Magic Link to sign in  
   \*/  
  public async requestLoginChallenge(rawEmail: string): Promise\<void\> {  
    const email \= rawEmail.trim().toLowerCase();  
    const user \= this.db  
      .prepare(\`SELECT id, status FROM users WHERE email \= ?\`)  
      .get(email) as { id: string; status: string } \| undefined;

    // Silent return if email is not invited (prevents user enumeration)  
    if (\!user \|\| user.status \=== 'SUSPENDED') return;

    await this.issueChallengeAndSendEmail(  
      email,  
      'LOGIN',  
      null,  
      'Your sign-in verification code'  
    );  
  }

  /\*\*  
   \* Verifies either a Magic Link token OR (email \+ 6-digit OTP) and returns a signed JWT  
   \*/  
  public async verifyChallenge(  
    input: { magicToken: string } \| { email: string; otpCode: string }  
  ): Promise\<{ jwt: string; redirectProjectId: string \| null; role: GlobalRole }\> {  
    const now \= Date.now();  
    let challenge: any;

    if ('magicToken' in input) {  
      const tokenHash \= sha256Hex(input.magicToken);  
      challenge \= this.db  
        .prepare(\`  
          SELECT \* FROM auth\_challenges  
          WHERE token\_hash \= ? AND consumed\_at IS NULL AND expires\_at \> ?  
        \`)  
        .get(tokenHash, now);

      if (\!challenge) throw new Error('Invalid or expired magic link.');  
    } else {  
      const email \= input.email.trim().toLowerCase();  
      challenge \= this.db  
        .prepare(\`  
          SELECT \* FROM auth\_challenges  
          WHERE email \= ? AND consumed\_at IS NULL AND expires\_at \> ?  
          ORDER BY expires\_at DESC LIMIT 1  
        \`)  
        .get(email, now);

      if (\!challenge \|\| challenge.attempts \>= this.MAX\_OTP\_ATTEMPTS) {  
        throw new Error('Verification code expired or maximum attempts exceeded.');  
      }

      const expectedOtpHash \= sha256Hex(\`\${email}:\${input.otpCode.trim()}\`);  
      if (\!safeCompareHex(challenge.otp\_hash, expectedOtpHash)) {  
        this.db  
          .prepare(\`UPDATE auth\_challenges SET attempts \= attempts \+ 1 WHERE id \= ?\`)  
          .run(challenge.id);  
        throw new Error('Incorrect verification code.');  
      }  
    }

    // Consume challenge and activate user inside an atomic transaction  
    const user \= this.db.transaction(() \=\> {  
      this.db  
        .prepare(\`UPDATE auth\_challenges SET consumed\_at \= ? WHERE id \= ?\`)  
        .run(now, challenge.id);

      this.db  
        .prepare(\`  
          UPDATE users  
          SET status \= CASE WHEN status \= 'INVITED' THEN 'ACTIVE' ELSE status END,  
              last\_login\_at \= ?  
          WHERE email \= ?  
        \`)  
        .run(now, challenge.email);

      return this.db  
        .prepare(\`SELECT id, email, global\_role, status FROM users WHERE email \= ?\`)  
        .get(challenge.email) as {  
        id: string;  
        email: string;  
        global\_role: GlobalRole;  
        status: string;  
      };  
    })();

    if (\!user \|\| user.status \=== 'SUSPENDED') {  
      throw new Error('Account is suspended.');  
    }

    const jwt \= await signSessionJwt({  
      sub: user.id,  
      email: user.email,  
      role: user.global\_role,  
    });

    return {  
      jwt,  
      redirectProjectId: challenge.project\_id ?? null,  
      role: user.global\_role,  
    };  
  }

  private async issueChallengeAndSendEmail(  
    email: string,  
    purpose: string,  
    projectId: string \| null,  
    subject: string  
  ): Promise\<void\> {  
    const { rawMagicToken, rawOtp, tokenHash, otpHash } \=  
      generateVerificationChallenge(email);

    this.db  
      .prepare(\`  
        INSERT INTO auth\_challenges  
          (id, email, token\_hash, otp\_hash, purpose, project\_id, expires\_at)  
        VALUES (?, ?, ?, ?, ?, ?, ?)  
      \`)  
      .run(  
        randomUUID(),  
        email,  
        tokenHash,  
        otpHash,  
        purpose,  
        projectId,  
        Date.now() \+ this.CHALLENGE\_TTL\_MS  
      );

    const magicLinkUrl \= \`\${this.portalBaseUrl}/auth/verify?token=\${encodeURIComponent(  
      rawMagicToken  
    )}\`;

    await this.mailer.sendAuthEmail({  
      to: email,  
      subject,  
      magicLinkUrl,  
      otpCode: rawOtp,  
      contextLabel: subject,  
    });  
  }  
}

## **4\. Role-Based & Project-ACL Middleware (authMiddleware.ts)**

Provides composable Fastify preHandler hooks that:

> 1. Authenticate the caller via HTTP-only cookie (portal\_session) or Authorization: Bearer header.  
> 2. Enforce global role boundaries (requireRole(\['SYSADMIN'\]) or requireRole(\['PUBLISHER', 'SYSADMIN'\])).  
> 3. Resolve project-level **Viewer Group ACL rules** (requireProjectAccess) and attach them directly to request.projectAclRules for downstream file rendering and RAG queries.

// src/auth/authMiddleware.ts  
import { FastifyReply, FastifyRequest } from 'fastify';  
import Database from 'better-sqlite3';  
import { GlobalRole, SessionJwtPayload, verifySessionJwt } from './tokenService.js';  
import { GroupAclRule } from '../services/aclMatcher.js';

declare module 'fastify' {  
  interface FastifyRequest {  
    user?: SessionJwtPayload;  
    projectAclRules?: GroupAclRule\[\];  
    isProjectPublisher?: boolean;  
  }  
}

export function buildAuthMiddlewares(db: Database.Database) {  
  /\*\*  
   \* 1\. Base Authentication Guard: Validates JWT & verifies active user status  
   \*/  
  async function requireAuth(req: FastifyRequest, reply: FastifyReply) {  
    const cookieToken \= (req as any).cookies?.portal\_session;  
    const headerToken \= req.headers.authorization?.replace(/^Bearer\\s+/i, '');  
    const token \= cookieToken \|\| headerToken;

    if (\!token) {  
      return reply.code(401).send({ error: 'Authentication required' });  
    }

    try {  
      const payload \= await verifySessionJwt(token);

      // Live status check against SQLite (instant revocation support)  
      const row \= db  
        .prepare(\`SELECT status, global\_role FROM users WHERE id \= ?\`)  
        .get(payload.sub) as { status: string; global\_role: GlobalRole } \| undefined;

      if (\!row \|\| row.status \!== 'ACTIVE') {  
        return reply.code(403).send({ error: 'Account revoked or inactive' });  
      }

      req.user \= { ...payload, role: row.global\_role };  
    } catch {  
      return reply.code(401).send({ error: 'Invalid or expired session token' });  
    }  
  }

  /\*\*  
   \* 2\. Global Role Guard (SysAdmin / Publisher endpoints)  
   \*/  
  function requireRole(allowedRoles: GlobalRole\[\]) {  
    return async (req: FastifyRequest, reply: FastifyReply) \=\> {  
      await requireAuth(req, reply);  
      if (reply.sent \|\| \!req.user) return;

      if (\!allowedRoles.includes(req.user.role)) {  
        return reply.code(403).send({ error: 'Insufficient role permissions' });  
      }  
    };  
  }

  /\*\*  
   \* 3\. Project-Scoped Viewer/Publisher Guard:  
   \* Resolves effective GroupAclRule\[\] for the user on \`:projectId\`.  
   \* Also supports Publisher "Preview as Group" via \`?previewGroupId=xyz\`.  
   \*/  
  async function requireProjectViewerAccess(req: FastifyRequest, reply: FastifyReply) {  
    await requireAuth(req, reply);  
    if (reply.sent \|\| \!req.user) return;

    const { projectId } \= req.params as { projectId: string };  
    const { previewGroupId } \= req.query as { previewGroupId?: string };

    // Check if user is the owning Publisher of this project  
    const project \= db  
      .prepare(\`SELECT id, owner\_id FROM projects WHERE id \= ?\`)  
      .get(projectId) as { id: string; owner\_id: string } \| undefined;

    if (\!project) {  
      return reply.code(404).send({ error: 'Project not found' });  
    }

    const isOwner \= project.owner\_id \=== req.user.sub \|\| req.user.role \=== 'SYSADMIN';  
    req.isProjectPublisher \= isOwner;

    // If Publisher is previewing a specific group, load only that group's rules  
    if (isOwner && previewGroupId) {  
      const groupRow \= db  
        .prepare(\`SELECT \* FROM viewer\_groups WHERE id \= ? AND project\_id \= ?\`)  
        .get(previewGroupId, projectId) as any;

      if (\!groupRow) {  
        return reply.code(404).send({ error: 'Preview group not found' });  
      }

      req.projectAclRules \= \[mapRowToAclRule(groupRow)\];  
      return;  
    }

    // If Publisher is viewing normally without preview filter, grant full repository view  
    if (isOwner) {  
      req.projectAclRules \= \[  
        {  
          groupId: 'PUBLISHER\_FULL\_ACCESS',  
          allowedFolders: \['\*'\],  
          allowedExtensions: \[\],  
          excludeGlobs: \[\],  
          maxFileSizeBytes: 10 \* 1024 \* 1024,  
        },  
      \];  
      return;  
    }

    // Standard Viewer: Load all Viewer Groups assigned to this user for this project  
    const assignedGroups \= db  
      .prepare(\`  
        SELECT vg.\*  
        FROM viewer\_groups vg  
        JOIN user\_group\_memberships ugm ON ugm.group\_id \= vg.id  
        WHERE ugm.user\_id \= ? AND ugm.project\_id \= ?  
      \`)  
      .all(req.user.sub, projectId) as any\[\];

    if (assignedGroups.length \=== 0\) {  
      return reply.code(403).send({ error: 'You do not have access to this project' });  
    }

    req.projectAclRules \= assignedGroups.map(mapRowToAclRule);  
  }

  return { requireAuth, requireRole, requireProjectViewerAccess };  
}

function mapRowToAclRule(row: any): GroupAclRule {  
  return {  
    groupId: row.id,  
    allowedFolders: JSON.parse(row.allowed\_folders\_json),  
    allowedExtensions: JSON.parse(row.allowed\_extensions\_json),  
    excludeGlobs: JSON.parse(row.exclude\_globs\_json),  
    maxFileSizeBytes: row.max\_file\_size\_bytes,  
  };  
}

## **5\. Fastify Route Wiring (authRoutes.ts)**

Connects the invitation, verification, and ACL-protected viewer endpoints, setting HttpOnly, Secure, SameSite=Lax cookies upon verification.  
// src/routes/authRoutes.ts  
import { FastifyInstance } from 'fastify';  
import { AuthService } from '../auth/authService.js';  
import { buildAuthMiddlewares } from '../auth/authMiddleware.js';

export async function registerAuthRoutes(  
  app: FastifyInstance,  
  authService: AuthService,  
  middlewares: ReturnType\<typeof buildAuthMiddlewares\>  
) {  
  // 1\. SysAdmin invites a Publisher  
  app.post(  
    '/api/admin/invite-publisher',  
    { preHandler: \[middlewares.requireRole(\['SYSADMIN'\])\] },  
    async (req, reply) \=\> {  
      const { email } \= req.body as { email: string };  
      await authService.invitePublisher(req.user\!.sub, email);  
      return reply.send({ ok: true });  
    }  
  );

  // 2\. Publisher invites a Viewer to specific Viewer Groups  
  app.post(  
    '/api/projects/:projectId/invite-viewer',  
    { preHandler: \[middlewares.requireRole(\['PUBLISHER', 'SYSADMIN'\])\] },  
    async (req, reply) \=\> {  
      const { projectId } \= req.params as { projectId: string };  
      const { email, groupIds } \= req.body as { email: string; groupIds: string\[\] };

      await authService.inviteViewerToGroups({  
        publisherUserId: req.user\!.sub,  
        projectId,  
        viewerEmail: email,  
        groupIds,  
      });  
      return reply.send({ ok: true });  
    }  
  );

  // 3\. Request OTP / Magic Link for existing invited user  
  app.post('/api/auth/request-code', async (req, reply) \=\> {  
    const { email } \= req.body as { email: string };  
    await authService.requestLoginChallenge(email);  
    return reply.send({ message: 'If your email is registered, a code has been sent.' });  
  });

  // 4\. Verify Magic Link or 6-Digit OTP and set HttpOnly Session Cookie  
  app.post('/api/auth/verify', async (req, reply) \=\> {  
    const body \= req.body as { magicToken?: string; email?: string; otpCode?: string };

    const result \= body.magicToken  
      ? await authService.verifyChallenge({ magicToken: body.magicToken })  
      : await authService.verifyChallenge({  
          email: body.email \|\| '',  
          otpCode: body.otpCode \|\| '',  
        });

    (reply as any).setCookie('portal\_session', result.jwt, {  
      httpOnly: true,  
      secure: process.env.NODE\_ENV \=== 'production',  
      sameSite: 'lax',  
      path: '/',  
      maxAge: 12 \* 60 \* 60, // 12 hours  
    });

    return reply.send({  
      authenticated: true,  
      role: result.role,  
      redirectProjectId: result.redirectProjectId,  
    });  
  });  
}  
