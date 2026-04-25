/// <reference types="vitest" />
/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { fileURLToPath } from "url";
import { VitePWA } from "vite-plugin-pwa";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "/",
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2,ttf,eot}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "gstatic-fonts-cache",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        navigateFallback: null,
      },
      manifest: {
        name: "Soba Yönetim Sistemi",
        short_name: "Soba YS",
        description: "Soba satış ve stok yönetim sistemi",
        theme_color: "#1e40af",
        background_color: "#0f172a",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        icons: [
          {
            src: "/favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Task 13.1: Bundle size optimizasyonu
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Vendor chunk
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'vendor';
          // Capacitor chunk
          if (id.includes('@capacitor')) return 'capacitor';
          // Radix UI chunk
          if (id.includes('@radix-ui')) return 'radix';
          // Recharts chunk
          if (id.includes('recharts') || id.includes('d3-')) return 'charts';
        },
      },
    },
    // Task 13.4: Asset compression
    minify: 'esbuild',
    // Chunk size uyarısını artır
    chunkSizeWarningLimit: 1000,
    // Source map sadece development'ta
    sourcemap: false,
  },
  server: {
    port: 3000,
    host: "0.0.0.0",
    // Capacitor live reload için
    hmr: {
      port: 3001,
    },
  },
  preview: {
    port: 4173,
    host: "0.0.0.0",
  },
  optimizeDeps: {
    include: ["xlsx", "@capacitor/core", "@capacitor/app", "@capacitor/device"],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'scripts/**'],
  },
});
