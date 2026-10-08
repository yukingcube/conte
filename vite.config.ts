import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base を相対にしておくと、GitHub Pages のようなサブフォルダ配下でもそのまま動く
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173 },
});
