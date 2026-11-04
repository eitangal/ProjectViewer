import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

// 32-byte hex key (64 characters). Provide default fallback for local dev/testing if not in env
const DEFAULT_DEV_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function getMasterKey(): Buffer {
  const envKey = process.env.MASTER_ENCRYPTION_KEY || DEFAULT_DEV_KEY;
  if (envKey.length !== 64) {
    throw new Error('MASTER_ENCRYPTION_KEY must be a 64-character (32-byte) hex string');
  }
  return Buffer.from(envKey, 'hex');
}

/**
 * Encrypts plaintext using AES-256-GCM.
 * Output format: ivHex:authTagHex:encryptedHex
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const key = getMasterKey();
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts payload formatted as ivHex:authTagHex:encryptedHex using AES-256-GCM.
 */
export function decryptSecret(cipherPayload: string): string {
  const parts = cipherPayload.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid cipher payload format');
  }
  const [ivHex, tagHex, encryptedHex] = parts;
  const key = getMasterKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/**
 * Verifies GitHub Webhook HMAC SHA-256 signature (header "sha256=...").
 */
export function verifyGithubWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const expectedSig = signatureHeader.slice('sha256='.length);
  const hmac = createHmac('sha256', secret);
  hmac.update(rawBody);
  const computedSig = hmac.digest('hex');

  const bufA = Buffer.from(expectedSig, 'utf8');
  const bufB = Buffer.from(computedSig, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
