/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pg is a server-only dependency; keep it out of the client/edge bundle.
  experimental: {
    serverComponentsExternalPackages: ["pg", "@aws-sdk/client-rds-data"],
  },
};

export default nextConfig;
