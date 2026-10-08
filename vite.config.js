import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { validatePublicEnv, PUBLIC_ENV_NAMES } from './src/utils/publicConfig.js'
import { createTankSchemaHandler } from './server/tankSchemaHandler.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  validatePublicEnv(env)
  // Dev middleware runs in Node. Only the explicitly public names above can
  // enter the client bundle; the private key stays in this server handler.
  const tankSchema = createTankSchemaHandler({ env: loadEnv(mode, process.cwd(), '') })
  return {
    plugins: [react(), {
      name: 'tank-schema-api',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (new URL(req.url, 'http://localhost').pathname === '/api/tank-schema') return tankSchema(req, res)
          next()
        })
      },
    }],
    // envPrefix matches prefixes; validatePublicEnv also rejects unknown suffixes.
    // Vercel platform metadata is unused by this app and stays out of import.meta.env.
    envPrefix: [...PUBLIC_ENV_NAMES],
    build: { sourcemap: false },
  }
})
