import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node22",
  outDir: "dist",
  // Bundle phoenix into plugin, keep openclaw and ws external (provided by host)
  external: ["openclaw", "ws"],
  noExternal: ["phoenix"],
});
