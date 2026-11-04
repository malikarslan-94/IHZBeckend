import { env } from './env.js';

export function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) return false;
    return env.CLIENT_URL === '*' || origin === new URL(env.CLIENT_URL).origin;
  } catch {
    return false;
  }
}
