import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  css: { modules: { localsConvention: "camelCaseOnly" } },
  // Pre-bundle up front so the first page load does not race the dependency optimizer.
  optimizeDeps: { include: ["react", "react-dom", "react-dom/client", "react/jsx-dev-runtime", "zod"] },
});
