import crypto from 'crypto';

function getPepper(): string {
  return (process.env.OFFERT_CUSTOMER_TOKEN_PEPPER || '').trim();
}

export function generateCustomerToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashCustomerToken(token: string): string {
  const t = String(token || '').trim();
  if (!t) throw new Error('Missing token');
  const pepper = getPepper();
  return crypto.createHash('sha256').update(t + pepper).digest('hex');
}
