/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/favicon.ico", destination: "/icon.svg" }];
  },
  async redirects() {
    return [
      { source: "/admin", destination: "/property_owner", permanent: true },
      { source: "/admin/:path*", destination: "/property_owner/:path*", permanent: true },
    ];
  },
  webpack: (config) => {
    // ONNX Runtime Web ships both ESM (.mjs) and CJS (.js) builds.
    // Next.js's bundler inlines ESM into JS chunks, which Terser cannot
    // minify because the chunk wrapper is CJS. Force the CJS build.
    config.resolve.alias = {
      ...config.resolve.alias,
      "onnxruntime-web$": "onnxruntime-web/dist/ort.js",
    };
    return config;
  },
};

export default nextConfig;
