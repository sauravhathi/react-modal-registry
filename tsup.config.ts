import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.tsx'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: true,
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  tsconfig: 'tsconfig.build.json'
})
