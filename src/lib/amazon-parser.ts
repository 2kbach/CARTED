import type { ParsedEmail } from "./gmail";

export interface ParsedOrderItem {
  name: string;
  price: number | null; // cents
  quantity: number;
  productUrl: string | null;
  imageUrl: string | null;
}

export interface ParsedOrder {
  emailId: string;
  orderNumber: string | null;
  orderDate: Date;
  items: ParsedOrderItem[];
  rawEmailBody: string | null;
}

function extractOrderNumber(subject: string, html: string | null): string | null {
  // Try subject line first: "Your Amazon.com order of ... (#111-1234567-1234567)"
  const subjectMatch = subject.match(/#(\d{3}-\d{7}-\d{7})/);
  if (subjectMatch) return subjectMatch[1];

  // Try HTML body
  if (html) {
    const htmlMatch = html.match(/(\d{3}-\d{7}-\d{7})/);
    if (htmlMatch) return htmlMatch[1];
  }

  return null;
}

function extractOrderDate(dateHeader: string): Date {
  const parsed = new Date(dateHeader);
  if (!isNaN(parsed.getTime())) return parsed;
  return new Date();
}

function extractItems(html: string | null, subject: string): ParsedOrderItem[] {
  if (!html) {
    // Fallback: extract item name from subject
    // Subject format: "Your Amazon.com order of [Item Name]..."
    const subjectMatch = subject.match(/order of (.+?)(?:\s*\(#|$)/i);
    const name = subjectMatch ? subjectMatch[1].trim() : subject.replace(/^.*?Ordered:\s*/i, "").trim();
    return name
      ? [{ name, price: null, quantity: 1, productUrl: null, imageUrl: null }]
      : [];
  }

  const items: ParsedOrderItem[] = [];

  // Strategy 1: Look for product links with nearby text
  // Amazon order emails typically have product links like /gp/product/ or /dp/
  const productLinkRegex = /href="(https?:\/\/(?:www\.)?amazon\.com\/[^"]*(?:\/gp\/product\/|\/dp\/)[^"]*)"[^>]*>([^<]+)/gi;
  let match;

  while ((match = productLinkRegex.exec(html)) !== null) {
    const url = match[1];
    let name = match[2].trim();

    // Skip generic links like "View order", "Track package"
    if (
      /view order|track|manage|return|cancel|write a review|buy it again/i.test(name) ||
      name.length < 3
    ) {
      continue;
    }

    // Clean up HTML entities
    name = decodeHtmlEntities(name);

    // Check for duplicates
    if (items.some((i) => i.productUrl === url)) continue;

    items.push({
      name,
      price: null,
      quantity: 1,
      productUrl: cleanAmazonUrl(url),
      imageUrl: null,
    });
  }

  // Strategy 2: If no product links found, try to extract from structured data
  if (items.length === 0) {
    // Look for item names near price patterns
    const itemBlockRegex = /(?:itemName|product[_-]?name|item[_-]?title)[^>]*>([^<]{5,100})</gi;
    while ((match = itemBlockRegex.exec(html)) !== null) {
      const name = decodeHtmlEntities(match[1].trim());
      if (name && !items.some((i) => i.name === name)) {
        items.push({
          name,
          price: null,
          quantity: 1,
          productUrl: null,
          imageUrl: null,
        });
      }
    }
  }

  // Strategy 3: Fall back to subject line extraction
  if (items.length === 0) {
    const subjectMatch = subject.match(/order of (.+?)(?:\s*\(#|$)/i);
    if (subjectMatch) {
      items.push({
        name: subjectMatch[1].trim(),
        price: null,
        quantity: 1,
        productUrl: null,
        imageUrl: null,
      });
    }
  }

  // Extract prices — look for $X.XX patterns near items
  extractPrices(html, items);

  // Extract quantities
  extractQuantities(html, items);

  // Extract image URLs
  extractImages(html, items);

  return items;
}

function extractPrices(html: string, items: ParsedOrderItem[]): void {
  // Look for price patterns: $12.99
  const priceRegex = /\$(\d{1,5})\.(\d{2})/g;
  const prices: number[] = [];
  let match;

  while ((match = priceRegex.exec(html)) !== null) {
    const dollars = parseInt(match[1]);
    const cents = parseInt(match[2]);
    const total = dollars * 100 + cents;
    // Skip very small amounts (likely tax/shipping) and very large (likely totals)
    if (total >= 100 && total <= 200000) {
      prices.push(total);
    }
  }

  // Assign prices to items if we have a reasonable match
  // For single-item orders, the most common price is likely the item price
  if (items.length === 1 && prices.length > 0) {
    // Use the first price found (usually the item price in Amazon emails)
    items[0].price = prices[0];
  } else if (items.length > 0 && prices.length >= items.length) {
    // Try to assign first N prices to N items
    for (let i = 0; i < items.length && i < prices.length; i++) {
      items[i].price = prices[i];
    }
  }
}

function extractQuantities(html: string, items: ParsedOrderItem[]): void {
  // Look for "Qty: X" or "Quantity: X" patterns
  const qtyRegex = /(?:qty|quantity)\s*:?\s*(\d+)/gi;
  const quantities: number[] = [];
  let match;

  while ((match = qtyRegex.exec(html)) !== null) {
    quantities.push(parseInt(match[1]));
  }

  for (let i = 0; i < items.length && i < quantities.length; i++) {
    items[i].quantity = quantities[i];
  }
}

function extractImages(html: string, items: ParsedOrderItem[]): void {
  // Look for product images (Amazon CDN)
  const imgRegex = /src="(https?:\/\/(?:m\.media-amazon|images-na\.ssl-images-amazon|images-eu\.ssl-images-amazon)\.com\/images\/[^"]+)"/gi;
  const images: string[] = [];
  let match;

  while ((match = imgRegex.exec(html)) !== null) {
    const url = match[1];
    // Skip tiny images (spacers, icons)
    if (!/\._S[SX](?:40|20|16)_/.test(url)) {
      images.push(url);
    }
  }

  for (let i = 0; i < items.length && i < images.length; i++) {
    items[i].imageUrl = images[i];
  }
}

function cleanAmazonUrl(url: string): string {
  try {
    const u = new URL(url);
    // Keep just the product path, strip tracking params
    const pathMatch = u.pathname.match(/(\/(?:dp|gp\/product)\/[A-Z0-9]{10})/);
    if (pathMatch) {
      return `https://www.amazon.com${pathMatch[1]}`;
    }
    return url;
  } catch {
    return url;
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseAmazonEmail(email: ParsedEmail): ParsedOrder | null {
  try {
    const orderNumber = extractOrderNumber(email.subject, email.htmlBody);
    const orderDate = extractOrderDate(email.date);
    const items = extractItems(email.htmlBody, email.subject);

    if (items.length === 0) {
      console.warn(`[parser] No items found in email ${email.id}: ${email.subject}`);
      return null;
    }

    return {
      emailId: email.id,
      orderNumber,
      orderDate,
      items,
      rawEmailBody: email.htmlBody,
    };
  } catch (error) {
    console.error(`[parser] Failed to parse email ${email.id}:`, error);
    return null;
  }
}

export function parseAmazonEmails(emails: ParsedEmail[]): ParsedOrder[] {
  const orders: ParsedOrder[] = [];
  for (const email of emails) {
    const order = parseAmazonEmail(email);
    if (order) orders.push(order);
  }
  return orders;
}

/** Generate an Amazon deep link that opens the app on iOS */
export function getAmazonAppLink(productUrl: string): string {
  // On iOS, amazon:// scheme opens the Amazon app
  // Fallback to web URL if app not installed
  try {
    const u = new URL(productUrl);
    return `amazon://${u.pathname}`;
  } catch {
    return productUrl;
  }
}
