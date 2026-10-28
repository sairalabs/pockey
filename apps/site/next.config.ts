import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The docs pages read the repository's markdown at build time, so Next has to
  // trace files from the monorepo root rather than from this app.
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  async redirects() {
    return [
      { source: '/legal', destination: '/legal/notice', permanent: false },
      { source: '/docs/readme', destination: '/docs', permanent: false },
    ];
  },
};

export default nextConfig;
