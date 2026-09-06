import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const configuredHosts = (env.VITE_DEV_ALLOWED_HOSTS || '').split(',').map((host) => host.trim()).filter(Boolean)

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      allowedHosts: ['localhost', 'mesoscomposefrontend.weave.local', ...configuredHosts],
    },
  }
})
