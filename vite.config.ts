import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";
import fs from "fs";
import path from "path";

const isElectron = process.env.ELECTRON === "true";
const isElectronBuild = isElectron && process.env.NODE_ENV === "production";
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "package.json"), "utf-8"));

/** Copy static electron assets (splash.html, logo) to dist-electron during build */
function copyElectronAssets(): Plugin {
  return {
    name: "copy-electron-assets",
    closeBundle() {
      const outDir = path.resolve(__dirname, "dist-electron");
      fs.mkdirSync(outDir, { recursive: true });
      const assets = [
        { src: "electron/splash.html", dest: "splash.html" },
        { src: "public/nirs4all_logo.png", dest: "nirs4all_logo.png" },
      ];
      for (const { src, dest } of assets) {
        const srcPath = path.resolve(__dirname, src);
        if (fs.existsSync(srcPath)) {
          fs.copyFileSync(srcPath, path.join(outDir, dest));
        }
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Use relative paths for Electron (file:// protocol)
  base: isElectron ? "./" : "/",
  server: {
    host: "localhost",
    port: 5173,
    proxy: isElectron
      ? undefined
      : {
          "/api": {
            target: "http://127.0.0.1:8000",
            changeOrigin: true,
          },
          "/ws": {
            target: "ws://127.0.0.1:8000",
            ws: true,
          },
        },
  },
  plugins: [
    react(),
    // Only use vite-plugin-electron during production builds
    // For dev mode, we pre-build electron files and run electron separately
    ...(isElectronBuild
      ? [
          electron([
            {
              // Main process entry point
              entry: "electron/main.ts",
              onstart(args) {
                // Start electron with --no-sandbox for WSL2 compatibility
                args.startup([".", "--no-sandbox"]);
              },
              vite: {
                build: {
                  outDir: "dist-electron",
                  minify: mode === "production",
                  // Use lib mode for proper CJS output
                  lib: {
                    entry: "electron/main.ts",
                    formats: ["cjs"],
                    fileName: () => "main.cjs",
                  },
                  rollupOptions: {
                    external: ["electron", /^node:.*/, /^@sentry\//],
                  },
                },
              },
            },
            {
              // Preload script entry point
              entry: "electron/preload.ts",
              onstart(args) {
                // Notify the renderer to reload when preload changes
                args.reload();
              },
              vite: {
                build: {
                  outDir: "dist-electron",
                  minify: mode === "production",
                  // Use lib mode for proper CJS output
                  lib: {
                    entry: "electron/preload.ts",
                    formats: ["cjs"],
                    fileName: () => "preload.cjs",
                  },
                  rollupOptions: {
                    external: ["electron", /^node:.*/],
                  },
                },
              },
            },
          ]),
          renderer(),
          copyElectronAssets(),
        ]
      : []),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    sourcemap: mode === "development",
  },
}));
