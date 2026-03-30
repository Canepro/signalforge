import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["sql.js", "pg"],
  outputFileTracingIncludes: {
    "/*": ["./node_modules/sql.js/dist/*.wasm"],
  },
};

export default nextConfig;
