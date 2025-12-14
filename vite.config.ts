import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        // Bridge SENTIMENT_* envs (used by backend) into the frontend build
        // so services/geminiService.ts can reuse the same mlapi.run config.
        'process.env.SENTIMENT_API_URL': JSON.stringify(env.SENTIMENT_API_URL),
        'process.env.SENTIMENT_API_KEY': JSON.stringify(env.SENTIMENT_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
