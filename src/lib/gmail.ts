const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

interface GmailMessage {
  id: string;
  threadId: string;
}

interface GmailListResponse {
  messages?: GmailMessage[];
  nextPageToken?: string;
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailMessagePart {
  mimeType: string;
  body: { data?: string; size: number };
  parts?: GmailMessagePart[];
}

interface GmailFullMessage {
  id: string;
  threadId: string;
  snippet: string;
  internalDate: string;
  payload: {
    headers: GmailHeader[];
    mimeType: string;
    body: { data?: string; size: number };
    parts?: GmailMessagePart[];
  };
}

function getHeader(headers: GmailHeader[], name: string): string | undefined {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())
    ?.value;
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

function findPartByMimeType(
  part: GmailMessagePart | GmailFullMessage["payload"],
  mimeType: string
): string | null {
  if (part.mimeType === mimeType && part.body.data) {
    return decodeBase64Url(part.body.data);
  }
  if (part.parts) {
    for (const subPart of part.parts) {
      const result = findPartByMimeType(subPart, mimeType);
      if (result) return result;
    }
  }
  return null;
}

export interface ParsedEmail {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  textBody: string | null;
  htmlBody: string | null;
}

function buildAmazonSearchQuery(afterDate?: Date): string {
  let query = "from:auto-confirm@amazon.com subject:Ordered";
  if (afterDate) {
    const formatted = afterDate.toISOString().split("T")[0].replace(/-/g, "/");
    query += ` after:${formatted}`;
  }
  return query;
}

export async function searchAmazonEmails(
  accessToken: string,
  afterDate?: Date,
  maxResults: number = 500
): Promise<GmailMessage[]> {
  const query = buildAmazonSearchQuery(afterDate);
  const allMessages: GmailMessage[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: query,
      maxResults: Math.min(maxResults - allMessages.length, 500).toString(),
    });
    if (pageToken) params.set("pageToken", pageToken);

    const response = await fetch(`${GMAIL_API}/messages?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Gmail API error: ${JSON.stringify(error)}`);
    }

    const data: GmailListResponse = await response.json();
    if (data.messages) allMessages.push(...data.messages);
    pageToken = data.nextPageToken;
  } while (pageToken && allMessages.length < maxResults);

  return allMessages;
}

export async function fetchEmailContent(
  accessToken: string,
  messageId: string
): Promise<ParsedEmail> {
  const response = await fetch(
    `${GMAIL_API}/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Gmail API error: ${JSON.stringify(error)}`);
  }

  const message: GmailFullMessage = await response.json();
  const headers = message.payload.headers;

  return {
    id: message.id,
    subject: getHeader(headers, "Subject") ?? "(no subject)",
    from: getHeader(headers, "From") ?? "",
    date: getHeader(headers, "Date") ?? "",
    snippet: message.snippet,
    textBody: findPartByMimeType(message.payload, "text/plain"),
    htmlBody: findPartByMimeType(message.payload, "text/html"),
  };
}

export async function scanAmazonEmails(
  accessToken: string,
  afterDate?: Date,
  maxResults: number = 500
): Promise<ParsedEmail[]> {
  const messages = await searchAmazonEmails(accessToken, afterDate, maxResults);

  const emails: ParsedEmail[] = [];
  // Batch fetch to avoid rate limits — 5 concurrent
  const batchSize = 5;
  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map((msg) => fetchEmailContent(accessToken, msg.id))
    );
    for (const result of results) {
      if (result.status === "fulfilled") {
        emails.push(result.value);
      } else {
        console.error("Failed to fetch email:", result.reason);
      }
    }
  }

  return emails;
}
