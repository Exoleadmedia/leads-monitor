import { resolve } from "node:path";
import { defineConfig } from "vite";

// Static SPA. `base: "./"` keeps asset paths relative so the build works on
// Netlify, Vercel, and GitHub Pages (project pages served from a subpath) alike.
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
    // Two pages: Leads Monitor at the root, Form Performance at
    // /form-performance/. Each has its own entry, so each loads only its code.
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        forms: resolve(__dirname, "form-performance/index.html"),
      },
    },
  },
});
