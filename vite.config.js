import { defineConfig } from 'vite';

export default defineConfig({
  base: '/WellAver/',               
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
