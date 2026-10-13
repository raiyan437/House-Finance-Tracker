import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Keep the development overlay launcher from covering mobile navigation.
  devIndicators: false,
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
