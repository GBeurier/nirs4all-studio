import { defineConfig, mergeConfig } from 'vite';
import base from '../vite.config';

export default defineConfig(async environment => mergeConfig(
  typeof base === 'function' ? await base(environment) : await base,
  { server: { proxy: {
    '/api': { target: process.env.PLAYWRIGHT_API_BASE_URL, changeOrigin: true },
    '/ws': { target: process.env.PLAYWRIGHT_API_BASE_URL?.replace('http:', 'ws:'), ws: true },
  } } },
));
