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
    return reply.send({ message: 'If your email is registered, a code has been sent.' });
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

  // 3. GET /api/auth/verify (browser link redirect handler)
  app.get('/api/auth/verify', async (req, reply) => {
    const { token } = req.query as { token?: string };
    if (!token) {
      return reply.redirect('/login?error=missing_token');
    }
    try {
      const result = await authService.verifyChallenge({ magicToken: token });
      reply.setCookie('portal_session', result.jwt, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 12 * 60 * 60,
      });
      if (result.redirectProjectId) {
        return reply.redirect(`/viewer/${result.redirectProjectId}`);
      }
      if (result.user.globalRole === 'SYSADMIN') {
        return reply.redirect('/admin');
      }
      return reply.redirect('/publisher');
    } catch {
      return reply.redirect('/login?error=invalid_or_expired_token');
    }
  });

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
