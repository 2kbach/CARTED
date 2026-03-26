import { NextResponse } from "next/server";
import { createClient } from "@libsql/client";
import { scanAmazonEmails } from "@/lib/gmail";
import { parseAmazonEmails } from "@/lib/amazon-parser";
import { generateId } from "@/lib/pair-code";

export const maxDuration = 300;

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      console.error(`[cron] Token refresh failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data.access_token ?? null;
  } catch (err) {
    console.error("[cron] Token refresh error:", err);
    return null;
  }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  if (!tursoUrl) {
    return NextResponse.json({ error: "DB not configured" }, { status: 500 });
  }

  const db = createClient({ url: tursoUrl, authToken: tursoToken });

  try {
    // Get users with refresh tokens
    const usersResult = await db.execute({
      sql: "SELECT id, email, accessToken, refreshToken, tokenExpiry, lastScanAt FROM User WHERE refreshToken IS NOT NULL",
      args: [],
    });

    if (usersResult.rows.length === 0) {
      return NextResponse.json({ message: "No users with tokens" });
    }

    const results: Array<{
      email: string;
      scanned: number;
      created: number;
      skipped: number;
      itemsCreated: number;
      autoCompleted: number;
      error?: string;
    }> = [];

    for (const user of usersResult.rows) {
      const email = user.email as string;
      const refreshToken = user.refreshToken as string;
      let accessToken = user.accessToken as string | null;
      const tokenExpiry = user.tokenExpiry as string | null;
      const userId = user.id as string;

      try {
        // Refresh token if expired
        const isExpired =
          !accessToken ||
          !tokenExpiry ||
          new Date(tokenExpiry).getTime() < Date.now() + 5 * 60 * 1000;

        if (isExpired) {
          console.log(`[cron] Refreshing token for ${email}`);
          accessToken = await refreshAccessToken(refreshToken);

          if (!accessToken) {
            results.push({ email, scanned: 0, created: 0, skipped: 0, itemsCreated: 0, autoCompleted: 0, error: "Token refresh failed" });
            continue;
          }

          const newExpiry = new Date(Date.now() + 3600 * 1000).toISOString();
          await db.execute({
            sql: "UPDATE User SET accessToken = ?, tokenExpiry = ?, updatedAt = ? WHERE email = ?",
            args: [accessToken, newExpiry, new Date().toISOString(), email],
          });
        }

        // Scan since last scan (or 7 days)
        const lastScan = user.lastScanAt as string | null;
        const afterDate = lastScan
          ? new Date(new Date(lastScan).getTime() - 1 * 24 * 60 * 60 * 1000)
          : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        console.log(`[cron] Scanning ${email} since ${afterDate.toISOString().split("T")[0]}`);

        const emails = await scanAmazonEmails(accessToken!, afterDate);
        console.log(`[cron] ${email}: ${emails.length} emails found`);

        if (emails.length === 0) {
          results.push({ email, scanned: 0, created: 0, skipped: 0, itemsCreated: 0, autoCompleted: 0 });
          continue;
        }

        const orders = parseAmazonEmails(emails);

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
            args: [orderId, userId, order.emailId, order.orderNumber, order.orderDate.toISOString(), order.rawEmailBody, new Date().toISOString()],
          });

          for (const item of order.items) {
            const itemId = generateId();
            await db.execute({
              sql: `INSERT INTO AmazonOrderItem (id, orderId, name, nameLower, price, quantity, productUrl, imageUrl, createdAt)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              args: [itemId, orderId, item.name, item.name.toLowerCase(), item.price, item.quantity, item.productUrl, item.imageUrl, new Date().toISOString()],
            });
            itemsCreated++;
          }
          created++;
        }

        // Auto-complete shopping list items
        let autoCompleted = 0;
        const uncompleted = await db.execute({
          sql: "SELECT id, name FROM ShoppingListItem WHERE isCompleted = 0",
          args: [],
        });

        for (const item of uncompleted.rows) {
          const itemName = (item.name as string).toLowerCase();
          const match = await db.execute({
            sql: `SELECT ao.id as orderId FROM AmazonOrderItem aoi
                  JOIN AmazonOrder ao ON aoi.orderId = ao.id
                  WHERE aoi.nameLower LIKE ? AND ao.orderDate > ?
                  ORDER BY ao.orderDate DESC LIMIT 1`,
            args: [`%${itemName}%`, afterDate.toISOString()],
          });

          if (match.rows.length > 0) {
            await db.execute({
              sql: `UPDATE ShoppingListItem SET isCompleted = 1, completedAt = ?, completedByOrderId = ?, updatedAt = ? WHERE id = ?`,
              args: [new Date().toISOString(), match.rows[0].orderId as string, new Date().toISOString(), item.id as string],
            });
            autoCompleted++;
          }
        }

        // Update lastScanAt
        await db.execute({
          sql: "UPDATE User SET lastScanAt = ?, updatedAt = ? WHERE id = ?",
          args: [new Date().toISOString(), new Date().toISOString(), userId],
        });

        results.push({ email, scanned: emails.length, created, skipped, itemsCreated, autoCompleted });
        console.log(`[cron] ${email}: ${created} created, ${skipped} skipped, ${itemsCreated} items, ${autoCompleted} auto-completed`);
      } catch (err) {
        console.error(`[cron] Error scanning ${email}:`, err);
        results.push({
          email, scanned: 0, created: 0, skipped: 0, itemsCreated: 0, autoCompleted: 0,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    return NextResponse.json({ success: true, usersScanned: results.length, results });
  } catch (error) {
    console.error("[cron] Fatal error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cron scan failed" },
      { status: 500 }
    );
  }
}
