import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Bundle the shared package from source. Its build output is CommonJS so
      // that plain `node dist/index.js` can load it on the server, and Rollup
      // can't trace named exports through that.
      "@mtg-commander/shared": path.resolve(__dirname, "../shared/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    // Listen on the LAN too, so the dev server can be opened from a phone or
    // another PC while iterating.
    host: true,
  },
});
