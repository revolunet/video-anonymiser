import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Set by the GitHub Pages workflow to "/<repo-name>/"; plain "/" for local dev/preview.
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [tailwindcss(), react()],
  server: {
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
  },
});
