import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./", // relative paths, so the built report works from any folder or GitHub Pages
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
