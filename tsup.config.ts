import { readFileSync } from "node:fs";
import type { Plugin } from "esbuild";
import { defineConfig } from "tsup";

// Derive optional peer deps from the SDK's package.json so this stays in sync
// automatically when the SDK adds/removes optional dependencies.
const sdkPkg = JSON.parse(readFileSync("node_modules/@thenvoi/sdk/package.json", "utf-8"));
const sdkPeerMeta: Record<string, { optional?: boolean }> = sdkPkg.peerDependenciesMeta ?? {};
const sdkOptionalPeers = Object.keys(sdkPeerMeta).filter((dep) => sdkPeerMeta[dep].optional);

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
        // @anthropic-ai/claude-agent-sdk has static named imports that esbuild
        // checks at build time; provide matching named exports as undefined.
        if (args.path === "@anthropic-ai/claude-agent-sdk") {
          return {
            contents: "export const createSdkMcpServer = undefined;\nexport const tool = undefined;",
            loader: "js",
          };
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
