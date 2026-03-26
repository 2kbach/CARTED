import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { scanAmazonEmails } from "@/lib/gmail";
import { parseAmazonEmails } from "@/lib/amazon-parser";
import { generateId } from "@/lib/pair-code";

export const maxDuration = 300;

export async function POST() {
  const session = await auth();
  if (!session?.access_token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const db = getDb();

  try {
    const userResult = await db.execute({
      sql: "SELECT id, email FROM User WHERE email = ?",
      args: [session.user?.email ?? ""],
    });

    if (userResult.rows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const userId = userResult.rows[0].id as string;

    // Manual scan: last 30 days
    const afterDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    console.log(`[scan] Manual scan for ${session.user?.email} since ${afterDate.toISOString().split("T")[0]}`);

    const emails = await scanAmazonEmails(session.access_token, afterDate);
    console.log(`[scan] Found ${emails.length} Amazon order emails`);

    const orders = parseAmazonEmails(emails);
    console.log(`[scan] Parsed ${orders.length} orders`);

    let created = 0;
    let skipped = 0;
    let itemsCreated = 0;

    for (const order of orders) {
      // Dedup by sourceEmailId
      const existing = await db.execute({
        sql: "SELECT id FROM AmazonOrder WHERE sourceEmailId = ?",
        args: [order.emailId],
      });

      if (existing.rows.length > 0) {
        skipped++;
        continue;
      }

      const orderId = generateId();
      await db.execute({
        sql: `INSERT INTO AmazonOrder (id, userId, sourceEmailId, orderNumber, orderDate, rawEmailBody, createdAt)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          orderId,
          userId,
          order.emailId,
          order.orderNumber,
          order.orderDate.toISOString(),
          order.rawEmailBody,
          new Date().toISOString(),
        ],
      });

      for (const item of order.items) {
        const itemId = generateId();
        await db.execute({
          sql: `INSERT INTO AmazonOrderItem (id, orderId, name, nameLower, price, quantity, productUrl, imageUrl, createdAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            itemId,
            orderId,
            item.name,
            item.name.toLowerCase(),
            item.price,
            item.quantity,
            item.productUrl,
            item.imageUrl,
            new Date().toISOString(),
          ],
        });
        itemsCreated++;
      }

      created++;
    }

    // Auto-complete shopping list items
    const autoCompleted = await autoCompleteShoppingItems(db, userId);

    // Update lastScanAt
    await db.execute({
      sql: "UPDATE User SET lastScanAt = ?, updatedAt = ? WHERE id = ?",
      args: [new Date().toISOString(), new Date().toISOString(), userId],
    });

    return NextResponse.json({
      success: true,
      emailsFound: emails.length,
      ordersParsed: orders.length,
      created,
      skipped,
      itemsCreated,
      autoCompleted,
    });
  } catch (error) {
    console.error("[scan] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Scan failed" },
      { status: 500 }
    );
  }
}

async function autoCompleteShoppingItems(
  db: ReturnType<typeof getDb>,
  userId: string
): Promise<number> {
  // Get uncompleted shopping list items for this user and linked users
  const uncompleted = await db.execute({
    sql: `SELECT id, name FROM ShoppingListItem WHERE isCompleted = 0`,
    args: [],
  });

  let completed = 0;

  for (const item of uncompleted.rows) {
    const itemName = (item.name as string).toLowerCase();

    // Look for matching order items (fuzzy: contains match)
    const match = await db.execute({
      sql: `SELECT ao.id as orderId FROM AmazonOrderItem aoi
            JOIN AmazonOrder ao ON aoi.orderId = ao.id
            WHERE aoi.nameLower LIKE ?
            ORDER BY ao.orderDate DESC
            LIMIT 1`,
      args: [`%${itemName}%`],
    });

    if (match.rows.length > 0) {
      await db.execute({
        sql: `UPDATE ShoppingListItem SET isCompleted = 1, completedAt = ?, completedByOrderId = ?, updatedAt = ? WHERE id = ?`,
        args: [
          new Date().toISOString(),
          match.rows[0].orderId as string,
          new Date().toISOString(),
          item.id as string,
        ],
      });
      completed++;
    }
  }

  return completed;
}
