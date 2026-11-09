import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@sitecore-marketplace-sdk/client", "@sitecore-marketplace-sdk/xmc"],
  // ReleaseGuard is loaded in a Sitecore iframe, so dev chunk requests carry an Origin header.
  allowedDevOrigins: ["127.0.0.1", "0.0.0.0", "localhost"],
};

export default nextConfig;
