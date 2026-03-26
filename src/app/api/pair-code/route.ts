import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { generatePairCode, getPairCodeExpiry, generateId } from "@/lib/pair-code";

// Generate a pair code
export async function POST() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const db = getDb();

  try {
    const userResult = await db.execute({
      sql: "SELECT id FROM User WHERE email = ?",
      args: [session.user.email],
    });

    if (userResult.rows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const userId = userResult.rows[0].id as string;
    const code = generatePairCode();
    const expiresAt = getPairCodeExpiry();
    const id = generateId();

    await db.execute({
      sql: `INSERT INTO PairCode (id, code, creatorUserId, expiresAt, createdAt) VALUES (?, ?, ?, ?, ?)`,
      args: [id, code, userId, expiresAt, new Date().toISOString()],
    });

    return NextResponse.json({ code, expiresAt });
  } catch (error) {
    console.error("[pair-code] Error:", error);
    return NextResponse.json({ error: "Failed to generate code" }, { status: 500 });
  }
}

// Verify and link with a pair code
export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const db = getDb();
  const body = await request.json();
  const { code } = body;

  if (!code) {
    return NextResponse.json({ error: "Code is required" }, { status: 400 });
  }

  try {
    const userResult = await db.execute({
      sql: "SELECT id FROM User WHERE email = ?",
      args: [session.user.email],
    });

    if (userResult.rows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const currentUserId = userResult.rows[0].id as string;

    // Find valid pair code
    const codeResult = await db.execute({
      sql: `SELECT id, creatorUserId FROM PairCode
            WHERE code = ? AND expiresAt > ? AND usedAt IS NULL`,
      args: [code.toUpperCase(), new Date().toISOString()],
    });

    if (codeResult.rows.length === 0) {
      return NextResponse.json({ error: "Invalid or expired code" }, { status: 400 });
    }

    const creatorUserId = codeResult.rows[0].creatorUserId as string;

    if (creatorUserId === currentUserId) {
      return NextResponse.json({ error: "Cannot pair with yourself" }, { status: 400 });
    }

    // Check if already linked
    const existingLink = await db.execute({
      sql: `SELECT id FROM UserLink
            WHERE (userAId = ? AND userBId = ?) OR (userAId = ? AND userBId = ?)`,
      args: [creatorUserId, currentUserId, currentUserId, creatorUserId],
    });

    if (existingLink.rows.length > 0) {
      return NextResponse.json({ error: "Already linked" }, { status: 400 });
    }

    // Create link
    const linkId = generateId();
    await db.execute({
      sql: `INSERT INTO UserLink (id, userAId, userBId, createdAt) VALUES (?, ?, ?, ?)`,
      args: [linkId, creatorUserId, currentUserId, new Date().toISOString()],
    });

    // Mark code as used
    await db.execute({
      sql: `UPDATE PairCode SET usedAt = ?, usedByUserId = ? WHERE id = ?`,
      args: [new Date().toISOString(), currentUserId, codeResult.rows[0].id as string],
    });

    return NextResponse.json({ success: true, message: "Accounts linked!" });
  } catch (error) {
    console.error("[pair-code] Error:", error);
    return NextResponse.json({ error: "Failed to verify code" }, { status: 500 });
  }
}
