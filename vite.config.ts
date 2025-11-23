
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');

    return {
      base: './', // CRITICAL: Electron ve Capacitor için dosya yollarını göreceli yapar

      build: {
        outDir: 'dist',
        emptyOutDir: true,
      },

      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
            // Bu proxy sadece tarayıcıda 'npm run dev' yaparken çalışır.
            // Mobil ve Electron buildlerinde api/libre.ts içindeki URL mantığı devreye girer.
            '/api/libre/': {
                target: 'http://localhost:4001',
                changeOrigin: true,
                secure: false,
            }
        }
      },

      plugins: [react()],

      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY || ''),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || ''),
        global: 'window',
      },

      resolve: {
        alias: {
          '@': path.resolve(__dirname, './'),
        }
      }
    };
});