import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        blind_eval: resolve(__dirname, 'public/blind_eval.html'),
        game_method1: resolve(__dirname, 'public/game_method1.html'),
        game_method2: resolve(__dirname, 'public/game_method2.html'),
      },
    },
  },
});
