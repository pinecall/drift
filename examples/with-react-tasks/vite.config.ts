import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

const wsPort = process.env.DRIFT_WS_PORT

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'ui/dist',
  },
  resolve: {
    alias: {
      'drift/react': path.resolve(__dirname, 'src/drift/index.ts'),
      'react': path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
  },
  // Expose the drift WS port to the client so it can connect directly
  define: wsPort ? {
    'import.meta.env.VITE_DRIFT_WS_PORT': JSON.stringify(wsPort),
  } : undefined,
})
