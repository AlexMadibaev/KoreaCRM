/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(process.env.KOREACRM_NEXT_DIST_DIR ? { distDir: process.env.KOREACRM_NEXT_DIST_DIR } : {}),
  async rewrites() {
    const apiTarget = process.env.KOREACRM_API_PROXY_TARGET;
    return apiTarget ? [{ source: '/api/:path*', destination: `${apiTarget}/:path*` }] : [];
  },
};

export default nextConfig;
