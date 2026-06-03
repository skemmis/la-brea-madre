import { build } from "esbuild";
import { execSync } from "child_process";
import { mkdirSync } from "fs";

// Build frontend with Vite
console.log("[build] Building frontend...");
execSync("npx vite build", { stdio: "inherit" });

// Build backend with esbuild
console.log("[build] Building backend...");
mkdirSync("dist", { recursive: true });

await build({
  entryPoints: ["server/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "dist/index.cjs",
  external: [
    // Native modules
    "pg-native",
    "better-sqlite3",
    // Heavy deps best loaded from node_modules
    "vite",
  ],
  define: {
    "import.meta.url": "require('url').pathToFileURL(__filename).href",
  },
  banner: {
    js: `
const require = (await import('module')).createRequire(import.meta.url);
const __filename = (await import('url')).fileURLToPath(import.meta.url);
const __dirname = (await import('path')).dirname(__filename);
`.trim(),
  },
});

console.log("[build] Done. Output: dist/index.cjs + dist/public/");
