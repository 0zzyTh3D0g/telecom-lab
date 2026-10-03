import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || '/',
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'math-rendering', test: /node_modules[\\/]katex[\\/]/ },
            { name: 'validation', test: /node_modules[\\/]zod[\\/]/ },
          ],
        },
      },
    },
  },
})
