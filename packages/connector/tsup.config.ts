import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: {
    compilerOptions: {
      rootDir: ".",
    },
    resolve: true,
  },
  entry: {
    adapter: "src/adapter.ts",
    cli: "src/cli.ts",
    index: "src/index.ts",
  },
  format: ["esm"],
  noExternal: [
    "@silvermoon-ai/protocol",
    "@silvermoon-ai/rpc",
  ],
  platform: "node",
  sourcemap: true,
  splitting: true,
  target: "node22",
});
