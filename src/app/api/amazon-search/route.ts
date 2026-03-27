import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { searchAmazonProducts } from "@/lib/amazon-api";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");

  if (!query || query.trim().length < 2) {
    return NextResponse.json({ products: [] });
  }

  try {
    const products = await searchAmazonProducts(query.trim(), 5);
    return NextResponse.json({ products });
  } catch (error) {
    console.error("[amazon-search] Error:", error);
    return NextResponse.json(
      { error: "Failed to search Amazon", products: [] },
      { status: 500 }
    );
  }
}
