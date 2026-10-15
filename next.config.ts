import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "172.20.47.129",
    "172.20.47.129:3000",
    "172.20.39.92",
    "172.20.39.92:3000",
    "localhost",
    "localhost:3000",
  ],
};

export default nextConfig;

