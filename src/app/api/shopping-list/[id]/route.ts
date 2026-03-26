import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/lib/db";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { isCompleted } = body;

  if (typeof isCompleted !== "boolean") {
    return NextResponse.json({ error: "isCompleted must be boolean" }, { status: 400 });
  }

  const db = getDb();

  try {
    const now = new Date().toISOString();

    await db.execute({
      sql: `UPDATE ShoppingListItem
            SET isCompleted = ?, completedAt = ?, completedByOrderId = NULL, updatedAt = ?
            WHERE id = ?`,
      args: [isCompleted ? 1 : 0, isCompleted ? now : null, now, id],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[shopping-list] Error:", error);
    return NextResponse.json({ error: "Failed to update item" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const db = getDb();

  try {
    await db.execute({
      sql: "DELETE FROM ShoppingListItem WHERE id = ?",
      args: [id],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[shopping-list] Error:", error);
    return NextResponse.json({ error: "Failed to delete item" }, { status: 500 });
  }
}
