import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@renderer": path.resolve(__dirname, "src/renderer")
    }
  },
  root: "src/renderer",
  build: {
    outDir: "../../dist",
    emptyOutDir: true
  }
});
