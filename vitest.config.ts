import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  plugins: [react()],
  test: {
    server: { deps: { inline: ["@zmkfirmware/zmk-studio-ts-client"] } },
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
  },
});
