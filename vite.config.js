import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    // The STEP importer only runs in a web worker, which Vite does not scan up
    // front. Without this, the dev server discovers it on the first import,
    // reloads the page and the first STEP file is lost.
    include: ['occt-import-js'],
  },
});
