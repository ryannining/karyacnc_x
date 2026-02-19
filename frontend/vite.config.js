import { defineConfig } from 'vite'

export default defineConfig({
    server: {
        watch: {
            // Use polling to ensure changes are detected on Windows/network drives
            usePolling: true,
            interval: 100,
            // Explicitly watch the public directory if needed, though usually included
            include: ['public/**']
        }
    }
})
