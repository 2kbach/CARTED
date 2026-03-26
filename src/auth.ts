import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { createClient } from "@libsql/client";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/gmail.readonly",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        if (token.email) {
          try {
            const tursoUrl = process.env.TURSO_DATABASE_URL;
            const tursoToken = process.env.TURSO_AUTH_TOKEN;

            if (tursoUrl) {
              const db = createClient({ url: tursoUrl, authToken: tursoToken });
              const now = new Date().toISOString();
              const tokenExpiry = new Date(
                (account.expires_at as number) * 1000
              ).toISOString();

              const existing = await db.execute({
                sql: "SELECT id FROM User WHERE email = ?",
                args: [token.email as string],
              });

              if (existing.rows.length > 0) {
                await db.execute({
                  sql: `UPDATE User SET name = ?, image = ?, accessToken = ?, refreshToken = ?, tokenExpiry = ?, updatedAt = ? WHERE email = ?`,
                  args: [
                    (token.name as string) ?? null,
                    (token.picture as string) ?? null,
                    account.access_token as string,
                    account.refresh_token as string,
                    tokenExpiry,
                    now,
                    token.email as string,
                  ],
                });
              } else {
                const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
                const timestamp = Date.now().toString(36);
                let random = "";
                for (let i = 0; i < 12; i++) {
                  random += chars[Math.floor(Math.random() * chars.length)];
                }
                const id = `c${timestamp}${random}`;

                await db.execute({
                  sql: `INSERT INTO User (id, email, name, image, accessToken, refreshToken, tokenExpiry, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  args: [
                    id,
                    token.email as string,
                    (token.name as string) ?? null,
                    (token.picture as string) ?? null,
                    account.access_token as string,
                    account.refresh_token as string,
                    tokenExpiry,
                    now,
                    now,
                  ],
                });
              }
            }
          } catch (error) {
            console.error("Failed to upsert user:", error);
          }
        }

        return {
          ...token,
          access_token: account.access_token as string,
          expires_at: account.expires_at as number,
          refresh_token: account.refresh_token as string,
        };
      }

      if (Date.now() < (token.expires_at as number) * 1000) {
        return token;
      }

      if (!token.refresh_token) {
        throw new TypeError("Missing refresh_token");
      }

      try {
        const response = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: process.env.AUTH_GOOGLE_ID!,
            client_secret: process.env.AUTH_GOOGLE_SECRET!,
            grant_type: "refresh_token",
            refresh_token: token.refresh_token as string,
          }),
        });

        const tokensOrError = await response.json();
        if (!response.ok) throw tokensOrError;

        return {
          ...token,
          access_token: tokensOrError.access_token as string,
          expires_at: Math.floor(
            Date.now() / 1000 + (tokensOrError.expires_in as number)
          ),
          refresh_token:
            (tokensOrError.refresh_token as string) ?? token.refresh_token,
        };
      } catch (error) {
        console.error("Error refreshing access_token", error);
        return { ...token, error: "RefreshTokenError" as const };
      }
    },

    async session({ session, token }) {
      session.access_token = token.access_token as string;
      session.refresh_token = token.refresh_token as string;
      session.expires_at = token.expires_at as number;
      session.error = token.error as string | undefined;
      return session;
    },
  },
});
