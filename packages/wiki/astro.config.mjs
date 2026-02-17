// @ts-check
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { viteStaticCopy } from "vite-plugin-static-copy";

// https://astro.build/config
export default defineConfig({
  vite: {
    plugins: [
      tailwindcss(),
      viteStaticCopy({
        targets: [
          {
            // Copy images from data/raw/images/ to dist/images/
            src: "../../data/raw/images/**/*.{png,jpg,jpeg,gif,svg,webp}",
            dest: "images",
          },
        ],
      }),
    ],
    // Externalize Node-only dependencies pulled in by pi-ai's Bedrock provider.
    // These are behind dynamic imports with runtime guards and never execute in the browser.
    build: {
      rollupOptions: {
        external: [
          "@smithy/node-http-handler",
          "proxy-agent",
          "@aws-sdk/client-bedrock-runtime",
        ],
      },
    },
    esbuild: {
      tsconfigRaw: {
        compilerOptions: {
          useDefineForClassFields: false,
          experimentalDecorators: true,
        },
      },
    },
    // pi-web-ui and mini-lit are compiled with legacy TypeScript decorators
    // but their JS output still contains class field declarations. esbuild's
    // pre-bundling converts these to __publicField() (Object.defineProperty),
    // which shadows Lit's decorator-defined property accessors.
    //
    // Fix: tell esbuild to parse .js as TypeScript so useDefineForClassFields
    // applies — class fields become simple assignments instead of defineProperty.
    optimizeDeps: {
      esbuildOptions: {
        loader: { ".js": "ts" },
        tsconfigRaw: {
          compilerOptions: {
            useDefineForClassFields: false,
            experimentalDecorators: true,
          },
        },
      },
    },
    css: {
      preprocessorOptions: {
        scss: {
          includePaths: ["node_modules"],
          quietDeps: true,
          silenceDeprecations: ["import", "global-builtin"],
        },
      },
    },
  },
});
