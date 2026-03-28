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

const ORDER_NUMBER_PATTERN = /(\d{3}-\d{7}-\d{7})/g;

function extractOrderDate(dateHeader: string): Date {
  const parsed = new Date(dateHeader);
  if (!isNaN(parsed.getTime())) return parsed;
  return new Date();
}

/**
 * Split a multi-order email into sections, each with its own order number and items.
 *
 * Amazon sometimes batches multiple orders into a single email. The text body looks like:
 *
 *   Order #
 *   111-1234567-1234567
 *   ...
 *   * Item A
 *   * Item B
 *
 *   Order #
 *   111-9999999-9999999
 *   ...
 *   * Item C
 *
 * We split by "Order #" boundaries to map items to the correct order.
 */
function extractOrderSectionsFromText(text: string): { orderNumber: string; items: ParsedOrderItem[] }[] {
  const orders: { orderNumber: string; items: ParsedOrderItem[] }[] = [];
  const lines = text.split("\n").map((l) => l.trim());

  let currentOrderNumber: string | null = null;
  let currentItems: ParsedOrderItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect order number — could be on same line or next line after "Order #"
    if (/^Order\s*#/i.test(line)) {
      // Check if order number is on this line
      const sameLineMatch = line.match(/(\d{3}-\d{7}-\d{7})/);
      if (sameLineMatch) {
        // Save previous order if any
        if (currentOrderNumber && currentItems.length > 0) {
          orders.push({ orderNumber: currentOrderNumber, items: [...currentItems] });
        }
        currentOrderNumber = sameLineMatch[1];
        currentItems = [];
        continue;
      }

      // Check next line for order number
      if (i + 1 < lines.length) {
        const nextLineMatch = lines[i + 1].match(/(\d{3}-\d{7}-\d{7})/);
        if (nextLineMatch) {
          // Save previous order if any
          if (currentOrderNumber && currentItems.length > 0) {
            orders.push({ orderNumber: currentOrderNumber, items: [...currentItems] });
          }
          currentOrderNumber = nextLineMatch[1];
          currentItems = [];
          i++; // skip the order number line
          continue;
        }
      }
    }

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

        // Stop if we hit another item or a section break
        if (nextLine.startsWith("* ") || nextLine.startsWith("Grand Total") || nextLine.startsWith("Total") || /^Order\s*#/i.test(nextLine)) break;
      }

      currentItems.push({
        name: decodeHtmlEntities(name),
        price,
        quantity,
        productUrl: null,
        imageUrl: null,
      });
    }
  }

  // Don't forget the last order
  if (currentOrderNumber && currentItems.length > 0) {
    orders.push({ orderNumber: currentOrderNumber, items: currentItems });
  }

  return orders;
}

/**
 * Legacy fallback: extract all items from text without order association
 */
function extractItemsFromText(text: string): ParsedOrderItem[] {
  const items: ParsedOrderItem[] = [];
  const lines = text.split("\n").map((l) => l.trim());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("* ")) {
      const name = line.substring(2).trim();
      if (!name || name.length < 3) continue;
      if (/^(view|track|manage|return|cancel|buy it again)/i.test(name)) continue;

      let quantity = 1;
      let price: number | null = null;

      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const nextLine = lines[j];
        const qtyMatch = nextLine.match(/quantity:\s*(\d+)/i);
        if (qtyMatch) quantity = parseInt(qtyMatch[1]);
        const priceMatch = nextLine.match(/(\d+\.\d{2})\s*USD/i);
        if (priceMatch) price = Math.round(parseFloat(priceMatch[1]) * 100);
        if (nextLine.startsWith("* ") || nextLine.startsWith("Grand Total") || nextLine.startsWith("Total")) break;
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
    if (u.pathname === "/gp/r.html" || u.pathname === "/gp/r.html/") {
      const destination = u.searchParams.get("U");
      if (destination) return destination;
    }
    return href;
  } catch {
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

  const linkRegex = /href="([^"]*amazon\.com[^"]*)"[^>]*>([^<]+)/gi;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    const rawUrl = match[1].replace(/&amp;/g, "&");
    const text = match[2].trim();

    if (text.length < 3) continue;
    if (/view order|track|manage|return|cancel|write a review|buy it again|your orders|your account|buy again/i.test(text)) continue;

    const resolvedUrl = resolveAmazonRedirect(rawUrl);

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
    if (!/\._S[SX](?:40|20|16)_/.test(url)) {
      images.push(url);
    }
  }

  return images;
}

/**
 * Fallback: extract item name from email subject line
 */
function extractItemFromSubject(subject: string): ParsedOrderItem | null {
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

  // Try: order of "Item Name..." or order of Item Name
  const ofMatch = subject.match(/order of\s+"?(.+?)(?:\s*\(#|$)/i);
  if (ofMatch) {
    const name = ofMatch[1]
      .replace(/^["']|["']\.?$/g, "")  // strip surrounding quotes and trailing dot
      .replace(/\.{3}$/, "")            // strip trailing ellipsis
      .trim();
    if (name.length >= 3) {
      return {
        name,
        price: null,
        quantity: 1,
        productUrl: null,
        imageUrl: null,
      };
    }
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

/**
 * Enrich items with product URLs and images from the HTML body
 */
function enrichItemsFromHtml(items: ParsedOrderItem[], html: string | null): void {
  if (!html) return;

  const urls = extractProductUrls(html);
  const images = extractProductImages(html);

  for (let i = 0; i < items.length; i++) {
    // Try to match item name to a product URL
    if (!items[i].productUrl || items[i].productUrl?.includes("/s?k=")) {
      const itemLower = items[i].name.toLowerCase();
      for (const [text, url] of urls) {
        if (itemLower.includes(text) || text.includes(itemLower)) {
          items[i].productUrl = url;
          break;
        }
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

/**
 * Parse a single Amazon email. Returns one or more orders since
 * Amazon sometimes batches multiple orders into a single email.
 */
export function parseAmazonEmail(email: ParsedEmail): ParsedOrder[] {
  try {
    const orderDate = extractOrderDate(email.date);
    const results: ParsedOrder[] = [];

    // Strategy 1: Split by order sections in plain text (handles multi-order emails)
    if (email.textBody) {
      const sections = extractOrderSectionsFromText(email.textBody);

      if (sections.length > 0) {
        for (const section of sections) {
          enrichItemsFromHtml(section.items, email.htmlBody);
          results.push({
            emailId: email.id,
            orderNumber: section.orderNumber,
            orderDate,
            items: section.items,
            rawEmailBody: email.htmlBody ?? email.textBody,
          });
        }
        return results;
      }
    }

    // Strategy 2: If no sections found, try flat item extraction
    let items: ParsedOrderItem[] = [];
    if (email.textBody) {
      items = extractItemsFromText(email.textBody);
    }

    // Strategy 3: Fall back to subject line (before HTML, since old-format
    // emails have recommendation links in HTML that aren't order items)
    if (items.length === 0) {
      const subjectItem = extractItemFromSubject(email.subject);
      if (subjectItem) items.push(subjectItem);
    }

    // Strategy 4: If still nothing, try HTML product links as last resort
    // (risky — may pick up recommendation widgets, so only use if subject also failed)
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

    if (items.length === 0) {
      console.warn(`[parser] No items found in email ${email.id}: ${email.subject}`);
      return [];
    }

    // Enrich with URLs and images
    enrichItemsFromHtml(items, email.htmlBody);

    // Extract first order number from any source
    const orderNumberMatch = (email.textBody ?? email.htmlBody ?? email.subject).match(/(\d{3}-\d{7}-\d{7})/);
    const orderNumber = orderNumberMatch ? orderNumberMatch[1] : null;

    results.push({
      emailId: email.id,
      orderNumber,
      orderDate,
      items,
      rawEmailBody: email.htmlBody ?? email.textBody,
    });

    return results;
  } catch (error) {
    console.error(`[parser] Failed to parse email ${email.id}:`, error);
    return [];
  }
}

export function parseAmazonEmails(emails: ParsedEmail[]): ParsedOrder[] {
  const orders: ParsedOrder[] = [];
  for (const email of emails) {
    const parsed = parseAmazonEmail(email);
    orders.push(...parsed);
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
