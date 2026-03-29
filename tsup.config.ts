import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "esbuild";
import { defineConfig } from "tsup";

/**
 * Resolve the SDK package.json from the workspace.
 * In a pnpm workspace, the SDK is linked via node_modules/@thenvoi/sdk.
 */
function loadSdkPackageJson(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync("node_modules/@thenvoi/sdk/package.json", "utf-8"));
  } catch {
    // Fallback: read directly from the workspace sibling
    return JSON.parse(readFileSync("../sdk/package.json", "utf-8"));
  }
}

const sdkPkg = loadSdkPackageJson();
const sdkPeerMeta: Record<string, { optional?: boolean }> =
  (sdkPkg.peerDependenciesMeta as Record<string, { optional?: boolean }>) ?? {};
const sdkOptionalPeers = Object.keys(sdkPeerMeta).filter((dep) => sdkPeerMeta[dep].optional);

/**
 * Scan the SDK's compiled ESM files to discover which named exports each
 * optional peer dependency needs. esbuild validates static named imports at
 * build time, so our stub modules must re-export matching names.
 *
 * Handles:
 *  - Named imports:  import { A, B as C } from "peer"  (including multiline)
 *  - Default imports: import Foo from "peer"             → exports "default"
 *  - Re-exports:     export { A, B } from "peer"
 *
 * Namespace imports (`import * as X from "peer"`) and dynamic `import("peer")`
 * don't require specific named exports, so they are intentionally skipped.
 */
function discoverNamedImports(peers: string[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();

  const sdkDistDir = "node_modules/@thenvoi/sdk/dist";
  try {
    readdirSync(sdkDistDir);
  } catch {
    console.warn("[tsup] SDK dist not found at node_modules/@thenvoi/sdk/dist — run: npm install");
    return result;
  }

  // Patterns that require specific named exports in the stub module:
  //  1. import { A, B as C } from "peer"   → needs exports A, B
  //  2. import Foo from "peer"              → needs export default
  //  3. export { A, B } from "peer"         → needs exports A, B
  const patterns: RegExp[] = [
    /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']\s*;?/g,   // named imports
    /import\s+(\w+)\s+from\s*["']([^"']+)["']\s*;?/g,          // default imports
    /export\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']\s*;?/g,    // re-exports
  ];

  const peerSet = new Set(peers);
  function matchingPeer(specifier: string): string | undefined {
    if (peerSet.has(specifier)) return specifier;
    for (const peer of peers) {
      if (specifier.startsWith(peer + "/")) return specifier;
    }
    return undefined;
  }

  function addNames(key: string, raw: string, isDefault: boolean): void {
    const set = result.get(key) ?? new Set<string>();
    if (isDefault) {
      set.add("default");
    } else {
      for (const part of raw.split(",")) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        // "A as B" → we need the original name A (what the module must export)
        const asMatch = trimmed.match(/^(\S+)\s+as\s+/);
        set.add(asMatch ? asMatch[1] : trimmed);
      }
    }
    result.set(key, set);
  }

  let files: string[];
  try {
    files = readdirSync(sdkDistDir).filter((f) => f.endsWith(".js"));
  } catch {
    return result;
  }

  for (const file of files) {
    const content = readFileSync(join(sdkDistDir, file), "utf-8");
    for (let pi = 0; pi < patterns.length; pi++) {
      const pattern = new RegExp(patterns[pi].source, patterns[pi].flags);
      let match: RegExpExecArray | null;
      const isDefaultPattern = pi === 1;
      while ((match = pattern.exec(content)) !== null) {
        const names = match[1];
        const specifier = match[2];
        const key = matchingPeer(specifier);
        if (!key) continue;
        addNames(key, names, isDefaultPattern);
      }
    }
  }

  return result;
}

const namedImportsPerPeer = discoverNamedImports(sdkOptionalPeers);

if (sdkOptionalPeers.length > 0 && namedImportsPerPeer.size === 0) {
  console.warn(
    `[tsup] Found ${sdkOptionalPeers.length} optional peers but discovered zero static imports. ` +
    "This is expected if the SDK only uses dynamic import() for optional peers. " +
    "If the build fails with missing exports, ensure the SDK is built first: pnpm --filter @thenvoi/sdk build",
  );
}

/**
 * esbuild plugin that replaces SDK optional peer dep imports with empty modules.
 *
 * The SDK's barrel export pulls in adapter code (Claude Agent SDK, LangChain,
 * A2A, etc.) that the OpenClaw channel plugin never uses. Without this plugin
 * those imports would remain as external `import from "…"` statements and fail
 * at runtime in environments (e.g. Docker) where the packages aren't installed.
 */
function stubOptionalPeers(peers: string[]): Plugin {
  return {
    name: "stub-optional-peers",
    setup(build) {
      const filter = new RegExp(
        "^(" + peers.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")(/.*)?$"
      );
      build.onResolve({ filter }, (args) => ({
        path: args.path,
        namespace: "stub-optional-peer",
      }));
      build.onLoad({ filter: /.*/, namespace: "stub-optional-peer" }, (args) => {
        const names = namedImportsPerPeer.get(args.path);
        if (names && names.size > 0) {
          const lines: string[] = [];
          for (const n of names) {
            if (n === "default") {
              lines.push("export default undefined;");
            } else {
              lines.push(`export const ${n} = undefined;`);
            }
          }
          return { contents: lines.join("\n"), loader: "js" };
        }
        return { contents: "export {};", loader: "js" };
      });
    },
  };
}

// Read the package version to inject at build time (replaces __OPENCLAW_PKG_VERSION__ in channel.ts)
const openclawPkg = JSON.parse(readFileSync("package.json", "utf-8")) as { version: string };

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  shims: true,
  target: "node24",
  outDir: "dist",
  // Keep openclaw external (host provides it)
  external: ["openclaw"],
  // Bundle the SDK and its dependencies into the plugin
  noExternal: ["phoenix", "@thenvoi/sdk", "@thenvoi/rest-client", "zod", "zod-to-json-schema", "ws", "js-yaml"],
  esbuildPlugins: [stubOptionalPeers(sdkOptionalPeers)],
  define: {
    __OPENCLAW_PKG_VERSION__: JSON.stringify(openclawPkg.version),
  },
});
