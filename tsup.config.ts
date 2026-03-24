import { defineConfig } from "tsup";

// The SDK's optional peer dependencies that should not be bundled
const SDK_OPTIONAL_EXTERNALS = [
  "@langchain/langgraph/prebuilt",
  "@langchain/core/tools",
  "@a2a-js/sdk",
  "@a2a-js/sdk/client",
  "@a2a-js/sdk/server",
  "@a2a-js/sdk/server/express",
  "@anthropic-ai/sdk",
  "@anthropic-ai/claude-agent-sdk",
  "@google/genai",
  "@linear/sdk",
  "@linear/sdk/webhooks",
  "@openai/codex-sdk",
  "express",
  "openai",
  "parlant-client",
];

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
