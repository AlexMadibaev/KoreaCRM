import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

type Codes = { qrCode: string; ean13: string };
function key() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET is required for POS code storage');
  return createHash('sha256').update('koreacrm:pos-code-vault:v1\0').update(secret).digest();
}
export function sealPosCodes(userId: string, codes: Codes) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), nonce);
  cipher.setAAD(Buffer.from(userId));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(codes), 'utf8'), cipher.final()]);
  return ['v1', nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}
export function openPosCodes(userId: string, value: string): Codes | null {
  try {
    const [version, nonce, tag, ciphertext, extra] = value.split('.');
    if (version !== 'v1' || !nonce || !tag || !ciphertext || extra) return null;
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(nonce, 'base64url'));
    decipher.setAAD(Buffer.from(userId));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const decoded: unknown = JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8'));
    if (!decoded || typeof decoded !== 'object' || !('qrCode' in decoded) || !('ean13' in decoded) || typeof decoded.qrCode !== 'string' || typeof decoded.ean13 !== 'string') return null;
    return { qrCode: decoded.qrCode, ean13: decoded.ean13 };
  } catch { return null; }
}
