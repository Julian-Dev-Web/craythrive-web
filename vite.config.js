import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { validatePublicEnv } from './src/utils/publicConfig.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  validatePublicEnv(env)
  return { plugins: [react()], build: { sourcemap: false } }
})
