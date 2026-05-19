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
    // ONNX Runtime Web files contain ESM syntax that Terser mis-parses when
    // they are bundled as static assets. Exclude them from parsing/minification.
    if (!config.module.noParse) config.module.noParse = [];
    config.module.noParse.push(/ort\..*\.mjs$/);
    config.module.noParse.push(/onnxruntime-web.*\.js$/);

    const terser = config.optimization.minimizer?.find(
      (m) => m.constructor.name === "TerserPlugin"
    );
    if (terser) {
      const existing = terser.options.exclude;
      const excludes = Array.isArray(existing) ? existing : existing ? [existing] : [];
      excludes.push(/ort\..*\.mjs$/);
      terser.options.exclude = excludes;
    }
    return config;
  },
};

export default nextConfig;
