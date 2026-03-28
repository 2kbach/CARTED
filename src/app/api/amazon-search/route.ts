import { NextResponse } from "next/server";
import { auth } from "@/auth";

const CANOPY_API = "https://rest.canopyapi.co/api/amazon/search";

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

  const apiKey = process.env.CANOPY_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ products: [] });
  }

  try {
    const params = new URLSearchParams({
      searchTerm: query.trim(),
      limit: "5",
    });

    const res = await fetch(`${CANOPY_API}?${params}`, {
      headers: { "API-KEY": apiKey },
    });

    if (!res.ok) {
      console.error("[amazon-search] Canopy API error:", res.status);
      return NextResponse.json({ products: [] });
    }

    const data = await res.json();
    const results = data?.data?.amazonProductSearchResults?.productResults?.results ?? [];

    const products = results
      .filter((p: Record<string, unknown>) => !p.sponsored)
      .slice(0, 5)
      .map((p: Record<string, unknown>) => ({
        asin: p.asin,
        title: p.title,
        url: `https://www.amazon.com/dp/${p.asin}?tag=${process.env.AMAZON_ASSOCIATE_TAG ?? ""}`,
        imageUrl: p.mainImageUrl,
        price: (p.price as Record<string, unknown>)?.display ?? null,
        rating: p.rating,
        ratingsTotal: p.ratingsTotal,
      }));

    return NextResponse.json({ products });
  } catch (error) {
    console.error("[amazon-search] Error:", error);
    return NextResponse.json({ products: [] });
  }
}
