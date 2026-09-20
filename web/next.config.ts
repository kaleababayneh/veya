import type { NextConfig } from "next";

// SEP-1 / SEP-10 / SEP-24 endpoints are called cross-origin by wallets: they must answer with CORS headers.
const cors = [
  { key: "Access-Control-Allow-Origin", value: "*" },
  { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
  { key: "Access-Control-Allow-Headers", value: "Authorization, Content-Type" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/.well-known/stellar.toml", headers: [...cors, { key: "Content-Type", value: "text/plain; charset=utf-8" }, { key: "Cache-Control", value: "public, max-age=300" }] },
    ];
  },
};

export default nextConfig;
