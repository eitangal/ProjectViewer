import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify, JWTPayload } from 'jose';
import { GlobalRole } from '@/shared/types.js';

const DEFAULT_JWT_SECRET = 'gitlens-portal-super-secret-jwt-signing-key-32-bytes!';
const ISSUER = 'gitlens-portal';

export function validateJwtConfig(): void {
  const envSecret = process.env.JWT_SECRET_KEY;
  if (process.env.NODE_ENV === 'production' && !process.env.VITEST) {
    if (!envSecret || envSecret === DEFAULT_JWT_SECRET || envSecret.length < 32) {
      throw new Error(
        'CRITICAL SECURITY ERROR: JWT_SECRET_KEY must be set to a unique secret of at least 32 characters in production.'
      );
    }
  }
}

function getJwtSecret(): Uint8Array {
  validateJwtConfig();
  const envSecret = process.env.JWT_SECRET_KEY;
  const secret = envSecret || DEFAULT_JWT_SECRET;
  return new TextEncoder().encode(secret);
}

export interface SessionJwtPayload extends JWTPayload {
  sub: string;       // user.id
  email: string;     // user.email
  role: GlobalRole;  // Highest global role
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function safeCompareHex(aHex: string, bHex: string): boolean {
  const bufA = Buffer.from(aHex, 'hex');
  const bufB = Buffer.from(bHex, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Generates a paired URL Magic Token (256-bit entropy) and 6-digit OTP code.
 */
export function generateVerificationChallenge(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const rawMagicToken = randomBytes(32).toString('base64url');
  const rawOtp = randomInt(100000, 999999).toString();

  return {
    rawMagicToken,
    rawOtp,
    tokenHash: sha256Hex(rawMagicToken),
    otpHash: sha256Hex(`${normalizedEmail}:${rawOtp}`),
  };
}

export async function signSessionJwt(payload: SessionJwtPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setExpirationTime('12h')
    .sign(getJwtSecret());
}

export async function verifySessionJwt(token: string): Promise<SessionJwtPayload> {
  const { payload } = await jwtVerify(token, getJwtSecret(), { issuer: ISSUER });
  return payload as SessionJwtPayload;
}
