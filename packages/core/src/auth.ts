import type { Database } from "./db";
import type { PublicUser } from "@cottassistant/shared";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
const COOKIE_NAME = "cott_session";

export { COOKIE_NAME };

export async function hashPassword(password: string): Promise<string> {
  return await Bun.password.hash(password, { algorithm: "bcrypt", cost: 10 });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return await Bun.password.verify(password, hash);
}

export function createSession(db: Database, userId: number): string {
  const id = crypto.randomUUID();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  db.createSession(id, userId, expiresAt);
  return id;
}

export function destroySession(db: Database, sessionId: string): void {
  db.deleteSession(sessionId);
}

export function getSessionUser(db: Database, sessionId: string | undefined | null): PublicUser | null {
  if (!sessionId) return null;
  const session = db.getSession(sessionId);
  if (!session) return null;
  if (session.expires_at < Date.now()) {
    db.deleteSession(sessionId);
    return null;
  }
  return db.getUserById(session.user_id);
}

export function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join("=") ?? "");
  }
  return out;
}

export function sessionCookie(sessionId: string, maxAgeSec = SESSION_TTL_MS / 1000): string {
  return `${COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAgeSec)}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}
