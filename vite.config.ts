import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// `base` is relative so the built site works on GitHub Pages under /OSRSSims/ and when opened locally.
export default defineConfig({
  base: './',
  plugins: [react()],
})
