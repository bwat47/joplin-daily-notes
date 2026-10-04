import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: [
            {
                find: /^api\/(.*)$/,
                replacement: fileURLToPath(new URL('./api/$1', import.meta.url)),
            },
            {
                find: 'api',
                replacement: fileURLToPath(new URL('./api/index.ts', import.meta.url)),
            },
        ],
    },
    test: {
        environment: 'jsdom',
        globals: true,
    },
});
