import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ itemName: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { itemName } = await params;
  const decodedName = decodeURIComponent(itemName).toLowerCase();
  const db = getDb();

  try {
    const history = await db.execute({
      sql: `SELECT aoi.name, aoi.price, aoi.quantity, aoi.productUrl,
                   ao.orderDate, ao.orderNumber
            FROM AmazonOrderItem aoi
            JOIN AmazonOrder ao ON aoi.orderId = ao.id
            WHERE aoi.nameLower LIKE ?
            ORDER BY ao.orderDate ASC`,
      args: [`%${decodedName}%`],
    });

    return NextResponse.json({
      name: decodedName,
      history: history.rows.map((row) => ({
        name: row.name,
        price: row.price,
        quantity: row.quantity,
        productUrl: row.productUrl,
        orderDate: row.orderDate,
        orderNumber: row.orderNumber,
      })),
    });
  } catch (error) {
    console.error("[history] Error:", error);
    return NextResponse.json({ error: "Failed to fetch history" }, { status: 500 });
  }
}
