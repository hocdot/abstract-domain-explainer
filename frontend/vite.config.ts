import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// For GitHub Pages, set BASE_PATH to the repository sub-path, e.g. /abstract-domain-explainer/
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
})
