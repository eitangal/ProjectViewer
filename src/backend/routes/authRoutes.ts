import { FastifyInstance } from 'fastify';
import { AuthService } from '../auth/authService.js';
import { buildAuthMiddlewares } from '../auth/authMiddleware.js';

export async function registerAuthRoutes(
  app: FastifyInstance,
  authService: AuthService,
  middlewares: ReturnType<typeof buildAuthMiddlewares>
) {
  // 1. Request OTP / Magic Link for existing invited user
  app.post('/api/auth/request-code', async (req, reply) => {
    const { email } = req.body as { email: string };
    if (!email) {
      return reply.code(400).send({ error: 'Email is required' });
    }
    await authService.requestLoginChallenge(email);

    return reply.send({
      message: 'If your email is registered, a code has been sent.',
    });
  });

  // 2. Verify Magic Link or 6-Digit OTP and set HttpOnly Session Cookie
  app.post('/api/auth/verify', async (req, reply) => {
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
    const { token } = req.query as { token?: string };
    if (!token) {
      return reply.redirect('/?error=missing_token');
    }
    return reply.redirect(`/?token=${encodeURIComponent(token)}`);
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
