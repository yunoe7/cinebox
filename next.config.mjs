/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  images: { unoptimized: true },
  // Playwright sets NEXT_DIST_DIR so its dev server never shares .next with a local one.
  distDir: process.env.NEXT_DIST_DIR || ".next"
};
export default nextConfig;
