/**
 * Amazon Creators API client (PA-API 5.0 successor)
 * Uses OAuth2 client_credentials flow via Login with Amazon (LwA)
 */

const TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const API_BASE = "https://api.amazon.com/paapi5/searchitems";

// Token cache
let cachedToken: { token: string; expiresAt: number } | null = null;

export interface AmazonProduct {
  asin: string;
  title: string;
  url: string;
  imageUrl: string | null;
  price: string | null;
  priceCents: number | null;
  rating: number | null;
  totalReviews: number | null;
}

async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (with 5 min buffer)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 300_000) {
    return cachedToken.token;
  }

  const clientId = process.env.AMAZON_CLIENT_ID;
  const clientSecret = process.env.AMAZON_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Amazon API credentials not configured");
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "ProductAdvertisingAPI",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("[amazon-api] Token error:", response.status, text);
    throw new Error(`Failed to get Amazon access token: ${response.status}`);
  }

  const data = await response.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return cachedToken.token;
}

/**
 * Search Amazon products using the Creators API / PA-API 5.0
 */
export async function searchAmazonProducts(
  keywords: string,
  maxResults: number = 5
): Promise<AmazonProduct[]> {
  const partnerTag = process.env.AMAZON_ASSOCIATE_TAG;
  if (!partnerTag) throw new Error("AMAZON_ASSOCIATE_TAG not configured");

  const accessToken = await getAccessToken();

  // Try the Creators API endpoint first
  const payload = {
    Keywords: keywords,
    PartnerTag: partnerTag,
    PartnerType: "Associates",
    Marketplace: "www.amazon.com",
    ItemCount: Math.min(maxResults, 10),
    Resources: [
      "Images.Primary.Medium",
      "ItemInfo.Title",
      "Offers.Listings.Price",
      "BrowseNodeInfo.BrowseNodes",
    ],
  };

  const response = await fetch(API_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("[amazon-api] Search error:", response.status, text);

    // If the endpoint doesn't work, try alternate Creators API URL
    return await searchWithCreatorsApi(keywords, maxResults, accessToken, partnerTag);
  }

  const data = await response.json();
  return parseSearchResults(data);
}

/**
 * Try alternate Creators API endpoint format
 */
async function searchWithCreatorsApi(
  keywords: string,
  maxResults: number,
  accessToken: string,
  partnerTag: string
): Promise<AmazonProduct[]> {
  // Creators API v3 uses different endpoint and casing
  const endpoints = [
    "https://api.amazon.com/creatorsapi/paapi/searchitems",
    "https://webservices.amazon.com/paapi5/searchitems",
  ];

  for (const endpoint of endpoints) {
    try {
      // Try PascalCase (PA-API style)
      const payload = {
        Keywords: keywords,
        PartnerTag: partnerTag,
        PartnerType: "Associates",
        Marketplace: "www.amazon.com",
        ItemCount: Math.min(maxResults, 10),
        Resources: [
          "Images.Primary.Medium",
          "ItemInfo.Title",
          "Offers.Listings.Price",
        ],
      };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const data = await response.json();
        return parseSearchResults(data);
      }

      // Try lowerCamelCase (Creators API style)
      const creatorPayload = {
        keywords,
        partnerTag,
        partnerType: "Associates",
        marketplace: "www.amazon.com",
        itemCount: Math.min(maxResults, 10),
        resources: [
          "images.primary.medium",
          "itemInfo.title",
          "offersV2.listings.price",
        ],
      };

      const response2 = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(creatorPayload),
      });

      if (response2.ok) {
        const data = await response2.json();
        return parseSearchResults(data);
      }

      const errorText = await response2.text();
      console.error(`[amazon-api] ${endpoint} failed:`, response2.status, errorText);
    } catch (err) {
      console.error(`[amazon-api] ${endpoint} error:`, err);
    }
  }

  console.warn("[amazon-api] All endpoints failed, returning empty results");
  return [];
}

function parseSearchResults(data: Record<string, unknown>): AmazonProduct[] {
  const products: AmazonProduct[] = [];

  // Handle both PascalCase (PA-API) and lowerCamelCase (Creators API) responses
  const searchResult = (data as Record<string, unknown>).SearchResult ??
    (data as Record<string, unknown>).searchResult;
  if (!searchResult) return [];

  const items = (searchResult as Record<string, unknown>).Items ??
    (searchResult as Record<string, unknown>).items;
  if (!Array.isArray(items)) return [];

  for (const item of items) {
    const asin = item.ASIN ?? item.asin ?? "";
    const detailUrl = item.DetailPageURL ?? item.detailPageURL ?? "";

    // Title
    const itemInfo = item.ItemInfo ?? item.itemInfo;
    const titleObj = itemInfo?.Title ?? itemInfo?.title;
    const title = titleObj?.DisplayValue ?? titleObj?.displayValue ?? "";

    // Image
    const images = item.Images ?? item.images;
    const primaryImage = images?.Primary ?? images?.primary;
    const mediumImage = primaryImage?.Medium ?? primaryImage?.medium;
    const imageUrl = mediumImage?.URL ?? mediumImage?.url ?? null;

    // Price
    const offers = item.Offers ?? item.offers ?? item.OffersV2 ?? item.offersV2;
    let price: string | null = null;
    let priceCents: number | null = null;

    if (offers) {
      const listings = offers.Listings ?? offers.listings;
      if (Array.isArray(listings) && listings.length > 0) {
        const priceObj = listings[0].Price ?? listings[0].price;
        if (priceObj) {
          price = priceObj.DisplayAmount ?? priceObj.displayAmount ?? null;
          const amount = priceObj.Amount ?? priceObj.amount;
          if (amount != null) {
            priceCents = Math.round(parseFloat(amount) * 100);
          }
        }
      }
    }

    if (title && asin) {
      products.push({
        asin,
        title,
        url: detailUrl || `https://www.amazon.com/dp/${asin}?tag=${process.env.AMAZON_ASSOCIATE_TAG}`,
        imageUrl,
        price,
        priceCents,
        rating: null,
        totalReviews: null,
      });
    }
  }

  return products;
}
