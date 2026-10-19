import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import type { Session, SessionService } from "../auth/sessions.js";
import { generateToken, hashToken, isWellFormedToken } from "../auth/tokens.js";
import type { Database } from "../database/database.js";

export const HANDOFF_SECONDS = 60;
const TOUCH_INTERVAL_MS = 60_000;

export class PortalSessionService {
  readonly #database: Database;
  readonly #sessions: SessionService;
  readonly #clock: () => Date;

  constructor(options: { database: Database; sessions: SessionService; clock?: () => Date }) {
    this.#database = options.database;
    this.#sessions = options.sessions;
    this.#clock = options.clock ?? (() => new Date());
  }

  async issueHandoff(session: Session, domain: string, state: string): Promise<string | null> {
    if (session.kind !== "full" || !isWellFormedToken(state)) return null;
    const code = generateToken();
    const expiresAt = new Date(this.#clock().getTime() + HANDOFF_SECONDS * 1000);
    const inserted = await this.#database.execute<{ code_hash: Buffer }>(sql`
      insert into portal_handoffs (code_hash, state_hash, domain, session_id, expires_at)
      select ${hashToken(code)}, ${hashToken(state)}, d.domain, ${session.id}, ${expiresAt}
      from portal_domains d where d.domain = ${domain}
      returning code_hash`);
    return inserted.rows.length > 0 ? code : null;
  }

  async redeem(code: string, state: string, domain: string): Promise<string | null> {
    if (!isWellFormedToken(code) || !isWellFormedToken(state)) return null;
    const now = this.#clock();
    const consumed = await this.#database.execute<{ session_id: string }>(sql`
      update portal_handoffs set consumed_at = ${now}
      where code_hash = ${hashToken(code)} and state_hash = ${hashToken(state)} and domain = ${domain}
        and consumed_at is null and expires_at > ${now}
      returning session_id`);
    const sessionId = consumed.rows[0]?.session_id;
    if (!sessionId) return null;
    const session = await this.#sessions.resolveById(sessionId);
    if (session?.kind !== "full") return null;
    const token = generateToken();
    const created = await this.#database.execute<{ id: string }>(sql`
      insert into portal_sessions (id, token_hash, session_id, domain)
      select ${uuidv7()}::uuid, ${hashToken(token)}, s.id, ${domain} from sessions s where s.id = ${sessionId}
      returning id`);
    return created.rows.length > 0 ? token : null;
  }

  async resolve(token: string, domain: string): Promise<Session | null> {
    if (!isWellFormedToken(token)) return null;
    const found = await this.#database.execute<{ id: string; session_id: string; last_used_at: Date }>(sql`
      select id, session_id, last_used_at from portal_sessions
      where token_hash = ${hashToken(token)} and domain = ${domain}`);
    const row = found.rows[0];
    if (!row) return null;
    const session = await this.#sessions.resolveById(row.session_id);
    if (session?.kind !== "full") return null;
    const now = this.#clock();
    if (now.getTime() - new Date(row.last_used_at).getTime() >= TOUCH_INTERVAL_MS) {
      await this.#database.execute(
        sql`update portal_sessions set last_used_at = ${now} where id = ${row.id}`,
      );
    }
    return session;
  }

  async cleanup(): Promise<number> {
    const removed = await this.#database.execute<{ code_hash: Buffer }>(
      sql`delete from portal_handoffs where expires_at < ${this.#clock()} returning code_hash`,
    );
    return removed.rows.length;
  }
}
