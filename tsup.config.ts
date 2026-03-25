import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "esbuild";
import { defineConfig } from "tsup";

// Derive optional peer deps from the SDK's package.json so this stays in sync
// automatically when the SDK adds/removes optional dependencies.
const sdkPkg = JSON.parse(readFileSync("node_modules/@thenvoi/sdk/package.json", "utf-8"));
const sdkPeerMeta: Record<string, { optional?: boolean }> = sdkPkg.peerDependenciesMeta ?? {};
const sdkOptionalPeers = Object.keys(sdkPeerMeta).filter((dep) => sdkPeerMeta[dep].optional);

/**
 * Scan the SDK's compiled ESM files to discover which named exports each
 * optional peer dependency needs.  esbuild validates static named imports at
 * build time, so our stub modules must re-export matching names.
 *
 * This replaces a hardcoded list of export names so the build automatically
 * adapts when the SDK adds, removes, or renames imports from its optional peers.
 */
function discoverNamedImports(peers: string[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const sdkDistDir = "node_modules/@thenvoi/sdk/dist";

  // Regex matches multi-line and single-line static ESM imports:
  //   import { a, b } from "pkg";
  //   import { a as x, b } from "pkg/sub";
  // It intentionally does NOT match dynamic `import("pkg")` – those don't need
  // named exports.
  const importPattern =
    /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']\s*;?/g;

  const peerSet = new Set(peers);
  // Also match subpath imports like "@linear/sdk/webhooks" → peer "@linear/sdk"
  function matchingPeer(specifier: string): string | undefined {
    if (peerSet.has(specifier)) return specifier;
    // Check if specifier is a subpath of a peer (e.g. "@linear/sdk/webhooks")
    for (const peer of peers) {
      if (specifier.startsWith(peer + "/")) return specifier;
    }
    return undefined;
  }

  let files: string[];
  try {
    files = readdirSync(sdkDistDir).filter((f) => f.endsWith(".js"));
  } catch {
    return result;
  }

  for (const file of files) {
    const content = readFileSync(join(sdkDistDir, file), "utf-8");
    let match: RegExpExecArray | null;
    while ((match = importPattern.exec(content)) !== null) {
      const names = match[1];
      const specifier = match[2];
      const key = matchingPeer(specifier);
      if (!key) continue;
      const set = result.get(key) ?? new Set<string>();
      // Parse "a, b as c, d" → extract the local binding names
      for (const part of names.split(",")) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        // "foo as bar" → we need to export "foo" (the original name)
        const asMatch = trimmed.match(/^(\S+)\s+as\s+/);
        set.add(asMatch ? asMatch[1] : trimmed);
      }
      result.set(key, set);
    }
  }

  return result;
}

const namedImportsPerPeer = discoverNamedImports(sdkOptionalPeers);

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
      // Match the package name or any subpath (e.g. "@langchain/core/tools")
      const filter = new RegExp(
        "^(" + peers.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")(/.*)?$"
      );
      build.onResolve({ filter }, (args) => ({
        path: args.path,
        namespace: "stub-optional-peer",
      }));
      build.onLoad({ filter: /.*/, namespace: "stub-optional-peer" }, (args) => {
        // Generate named exports for any static imports esbuild will validate.
        const names = namedImportsPerPeer.get(args.path);
        if (names && names.size > 0) {
          const stubs = [...names]
            .map((n) => `export const ${n} = undefined;`)
            .join("\n");
          return { contents: stubs, loader: "js" };
        }
        return { contents: "export {};", loader: "js" };
      });
    },
  };
}

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node22",
  outDir: "dist",
  // Keep openclaw external (host provides it)
  external: ["openclaw"],
  // Bundle the SDK and its dependencies into the plugin
  noExternal: ["phoenix", "@thenvoi/sdk", "@thenvoi/rest-client", "zod", "zod-to-json-schema"],
  esbuildPlugins: [stubOptionalPeers(sdkOptionalPeers)],
});
