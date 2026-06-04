import "dotenv/config";
import express from "express";
import cors from "cors";
import { setupSession, setupAuthRoutes } from "./auth/auth";
import { registerRoutes } from "./routes";
import { startBackgroundJobs } from "./backgroundJobs";
import { runMigrations, seedHexes } from "./seed";
import { ensureGameStateTable } from "./gameService";
import { ensureMarketDataTable, ensureExchangeTables } from "./dataPipeline";
import { ensureExchangeRuntime } from "./exchangeService";

const app = express();
const PORT = parseInt(process.env.PORT || "5000", 10);

// Behind Railway's HTTPS proxy: trust it so Express knows requests are secure
// and will set the secure session cookie (otherwise the OIDC login flow loses
// its session and fails with "missing_verifier").
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false }));

if (process.env.NODE_ENV !== "production") {
  app.use(
    cors({
      origin: "http://localhost:5173",
      credentials: true,
    })
  );
}

// ─── Session + Auth ───────────────────────────────────────────────────────────
setupSession(app);
setupAuthRoutes(app);

// ─── API Routes ───────────────────────────────────────────────────────────────
registerRoutes(app);

// ─── Frontend (production) ────────────────────────────────────────────────────
if (process.env.NODE_ENV === "production") {
  const path = await import("path");
  const { fileURLToPath } = await import("url");
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const distPath = path.join(__dirname, "public");

  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
} else {
  // In dev, Vite handles the frontend on port 5173
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
    root: "client",
  });
  app.use(vite.ssrFixStacktrace);
  app.use(vite.middlewares);
}

// ─── Start ────────────────────────────────────────────────────────────────────
// Ensure the database schema exists and the hex grid is seeded before we
// start serving, so a fresh deploy is ready without manual setup steps.
await runMigrations();
await seedHexes();
await ensureGameStateTable();
await ensureMarketDataTable();
await ensureExchangeTables();
await ensureExchangeRuntime();

app.listen(PORT, () => {
  console.log(`[server] La Brea Madre running on port ${PORT}`);
  startBackgroundJobs();
});
