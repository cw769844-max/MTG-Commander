import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["shared/src/**/*.test.ts", "server/src/**/*.test.ts"],
    environment: "node",
    // auth.ts refuses to load without a secret, and the socket tests sign real
    // session tokens, so the suite needs one before any module is imported.
    env: {
      JWT_SECRET: "test-secret-not-used-outside-tests",
      DATABASE_URL: "file:./dev.db",
      CARD_SYNC_INTERVAL_HOURS: "0",
    },
  },
});
