import { build } from "esbuild";
import { execSync } from "child_process";
import { mkdirSync } from "fs";

// Build frontend with Vite
console.log("[build] Building frontend...");
execSync("npx vite build", { stdio: "inherit" });

// Build backend with esbuild
console.log("[build] Building backend...");
mkdirSync("dist", { recursive: true });

// Bundle only our own server source; leave every npm package and Node
// builtin external, to be loaded from node_modules at runtime. Bundling
// CommonJS/WASM deps (h3-js, node-cron, ...) into a single ESM file that
// also uses top-level await makes Node reject it with
// ERR_AMBIGUOUS_MODULE_SYNTAX, so we keep dependencies unbundled.
const externalizePackages = {
  name: "externalize-packages",
  setup(b: import("esbuild").PluginBuild) {
    // Matches bare specifiers (npm packages + node builtins), not "./" or "/".
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      // Keep our path aliases bundled; everything else stays external.
      if (args.path.startsWith("@shared") || args.path.startsWith("@/")) return;
      return { path: args.path, external: true };
    });
  },
};

await build({
  entryPoints: ["server/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/index.js",
  plugins: [externalizePackages],
});

console.log("[build] Done. Output: dist/index.js + dist/public/");
