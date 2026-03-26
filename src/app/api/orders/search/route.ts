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

  if (!q || q.length < 2) {
    return NextResponse.json({ items: [] });
  }

  const db = getDb();

  try {
    // Search order items by name — group by nameLower to deduplicate, show most recent
    const results = await db.execute({
      sql: `SELECT
              aoi.name,
              aoi.nameLower,
              aoi.productUrl,
              aoi.imageUrl,
              aoi.price,
              ao.orderDate,
              COUNT(*) as purchaseCount,
              MIN(aoi.price) as minPrice,
              MAX(aoi.price) as maxPrice
            FROM AmazonOrderItem aoi
            JOIN AmazonOrder ao ON aoi.orderId = ao.id
            WHERE aoi.nameLower LIKE ?
            GROUP BY aoi.nameLower
            ORDER BY ao.orderDate DESC
            LIMIT 10`,
      args: [`%${q}%`],
    });

    const items = results.rows.map((row) => ({
      name: row.name as string,
      productUrl: row.productUrl as string | null,
      imageUrl: row.imageUrl as string | null,
      lastPrice: row.price as number | null,
      lastOrderDate: row.orderDate as string,
      purchaseCount: row.purchaseCount as number,
      minPrice: row.minPrice as number | null,
      maxPrice: row.maxPrice as number | null,
    }));

    return NextResponse.json({ items });
  } catch (error) {
    console.error("[search] Error:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
