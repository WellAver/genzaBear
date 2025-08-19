import { defineConfig } from 'vite';

export default defineConfig({
  base: '/genzaBear/',  
  build: {
    outDir: 'dist',
    assetsDir: '',
    rollupOptions: {
      output: {
        entryFileNames: 'app-[hash].js',
        chunkFileNames: 'chunk-[hash].js',
        assetFileNames: '[name]-[hash][extname]'
      }
    }
  }
});
