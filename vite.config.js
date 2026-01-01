import { defineConfig } from 'vite';
import tslOperatorPlugin from 'vite-plugin-tsl-operator';
import plainText from 'vite-plugin-plain-text';

export default defineConfig({
    base: './',
    assetsInclude: ['**/*.hdr', '**/*.vert', '**/*.frag', '**/*.glsl'],
    server: {
        port: 3000,
        open: true,
        host: '127.0.0.1'
    },
    build: {
        outDir: 'dist',
        assetsDir: 'assets',
        sourcemap: false
    },
    plugins: [
        tslOperatorPlugin({logs:false}),
        plainText(
            [/\.obj$/],
            { namedExport: false },
        ),
    ]
});
