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
  webpack: (config, { isServer, webpack }) => {
    // ONNX Runtime Web contains ESM syntax that Terser cannot minify when
    // inlined into CJS chunks. Exclude it from the bundle and load from CDN.
    if (!isServer) {
      // Provide global ORT for any module that imports onnxruntime-web
      config.plugins.push(
        new webpack.ProvidePlugin({
          "onnxruntime-web": ["ORT"],
        })
      );
      // Also mark as external so webpack doesn't try to bundle it
      config.externals = config.externals || [];
      if (typeof config.externals === "function") {
        const original = config.externals;
        config.externals = (ctx, callback) => {
          if (ctx.request === "onnxruntime-web" || ctx.request?.startsWith("onnxruntime-web/")) {
            return callback(null, "ORT");
          }
          return original(ctx, callback);
        };
      } else if (Array.isArray(config.externals)) {
        config.externals.push({ "onnxruntime-web": "ORT" });
      } else {
        config.externals = { "onnxruntime-web": "ORT" };
      }
    }
    return config;
  },
};

export default nextConfig;
