import { FastifyInstance } from 'fastify';
import { AuthService } from '../auth/authService.js';
import { buildAuthMiddlewares } from '../auth/authMiddleware.js';

export async function registerAuthRoutes(
  app: FastifyInstance,
  authService: AuthService,
  middlewares: ReturnType<typeof buildAuthMiddlewares>
) {
  // Per-IP sliding window rate limiter for authentication endpoints
  const ipRateMap = new Map<string, { count: number; resetAt: number }>();
  const RATE_WINDOW_MS = 60 * 1000;
  const MAX_AUTH_REQS_PER_WINDOW = process.env.VITEST ? 500 : 20;

  function checkAuthRateLimit(ip: string): boolean {
    const now = Date.now();
    const record = ipRateMap.get(ip);
    if (!record || now > record.resetAt) {
      ipRateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
      return true;
    }
    if (record.count >= MAX_AUTH_REQS_PER_WINDOW) {
      return false;
    }
    record.count++;
    return true;
  }

  // 1. Request OTP / Magic Link for existing invited user
  app.post('/api/auth/request-code', async (req, reply) => {
    if (!checkAuthRateLimit(req.ip || 'unknown')) {
      return reply.code(429).send({ error: 'Too many authentication requests. Please try again in a minute.' });
    }
    const { email } = (req.body || {}) as { email?: string };
    if (!email || typeof email !== 'string') {
      return reply.code(400).send({ error: 'Email is required' });
    }
    await authService.requestLoginChallenge(email);

    return reply.send({
      message: 'If your email is registered, a code has been sent.',
    });
  });

  // 2. Verify Magic Link or 6-Digit OTP and set HttpOnly Session Cookie
  app.post('/api/auth/verify', async (req, reply) => {
    if (!checkAuthRateLimit(req.ip || 'unknown')) {
      return reply.code(429).send({ error: 'Too many verification attempts. Please try again later.' });
    }
    const body = (req.body || {}) as { magicToken?: string; email?: string; otpCode?: string };

    try {
      const result = body.magicToken
        ? await authService.verifyChallenge({ magicToken: body.magicToken })
        : await authService.verifyChallenge({
            email: body.email || '',
            otpCode: body.otpCode || '',
          });

      reply.setCookie('portal_session', result.jwt, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 12 * 60 * 60, // 12 hours
      });

      return reply.send({
        authenticated: true,
        user: result.user,
        redirectProjectId: result.redirectProjectId,
        token: result.jwt,
      });
    } catch (err: any) {
      return reply.code(400).send({ error: err.message || 'Verification failed' });
    }
  });

  // 3. GET /api/auth/verify & GET /auth/verify (browser link redirect handler)
  // Safe & Idempotent GET handler: Never consume one-time auth tokens on HTTP GET!
  // Enterprise email security scanners (e.g. Microsoft Defender SafeLinks for Office 365,
  // Proofpoint, Google Workspace) pre-fetch and inspect links in emails via HTTP GET.
  // Consuming on GET allows automated scanners to burn tokens before the user can open them.
  // Instead, redirect to the web app which will authenticate via POST /api/auth/verify.
  const verifyGetHandler = async (req: any, reply: any) => {
    const { token, path: targetPath, projectId } = req.query as {
      token?: string;
      path?: string;
      projectId?: string;
    };
    if (!token) {
      return reply.redirect('/?error=missing_token');
    }
    let redirectUrl = `/?token=${encodeURIComponent(token)}`;
    if (projectId && typeof projectId === 'string') {
      redirectUrl += `&projectId=${encodeURIComponent(projectId)}`;
    }
    if (targetPath && typeof targetPath === 'string' && !targetPath.startsWith('//') && !targetPath.includes('://')) {
      redirectUrl += `&path=${encodeURIComponent(targetPath.replace(/^\/+/, ''))}`;
    }
    return reply.redirect(redirectUrl);
  };

  app.get('/api/auth/verify', verifyGetHandler);
  app.get('/auth/verify', verifyGetHandler);

  // 4. Get Current Active User
  app.get('/api/auth/me', { preHandler: [middlewares.requireAuth] }, async (req, reply) => {
    return reply.send({ user: req.user });
  });

  // 5. Logout
  app.post('/api/auth/logout', async (req, reply) => {
    reply.clearCookie('portal_session', { path: '/' });
    return reply.send({ ok: true });
  });
}
