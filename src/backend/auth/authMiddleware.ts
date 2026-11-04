import { FastifyReply, FastifyRequest } from 'fastify';
import Database from 'better-sqlite3';
import { GlobalRole, GroupAclRule } from '@/shared/types.js';
import { SessionJwtPayload, verifySessionJwt } from './tokenService.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionJwtPayload;
    projectAclRules?: GroupAclRule[];
    isProjectPublisher?: boolean;
  }
}

export function buildAuthMiddlewares(db: Database.Database) {
  /**
   * 1. Base Authentication Guard: Validates JWT & verifies active user status
   */
  async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
    const cookieToken = (req as any).cookies?.portal_session;
    const headerToken = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    const token = cookieToken || headerToken;

    if (!token) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    try {
      const payload = await verifySessionJwt(token);

      // Live status check against SQLite (instant revocation support)
      const row = db
        .prepare(`SELECT status, global_role FROM users WHERE id = ?`)
        .get(payload.sub) as { status: string; global_role: GlobalRole } | undefined;

      if (!row || row.status !== 'ACTIVE') {
        return reply.code(403).send({ error: 'Account revoked, suspended, or inactive' });
      }

      req.user = { ...payload, role: row.global_role };
    } catch {
      return reply.code(401).send({ error: 'Invalid or expired session token' });
    }
  }

  /**
   * 2. Global Role Guard (SysAdmin / Publisher endpoints)
   */
  function requireRole(allowedRoles: GlobalRole[]) {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      await requireAuth(req, reply);
      if (reply.sent || !req.user) return;

      if (!allowedRoles.includes(req.user.role)) {
        return reply.code(403).send({ error: 'Insufficient role permissions' });
      }
    };
  }

  /**
   * 3. Project-Scoped Viewer/Publisher Guard:
   * Resolves effective GroupAclRule[] for the user on :projectId.
   * Also supports Publisher "Preview as Group" via ?previewGroupId=xyz (PUB-05).
   */
  async function requireProjectViewerAccess(req: FastifyRequest, reply: FastifyReply) {
    await requireAuth(req, reply);
    if (reply.sent || !req.user) return;

    const { projectId } = req.params as { projectId: string };
    const queryPreviewGroupId = (req.query as any)?.previewGroupId;
    const bodyPreviewGroupId = (req.body as any)?.previewGroupId;
    const previewGroupId = queryPreviewGroupId || bodyPreviewGroupId;

    const project = db
      .prepare(`SELECT id, owner_id FROM projects WHERE id = ?`)
      .get(projectId) as { id: string; owner_id: string } | undefined;

    if (!project) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    const isOwner = project.owner_id === req.user.sub || req.user.role === 'SYSADMIN';
    req.isProjectPublisher = isOwner;

    // If Publisher is previewing a specific group, load only that group's rules
    if (isOwner && previewGroupId) {
      const groupRow = db
        .prepare(`SELECT * FROM viewer_groups WHERE id = ? AND project_id = ?`)
        .get(previewGroupId, projectId) as any;

      if (!groupRow) {
        return reply.code(404).send({ error: 'Preview group not found' });
      }

      req.projectAclRules = [mapRowToAclRule(groupRow)];
      return;
    }

    // If Publisher is viewing normally without preview filter, grant full repository view
    if (isOwner) {
      req.projectAclRules = [
        {
          groupId: 'PUBLISHER_FULL_ACCESS',
          name: 'Publisher Full Access',
          allowedFolders: ['*'],
          allowedExtensions: [],
          excludeGlobs: [],
          maxFileSizeBytes: 50 * 1024 * 1024,
        },
      ];
      return;
    }

    // Standard Viewer: Load all Viewer Groups assigned to this user for this project
    const assignedGroups = db
      .prepare(`
        SELECT vg.*
        FROM viewer_groups vg
        JOIN user_group_memberships ugm ON ugm.group_id = vg.id
        WHERE ugm.user_id = ? AND ugm.project_id = ?
      `)
      .all(req.user.sub, projectId) as any[];

    if (assignedGroups.length === 0) {
      return reply.code(403).send({ error: 'You do not have access to this project' });
    }

    req.projectAclRules = assignedGroups.map(mapRowToAclRule);
  }

  return { requireAuth, requireRole, requireProjectViewerAccess };
}

function mapRowToAclRule(row: any): GroupAclRule {
  return {
    groupId: row.id,
    name: row.name,
    allowedFolders: JSON.parse(row.allowed_folders_json || '[]'),
    allowedExtensions: JSON.parse(row.allowed_extensions_json || '[]'),
    excludeGlobs: JSON.parse(row.exclude_globs_json || '[]'),
    maxFileSizeBytes: row.max_file_size_bytes,
  };
}
