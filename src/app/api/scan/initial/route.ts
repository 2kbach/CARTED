import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { scanAmazonEmails } from "@/lib/gmail";
import { parseAmazonEmails } from "@/lib/amazon-parser";
import { generateId } from "@/lib/pair-code";

// Allow 5 minutes for initial 10-year scan
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

    // 10 years back
    const afterDate = new Date();
    afterDate.setFullYear(afterDate.getFullYear() - 10);

    console.log(`[scan/initial] Full scan for ${session.user?.email} since ${afterDate.toISOString().split("T")[0]}`);

    const emails = await scanAmazonEmails(session.access_token, afterDate, 2000);
    console.log(`[scan/initial] Found ${emails.length} Amazon order emails`);

    const orders = parseAmazonEmails(emails);
    console.log(`[scan/initial] Parsed ${orders.length} orders`);

    let created = 0;
    let skipped = 0;
    let itemsCreated = 0;

    for (const order of orders) {
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
    });
  } catch (error) {
    console.error("[scan/initial] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Initial scan failed" },
      { status: 500 }
    );
  }
}
