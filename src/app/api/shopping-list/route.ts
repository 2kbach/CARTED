import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { generateId } from "@/lib/pair-code";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const db = getDb();

  try {
    // Get all shopping list items (for all linked users)
    const items = await db.execute({
      sql: `SELECT sli.id, sli.name, sli.productUrl, sli.isCompleted, sli.completedAt,
                   sli.completedByOrderId, sli.amazonOrderItemId, sli.createdAt, sli.updatedAt,
                   u.name as addedByName, u.email as addedByEmail, u.image as addedByImage
            FROM ShoppingListItem sli
            JOIN User u ON sli.addedByUserId = u.id
            ORDER BY sli.isCompleted ASC, sli.createdAt DESC`,
      args: [],
    });

    return NextResponse.json({
      items: items.rows.map((row) => ({
        id: row.id,
        name: row.name,
        productUrl: row.productUrl,
        isCompleted: row.isCompleted === 1,
        completedAt: row.completedAt,
        completedByOrderId: row.completedByOrderId,
        amazonOrderItemId: row.amazonOrderItemId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        addedBy: {
          name: row.addedByName,
          email: row.addedByEmail,
          image: row.addedByImage,
        },
      })),
    });
  } catch (error) {
    console.error("[shopping-list] Error:", error);
    return NextResponse.json({ error: "Failed to fetch list" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const db = getDb();
  const body = await request.json();
  const { name, productUrl, amazonOrderItemId } = body;

  if (!name || !name.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  try {
    const userResult = await db.execute({
      sql: "SELECT id FROM User WHERE email = ?",
      args: [session.user.email],
    });

    if (userResult.rows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const userId = userResult.rows[0].id as string;
    const itemId = generateId();

    await db.execute({
      sql: `INSERT INTO ShoppingListItem (id, addedByUserId, name, productUrl, amazonOrderItemId, isCompleted, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      args: [
        itemId,
        userId,
        name.trim(),
        productUrl ?? null,
        amazonOrderItemId ?? null,
        new Date().toISOString(),
        new Date().toISOString(),
      ],
    });

    return NextResponse.json({ success: true, id: itemId });
  } catch (error) {
    console.error("[shopping-list] Error:", error);
    return NextResponse.json({ error: "Failed to add item" }, { status: 500 });
  }
}
