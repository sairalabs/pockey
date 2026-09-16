import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship ESM builds in dist; transpiling keeps HMR on their source maps simple.
  transpilePackages: ['@pocketkey/react', '@pocketkey/types'],
};

export default nextConfig;
