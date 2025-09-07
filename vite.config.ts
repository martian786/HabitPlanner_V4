import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Split large chart library into its own chunk
          'charts': ['recharts'],
          // Split Supabase into its own chunk
          'supabase': ['@supabase/supabase-js'],
          // Split React Router into its own chunk
          'router': ['react-router-dom'],
        }
      }
    }
  }
})
