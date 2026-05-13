import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const nativeServerDeps = [
  'better-sqlite3',
  '@duckdb/node-api',
  'duckdb',
  '@duckdb/node-bindings',
  '@duckdb/node-bindings-win32-x64',
  '@duckdb/node-bindings-linux-x64',
  '@duckdb/node-bindings-linux-arm64',
  '@duckdb/node-bindings-darwin-x64',
  '@duckdb/node-bindings-darwin-arm64'
];

export default defineConfig({
  plugins: [sveltekit()],
  optimizeDeps: {
    exclude: nativeServerDeps
  },
  ssr: {
    external: nativeServerDeps,
    noExternal: []
  },
  build: {
    rollupOptions: {
      external: nativeServerDeps
    }
  }
});
