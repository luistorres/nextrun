import { defaultExclude, defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: [
      ...defaultExclude,
      "**/dist/**",
      "**/.next/**",
      "**/.claude/worktrees/**",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
