/**
 * Auth0 OIDC auth using openid-client + Passport + PostgreSQL sessions.
 * Adapted from Fantasy-Reality's replitAuth.ts.
 */
import { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import * as client from "openid-client";
import connectPgSimple from "connect-pg-simple";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

const PgSession = connectPgSimple(session);

// ─── Session setup ────────────────────────────────────────────────────────────

export function setupSession(app: Express) {
  if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is required");
  }

  app.use(
    session({
      store: new PgSession({
        conString: process.env.DATABASE_URL,
        tableName: "sessions",
        createTableIfMissing: true,
        ttl: 7 * 24 * 60 * 60, // 7 days
      }),
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: "lax",
      },
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());
}

// ─── Passport serialization ────────────────────────────────────────────────────

passport.serializeUser((user: any, done) => done(null, user.id));
passport.deserializeUser(async (id: number, done) => {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    done(null, user ?? null);
  } catch (err) {
    done(err, null);
  }
});

// ─── OIDC helpers ─────────────────────────────────────────────────────────────

let oidcConfig: client.Configuration | null = null;

async function getOidcConfig(): Promise<client.Configuration> {
  if (!oidcConfig) {
    if (
      !process.env.AUTH0_DOMAIN ||
      !process.env.AUTH0_CLIENT_ID ||
      !process.env.AUTH0_CLIENT_SECRET
    ) {
      throw new Error(
        "AUTH0_DOMAIN, AUTH0_CLIENT_ID, and AUTH0_CLIENT_SECRET are required"
      );
    }
    const issuerUrl = new URL(`https://${process.env.AUTH0_DOMAIN}`);
    oidcConfig = await client.discovery(
      issuerUrl,
      process.env.AUTH0_CLIENT_ID,
      process.env.AUTH0_CLIENT_SECRET
    );
  }
  return oidcConfig;
}

function getCallbackUrl(req: Request): string {
  const domain = process.env.APP_DOMAIN || `${req.protocol}://${req.get("host")}`;
  return `${domain}/api/callback`;
}

// ─── Auth routes ──────────────────────────────────────────────────────────────

export function setupAuthRoutes(app: Express) {
  // Initiate OIDC login
  app.get("/api/login", async (req: Request, res: Response) => {
    try {
      const config = await getOidcConfig();
      const { code_verifier, code_challenge } = client.randomPKCECodeVerifier
        ? (() => {
            const verifier = client.randomPKCECodeVerifier();
            return {
              code_verifier: verifier,
              code_challenge: client.calculatePKCECodeChallenge(verifier),
            };
          })()
        : (() => {
            const verifier = crypto.randomUUID();
            return { code_verifier: verifier, code_challenge: verifier };
          })();

      const codeVerifier = client.randomPKCECodeVerifier();
      const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

      (req.session as any).codeVerifier = codeVerifier;

      const authUrl = client.buildAuthorizationUrl(config, {
        redirect_uri: getCallbackUrl(req),
        scope: "openid email profile",
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        state: crypto.randomUUID(),
      });

      (req.session as any).state = authUrl.searchParams.get("state");
      res.redirect(authUrl.href);
    } catch (err) {
      console.error("Login initiation error:", err);
      res.redirect("/?error=auth_failed");
    }
  });

  // Auth0 callback
  app.get("/api/callback", async (req: Request, res: Response) => {
    try {
      const config = await getOidcConfig();
      const codeVerifier = (req.session as any).codeVerifier;

      if (!codeVerifier) {
        return res.redirect("/?error=missing_verifier");
      }

      const currentUrl = new URL(
        req.url,
        `${req.protocol}://${req.get("host")}`
      );

      const tokenSet = await client.authorizationCodeGrant(config, currentUrl, {
        pkceCodeVerifier: codeVerifier,
        expectedState: (req.session as any).state,
      });

      const claims = tokenSet.claims();
      if (!claims) {
        return res.redirect("/?error=no_claims");
      }

      const auth0Id = claims.sub;
      const email = (claims.email as string) || "";
      const name =
        (claims.name as string) ||
        (claims.nickname as string) ||
        email.split("@")[0];
      const picture = (claims.picture as string) || null;

      // Upsert user
      let [user] = await db.select().from(users).where(eq(users.auth0Id, auth0Id));

      if (!user) {
        const [newUser] = await db
          .insert(users)
          .values({
            auth0Id,
            email,
            displayName: name,
            avatarUrl: picture,
          })
          .returning();
        user = newUser;
      } else {
        await db
          .update(users)
          .set({ lastActiveAt: new Date() })
          .where(eq(users.id, user.id));
      }

      delete (req.session as any).codeVerifier;
      delete (req.session as any).state;

      req.login(user, (err) => {
        if (err) {
          console.error("Session login error:", err);
          return res.redirect("/?error=session_failed");
        }
        res.redirect("/");
      });
    } catch (err) {
      console.error("Callback error:", err);
      res.redirect("/?error=callback_failed");
    }
  });

  // Logout
  app.get("/api/logout", (req: Request, res: Response) => {
    req.logout(() => {
      req.session.destroy(() => {
        if (process.env.AUTH0_DOMAIN) {
          const logoutUrl = new URL(
            `https://${process.env.AUTH0_DOMAIN}/v2/logout`
          );
          logoutUrl.searchParams.set(
            "returnTo",
            process.env.APP_DOMAIN || `${req.protocol}://${req.get("host")}`
          );
          logoutUrl.searchParams.set(
            "client_id",
            process.env.AUTH0_CLIENT_ID || ""
          );
          return res.redirect(logoutUrl.href);
        }
        res.redirect("/");
      });
    });
  });

  // Current user endpoint
  app.get("/api/auth/user", (req: Request, res: Response) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const user = req.user as any;
    res.json({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      crude: user.crude,
      totalHexes: user.totalHexes,
    });
  });

  // Dev login bypass
  if (process.env.ENABLE_DEV_LOGIN === "true") {
    app.post("/api/dev-login", async (req: Request, res: Response) => {
      const email = (req.body?.email as string) || "dev@labreamadre.local";
      let [user] = await db.select().from(users).where(eq(users.email, email));
      if (!user) {
        const [newUser] = await db
          .insert(users)
          .values({
            auth0Id: `dev|${email}`,
            email,
            displayName: "Dev Player",
          })
          .returning();
        user = newUser;
      }
      req.login(user, (err) => {
        if (err) return res.status(500).json({ error: "Login failed" });
        res.json({ ok: true, user });
      });
    });
  }
}

// ─── Middleware ────────────────────────────────────────────────────────────────

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "Authentication required" });
  }
  const user = req.user as any;
  const adminEmails = (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim());
  if (!adminEmails.includes(user.email)) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}
