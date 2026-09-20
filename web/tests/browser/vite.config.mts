import { defineConfig } from "vite";
import path from "node:path";
const web = path.resolve(import.meta.dirname, "../.."),
  mock = (name: string) => path.resolve(import.meta.dirname, name);
export default defineConfig({
  root: import.meta.dirname,
  publicDir: path.join(web, "public"),
  define: { "process.env": "{}" },
  resolve: {
    alias: [
      ...["wallet", "escrow", "reveal", "prover", "tokens", "config"].map(
        (name) => ({
          find: `@/lib/${name}`,
          replacement: mock("services.tsx"),
        }),
      ),
      { find: "next/navigation", replacement: mock("navigation.tsx") },
      { find: "next/link", replacement: mock("link.tsx") },
      { find: "@", replacement: path.join(web, "src") },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 3108,
    strictPort: true,
    fs: { allow: [web] },
  },
});
