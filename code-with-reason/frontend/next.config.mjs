/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep verification builds separate when the development server is running.
  distDir: process.env.SOCRAGATE_BUILD_DIR || ".next",
  output: "standalone",
  poweredByHeader: false,
  async rewrites() {
    const backend = process.env.SOCRAGATE_API_URL || "http://127.0.0.1:8000";
    return [
      { source: "/api/v1/:path*", destination: `${backend}/api/v1/:path*` },
    ];
  },
};
export default nextConfig;
