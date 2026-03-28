import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { searchAmazonEmails, fetchEmailContent } from "@/lib/gmail";
import { parseAmazonEmails } from "@/lib/amazon-parser";
import { generateId } from "@/lib/pair-code";

// Vercel hobby = 10s, pro = 60s. Process emails in small batches per request.
export const maxDuration = 60;

const BATCH_SIZE = 15; // emails per request

export async function POST(request: Request) {
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

    // Get pagination params from request body
    let pageToken: string | undefined;
    let totalFound = 0;
    try {
      const body = await request.json();
      pageToken = body.pageToken;
      totalFound = body.totalFound ?? 0;
    } catch {
      // First request — no body
    }

    // 10 years back
    const afterDate = new Date();
    afterDate.setFullYear(afterDate.getFullYear() - 10);

    const query = `from:auto-confirm@amazon.com {subject:Ordered subject:(Your Amazon.com order)} after:${afterDate.toISOString().split("T")[0].replace(/-/g, "/")}`;

    // Fetch one page of message IDs
    const params = new URLSearchParams({
      q: query,
      maxResults: BATCH_SIZE.toString(),
    });
    if (pageToken) params.set("pageToken", pageToken);

    const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
    const listRes = await fetch(`${GMAIL_API}/messages?${params}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    if (!listRes.ok) {
      const error = await listRes.json();
      return NextResponse.json({ error: `Gmail error: ${JSON.stringify(error)}` }, { status: 500 });
    }

    const listData = await listRes.json();
    const messages = listData.messages ?? [];
    const nextPageToken = listData.nextPageToken ?? null;

    // Fetch email contents concurrently
    const emailResults = await Promise.allSettled(
      messages.map((msg: { id: string }) => fetchEmailContent(session.access_token!, msg.id))
    );

    const emails = emailResults
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof fetchEmailContent>>> => r.status === "fulfilled")
      .map((r) => r.value);

    // Parse orders
    const orders = parseAmazonEmails(emails);

    let created = 0;
    let skipped = 0;
    let itemsCreated = 0;

    for (const order of orders) {
      // Dedup by order number + email ID combo
      const existing = await db.execute({
        sql: "SELECT id FROM AmazonOrder WHERE sourceEmailId = ? AND orderNumber = ?",
        args: [order.emailId, order.orderNumber],
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
          null, // skip rawEmailBody to save space
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

    const batchTotal = totalFound + messages.length;

    // Update lastScanAt if this is the last batch
    if (!nextPageToken) {
      await db.execute({
        sql: "UPDATE User SET lastScanAt = ?, updatedAt = ? WHERE id = ?",
        args: [new Date().toISOString(), new Date().toISOString(), userId],
      });
    }

    return NextResponse.json({
      success: true,
      emailsInBatch: messages.length,
      totalFound: batchTotal,
      created,
      skipped,
      itemsCreated,
      nextPageToken,
      done: !nextPageToken,
    });
  } catch (error) {
    console.error("[scan/initial] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Scan failed" },
      { status: 500 }
    );
  }
}
