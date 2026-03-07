import type { TemplateFile } from '../types';

export function generateFiles(appName: string): TemplateFile[] {
  const safeName = appName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  return [
    {
      path:    'package.json',
      content: JSON.stringify({
        name:            safeName,
        version:         '0.1.0',
        private:         true,
        type:            'module',
        scripts:         {
          dev:     'vite',
          build:   'vite build',
          preview: 'vite preview --host 0.0.0.0 --port 4173',
        },
        dependencies:    { vue: '^3.5.0' },
        devDependencies: {
          '@vitejs/plugin-vue': '^5.0.0',
          vite:                 '^6.0.0',
        },
      }, null, 2),
    },
    {
      path:    'vite.config.ts',
      content: `import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
});
`,
    },
    {
      path:    'tsconfig.json',
      content: JSON.stringify({
        compilerOptions: {
          target:         'ES2020',
          module:         'ESNext',
          moduleResolution: 'bundler',
          strict:         true,
          jsx:            'preserve',
          paths:          { '@/*': ['./src/*'] },
        },
        include: ['src/**/*.ts', 'src/**/*.vue'],
      }, null, 2),
    },
    {
      path:    'index.html',
      content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${ appName }</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
`,
    },
    {
      path:    'src/main.ts',
      content: `import { createApp } from 'vue';
import App from './App.vue';

createApp(App).mount('#app');
`,
    },
    {
      path:    'src/App.vue',
      content: `<script setup lang="ts">
import { ref } from 'vue';

const count = ref(0);
</script>

<template>
  <div class="app">
    <h1>${ appName }</h1>
    <p>Hello World</p>
    <button @click="count++">Count: {{ count }}</button>
  </div>
</template>

<style>
.app {
  font-family: system-ui, sans-serif;
  max-width: 640px;
  margin: 0 auto;
  padding: 2rem;
  text-align: center;
}

button {
  padding: 0.5rem 1rem;
  font-size: 1rem;
  cursor: pointer;
}
</style>
`,
    },
    {
      path:    'src/env.d.ts',
      content: `/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
`,
    },
    {
      path:    'Dockerfile',
      content: `FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`,
    },
    {
      path:    'scripts/build.sh',
      content: `#!/bin/bash
set -e
echo "Installing dependencies..."
npm install
echo "Building for production..."
npm run build
echo "Build complete. Output in dist/"
`,
    },
    {
      path:    'scripts/start.sh',
      content: `#!/bin/bash
set -e

if [ ! -d "dist" ]; then
  echo "No build found. Running build first..."
  bash scripts/build.sh
fi

echo "Starting preview server on port 4173..."
npm run preview
`,
    },
  ];
}
