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
 */
function discoverNamedImports(peers: string[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();

  // Try workspace-linked path first, then sibling path
  let sdkDistDir = "node_modules/@thenvoi/sdk/dist";
  try {
    readdirSync(sdkDistDir);
  } catch {
    sdkDistDir = "../sdk/dist";
  }

  const importPattern =
    /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']\s*;?/g;

  const peerSet = new Set(peers);
  function matchingPeer(specifier: string): string | undefined {
    if (peerSet.has(specifier)) return specifier;
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
      for (const part of names.split(",")) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const asMatch = trimmed.match(/^(\S+)\s+as\s+/);
        set.add(asMatch ? asMatch[1] : trimmed);
      }
      result.set(key, set);
    }
  }

  return result;
}

const namedImportsPerPeer = discoverNamedImports(sdkOptionalPeers);

if (sdkOptionalPeers.length > 0 && namedImportsPerPeer.size === 0) {
  throw new Error(
    `[tsup] Found ${sdkOptionalPeers.length} optional peers but discovered zero named imports. ` +
    "The SDK must be built before building OpenClaw. Run: pnpm --filter @thenvoi/sdk build",
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

// Read the package version to inject at build time (replaces __OPENCLAW_PKG_VERSION__ in channel.ts)
const openclawPkg = JSON.parse(readFileSync("package.json", "utf-8")) as { version: string };

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  shims: true,
  target: "node22",
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
