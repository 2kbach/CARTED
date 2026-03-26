import type { Client } from "@libsql/client";

const PAIR_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const PAIR_CODE_LENGTH = 6;
const PAIR_CODE_EXPIRY_MINUTES = 10;

export function generatePairCode(): string {
  let code = "";
  const array = new Uint8Array(PAIR_CODE_LENGTH);
  crypto.getRandomValues(array);
  for (let i = 0; i < PAIR_CODE_LENGTH; i++) {
    code += PAIR_CODE_CHARS[array[i] % PAIR_CODE_CHARS.length];
  }
  return code;
}

export function getPairCodeExpiry(): string {
  return new Date(
    Date.now() + PAIR_CODE_EXPIRY_MINUTES * 60 * 1000
  ).toISOString();
}

export function generateId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const timestamp = Date.now().toString(36);
  let random = "";
  for (let i = 0; i < 12; i++) {
    random += chars[Math.floor(Math.random() * chars.length)];
  }
  return `c${timestamp}${random}`;
}

export async function getLinkedEmails(
  db: Client,
  userEmail: string
): Promise<string[]> {
  const userResult = await db.execute({
    sql: "SELECT id FROM User WHERE email = ?",
    args: [userEmail],
  });

  if (userResult.rows.length > 0) {
    const userId = userResult.rows[0].id as string;

    const links = await db.execute({
      sql: `SELECT u.email FROM UserLink ul
            JOIN User u ON (u.id = ul.userAId OR u.id = ul.userBId)
            WHERE (ul.userAId = ? OR ul.userBId = ?)
            AND u.id != ?`,
      args: [userId, userId, userId],
    });

    if (links.rows.length > 0) {
      const emails = [userEmail];
      for (const row of links.rows) {
        emails.push(row.email as string);
      }
      return emails;
    }
  }

  return [userEmail];
}
