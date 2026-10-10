import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    environmentOptions: {
      happyDOM: {
        url: 'https://app.example.com',
        settings: {
          // Serve a blank page for the fake embed origin so the iframe gets a real
          // cross-origin contentWindow without any network access.
          fetch: {
            virtualServers: [
              {
                url: 'https://embed.pockey.test',
                directory: fileURLToPath(new URL('./test/embed', import.meta.url)),
              },
            ],
          },
        },
      },
    },
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
