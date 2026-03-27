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

function extractOrderNumber(subject: string, text: string | null, html: string | null): string | null {
  // Amazon order number format: 111-1234567-1234567
  const pattern = /(\d{3}-\d{7}-\d{7})/;

  const subjectMatch = subject.match(pattern);
  if (subjectMatch) return subjectMatch[1];

  if (text) {
    const textMatch = text.match(pattern);
    if (textMatch) return textMatch[1];
  }

  if (html) {
    const htmlMatch = html.match(pattern);
    if (htmlMatch) return htmlMatch[1];
  }

  return null;
}

function extractOrderDate(dateHeader: string): Date {
  const parsed = new Date(dateHeader);
  if (!isNaN(parsed.getTime())) return parsed;
  return new Date();
}

/**
 * Primary parser: extract items from plain text body.
 * Amazon order emails use this format:
 *
 * * Item Name Here
 *   Quantity: 1
 *   8.27 USD
 */
function extractItemsFromText(text: string): ParsedOrderItem[] {
  const items: ParsedOrderItem[] = [];

  // Pattern: lines starting with "* " are item names
  // Followed by optional "Quantity: N" and "X.XX USD" lines
  const lines = text.split("\n").map((l) => l.trim());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match item lines starting with "* "
    if (line.startsWith("* ")) {
      const name = line.substring(2).trim();
      if (!name || name.length < 3) continue;

      // Skip generic lines
      if (/^(view|track|manage|return|cancel|buy it again)/i.test(name)) continue;

      let quantity = 1;
      let price: number | null = null;

      // Look at the next few lines for quantity and price
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const nextLine = lines[j];

        // Check for quantity
        const qtyMatch = nextLine.match(/quantity:\s*(\d+)/i);
        if (qtyMatch) {
          quantity = parseInt(qtyMatch[1]);
        }

        // Check for price (X.XX USD)
        const priceMatch = nextLine.match(/(\d+\.\d{2})\s*USD/i);
        if (priceMatch) {
          price = Math.round(parseFloat(priceMatch[1]) * 100);
        }

        // Stop if we hit another item or a blank section
        if (nextLine.startsWith("* ") || nextLine.startsWith("Grand Total")) break;
      }

      items.push({
        name: decodeHtmlEntities(name),
        price,
        quantity,
        productUrl: null,
        imageUrl: null,
      });
    }
  }

  return items;
}

/**
 * Resolve an Amazon redirect URL to the actual destination.
 * Amazon wraps all email links through /gp/r.html?...&U=encoded_url
 */
function resolveAmazonRedirect(href: string): string {
  try {
    const u = new URL(href);
    // Check for redirect wrapper: /gp/r.html with U= param
    if (u.pathname === "/gp/r.html" || u.pathname === "/gp/r.html/") {
      const destination = u.searchParams.get("U");
      if (destination) return destination;
    }
    return href;
  } catch {
    // Try to extract U= parameter with regex as fallback
    const uMatch = href.match(/[&?]U=(https?%3A%2F%2F[^&]+)/i);
    if (uMatch) return decodeURIComponent(uMatch[1]);
    return href;
  }
}

/**
 * Extract product URLs from HTML body — look for /dp/ASIN or /gp/product/ASIN links.
 * Amazon wraps all links through /gp/r.html redirects, so we resolve those first.
 */
function extractProductUrls(html: string): Map<string, string> {
  const urlMap = new Map<string, string>();

  // Find all href links with their anchor text
  const linkRegex = /href="([^"]*amazon\.com[^"]*)"[^>]*>([^<]+)/gi;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    const rawUrl = match[1].replace(/&amp;/g, "&");
    const text = match[2].trim();

    if (text.length < 3) continue;
    if (/view order|track|manage|return|cancel|write a review|buy it again|your orders|your account|buy again/i.test(text)) continue;

    // Resolve redirect to get the actual URL
    const resolvedUrl = resolveAmazonRedirect(rawUrl);

    // Check if the resolved URL contains a product identifier
    if (/\/dp\/[A-Z0-9]{10}|\/gp\/product\/[A-Z0-9]{10}/i.test(resolvedUrl)) {
      const cleanUrl = cleanAmazonUrl(resolvedUrl);
      urlMap.set(text.toLowerCase(), cleanUrl);
    }
  }

  return urlMap;
}

/**
 * Extract product images from HTML body
 */
function extractProductImages(html: string): string[] {
  const images: string[] = [];
  const imgRegex = /src="(https?:\/\/(?:m\.media-amazon|images-na\.ssl-images-amazon|images-eu\.ssl-images-amazon)\.com\/images\/[^"]+)"/gi;
  let match;

  while ((match = imgRegex.exec(html)) !== null) {
    const url = match[1];
    // Skip tiny images (spacers, icons)
    if (!/\._S[SX](?:40|20|16)_/.test(url)) {
      images.push(url);
    }
  }

  return images;
}

/**
 * Fallback: extract item name from email subject line
 * Subject formats:
 * - 'Ordered: "Item Name..."'
 * - 'Ordered: 3 "Item Name..."'
 * - 'Your Amazon.com order of Item Name (#111-...)'
 */
function extractItemFromSubject(subject: string): ParsedOrderItem | null {
  // Try: Ordered: "Item Name..."
  const quotedMatch = subject.match(/Ordered:?\s*(?:\d+\s+)?"([^"]+)/i);
  if (quotedMatch) {
    return {
      name: quotedMatch[1].replace(/\.{3}$/, "").trim(),
      price: null,
      quantity: 1,
      productUrl: null,
      imageUrl: null,
    };
  }

  // Try: order of Item Name
  const ofMatch = subject.match(/order of (.+?)(?:\s*\(#|$)/i);
  if (ofMatch) {
    return {
      name: ofMatch[1].trim(),
      price: null,
      quantity: 1,
      productUrl: null,
      imageUrl: null,
    };
  }

  return null;
}

function cleanAmazonUrl(url: string): string {
  try {
    const u = new URL(url);
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
    .replace(/®/g, "®")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseAmazonEmail(email: ParsedEmail): ParsedOrder | null {
  try {
    const orderNumber = extractOrderNumber(email.subject, email.textBody, email.htmlBody);
    const orderDate = extractOrderDate(email.date);

    // Strategy 1: Parse from plain text body (most reliable for modern Amazon emails)
    let items: ParsedOrderItem[] = [];
    if (email.textBody) {
      items = extractItemsFromText(email.textBody);
    }

    // Strategy 2: If no items from text, try HTML product links
    if (items.length === 0 && email.htmlBody) {
      const urls = extractProductUrls(email.htmlBody);
      for (const [text, url] of urls) {
        items.push({
          name: text,
          price: null,
          quantity: 1,
          productUrl: url,
          imageUrl: null,
        });
      }
    }

    // Strategy 3: Fall back to subject line
    if (items.length === 0) {
      const subjectItem = extractItemFromSubject(email.subject);
      if (subjectItem) items.push(subjectItem);
    }

    if (items.length === 0) {
      console.warn(`[parser] No items found in email ${email.id}: ${email.subject}`);
      return null;
    }

    // Enrich with URLs and images from HTML
    if (email.htmlBody) {
      const urls = extractProductUrls(email.htmlBody);
      const images = extractProductImages(email.htmlBody);

      for (let i = 0; i < items.length; i++) {
        // Try to match item name to a product URL
        if (!items[i].productUrl || items[i].productUrl?.includes("/s?k=")) {
          const itemLower = items[i].name.toLowerCase();
          for (const [text, url] of urls) {
            // Exact or substring match
            if (itemLower.includes(text) || text.includes(itemLower)) {
              items[i].productUrl = url;
              break;
            }
            // Word overlap match — if 3+ words match, consider it the same product
            const itemWords = new Set(itemLower.split(/\s+/).filter(w => w.length > 2));
            const linkWords = text.split(/\s+/).filter(w => w.length > 2);
            const overlap = linkWords.filter(w => itemWords.has(w)).length;
            if (overlap >= 3 || (overlap >= 2 && linkWords.length <= 4)) {
              items[i].productUrl = url;
              break;
            }
          }
        }

        // If only one item and one URL, just assign it
        if (items.length === 1 && urls.size >= 1 && (!items[i].productUrl || items[i].productUrl?.includes("/s?k="))) {
          items[i].productUrl = urls.values().next().value!;
        }

        // Assign images in order
        if (!items[i].imageUrl && i < images.length) {
          items[i].imageUrl = images[i];
        }
      }

      // Fallback: generate Amazon search URL for the product name
      for (const item of items) {
        if (!item.productUrl) {
          item.productUrl = `https://www.amazon.com/s?k=${encodeURIComponent(item.name)}`;
        }
      }
    }

    return {
      emailId: email.id,
      orderNumber,
      orderDate,
      items,
      rawEmailBody: email.htmlBody ?? email.textBody,
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
  try {
    const u = new URL(productUrl);
    return `amazon://${u.pathname}`;
  } catch {
    return productUrl;
  }
}
