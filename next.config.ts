import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A small self-contained server for the Docker image.
  output: "standalone",
  images: { unoptimized: true },
  poweredByHeader: false,
};

export default nextConfig;
