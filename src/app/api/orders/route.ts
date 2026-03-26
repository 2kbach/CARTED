import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/lib/db";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.toLowerCase().trim();
  const page = parseInt(url.searchParams.get("page") ?? "1");
  const limit = 50;
  const offset = (page - 1) * limit;

  const db = getDb();

  try {
    let items;
    if (q) {
      items = await db.execute({
        sql: `SELECT aoi.id, aoi.name, aoi.price, aoi.quantity, aoi.productUrl, aoi.imageUrl,
                     ao.orderDate, ao.orderNumber
              FROM AmazonOrderItem aoi
              JOIN AmazonOrder ao ON aoi.orderId = ao.id
              WHERE aoi.nameLower LIKE ?
              ORDER BY ao.orderDate DESC
              LIMIT ? OFFSET ?`,
        args: [`%${q}%`, limit, offset],
      });
    } else {
      items = await db.execute({
        sql: `SELECT aoi.id, aoi.name, aoi.price, aoi.quantity, aoi.productUrl, aoi.imageUrl,
                     ao.orderDate, ao.orderNumber
              FROM AmazonOrderItem aoi
              JOIN AmazonOrder ao ON aoi.orderId = ao.id
              ORDER BY ao.orderDate DESC
              LIMIT ? OFFSET ?`,
        args: [limit, offset],
      });
    }

    return NextResponse.json({
      items: items.rows.map((row) => ({
        id: row.id,
        name: row.name,
        price: row.price,
        quantity: row.quantity,
        productUrl: row.productUrl,
        imageUrl: row.imageUrl,
        orderDate: row.orderDate,
        orderNumber: row.orderNumber,
      })),
      page,
    });
  } catch (error) {
    console.error("[orders] Error:", error);
    return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
  }
}
