import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { validatePublicEnv, PUBLIC_ENV_NAMES } from './src/utils/publicConfig.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  validatePublicEnv(env)
  return {
    plugins: [react()],
    // envPrefix matches prefixes; validatePublicEnv also rejects unknown suffixes.
    // Vercel platform metadata is unused by this app and stays out of import.meta.env.
    envPrefix: [...PUBLIC_ENV_NAMES],
    build: { sourcemap: false },
  }
})
