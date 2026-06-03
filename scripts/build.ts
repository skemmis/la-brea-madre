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
  format: "esm",
  outfile: "dist/index.js",
  external: [
    // Native modules
    "pg-native",
    "better-sqlite3",
    // Heavy deps best loaded from node_modules
    "vite",
  ],
  // ESM output keeps import.meta.url natively. The require shim lets any
  // bundled CommonJS dependency that does a runtime require() still work.
  banner: {
    js: `import { createRequire as __createRequire } from 'module';
const require = __createRequire(import.meta.url);`,
  },
});

console.log("[build] Done. Output: dist/index.js + dist/public/");
