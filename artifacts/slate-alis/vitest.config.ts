import path from 'path';
import { defineConfig } from 'vitest/config';

// Component tests for the SPA. They run in jsdom and import the real
// components, so a regression in what is rendered (or not rendered) fails here.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
});
