import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

// Derive optional peer deps from the SDK's package.json so this stays in sync
// automatically when the SDK adds/removes optional dependencies.
const sdkPkg = JSON.parse(readFileSync("node_modules/@thenvoi/sdk/package.json", "utf-8"));
const sdkPeerMeta: Record<string, { optional?: boolean }> = sdkPkg.peerDependenciesMeta ?? {};
const sdkOptionalPeers = Object.keys(sdkPeerMeta).filter((dep) => sdkPeerMeta[dep].optional);

// Some SDK code uses subpath imports (e.g. "@a2a-js/sdk/client"). Mark the
// top-level package external and tsup will also treat subpaths as external.
const SDK_OPTIONAL_EXTERNALS = sdkOptionalPeers;

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node22",
  outDir: "dist",
  // Keep openclaw and SDK optional peer deps external
  external: ["openclaw", ...SDK_OPTIONAL_EXTERNALS],
  // Bundle the SDK and its dependencies into the plugin
  noExternal: ["phoenix", "@thenvoi/sdk", "@thenvoi/rest-client", "zod", "zod-to-json-schema"],
});
