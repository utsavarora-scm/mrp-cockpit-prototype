/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@repo/ui', '@repo/domain', '@repo/mrp-engine', '@repo/adapters', '@repo/data-packs'],
  reactStrictMode: false,
  /**
   * The demo gets driven from other machines on the LAN, not just localhost.
   * Next blocks cross-origin dev-resource requests by default, which leaves the
   * page shell rendered and the client never hydrating — so every panel sits on
   * its loading skeleton forever. Dev only; production serving is unaffected.
   */
  allowedDevOrigins: ['192.168.1.213', '*.local'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*',
      },
    ],
  },
};

export default nextConfig;
