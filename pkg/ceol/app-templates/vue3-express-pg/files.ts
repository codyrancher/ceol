import type { TemplateFile } from '../types';

export function generateFiles(appName: string): TemplateFile[] {
  const safeName = appName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  return [
    {
      path:    'package.json',
      content: JSON.stringify({
        name:    safeName,
        version: '0.1.0',
        private: true,
        type:    'module',
        scripts: {
          'dev:client':   'cd client && npm run dev',
          'dev:server':   'cd server && npm run dev',
          'build:client': 'cd client && npm run build',
          'build:server': 'cd server && npm run build',
          'build':        'npm run build:client && npm run build:server',
        },
      }, null, 2),
    },
    {
      path:    'client/package.json',
      content: JSON.stringify({
        name:            `${ safeName }-client`,
        version:         '0.1.0',
        private:         true,
        type:            'module',
        scripts:         {
          dev:   'vite',
          build: 'vite build',
        },
        dependencies:    { vue: '^3.5.0' },
        devDependencies: {
          '@vitejs/plugin-vue': '^5.0.0',
          vite:                 '^6.0.0',
        },
      }, null, 2),
    },
    {
      path:    'client/vite.config.ts',
      content: `import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: { '/api': 'http://localhost:3001' },
  },
});
`,
    },
    {
      path:    'client/tsconfig.json',
      content: JSON.stringify({
        compilerOptions: {
          target:           'ES2020',
          module:           'ESNext',
          moduleResolution: 'bundler',
          strict:           true,
          jsx:              'preserve',
          paths:            { '@/*': ['./src/*'] },
        },
        include: ['src/**/*.ts', 'src/**/*.vue'],
      }, null, 2),
    },
    {
      path:    'client/index.html',
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
      path:    'client/src/main.ts',
      content: `import { createApp } from 'vue';
import App from './App.vue';

createApp(App).mount('#app');
`,
    },
    {
      path:    'client/src/App.vue',
      content: `<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue';

const count = ref(0);
const loading = ref(true);
const cursors = reactive<Record<string, { user: string; x: number; y: number; color: string }>>({});

const localCursor = reactive({ x: 0, y: 0 });
const localColor = ref('');
const username = ref('anonymous');

let ws: WebSocket | null = null;
let throttleTimer: number | null = null;
let usernameInterval: number | null = null;

function connectWs() {
  const href = window.location.href.replace(/#.*$/, '');
  const base = href.replace(/\\/[^/]*$/, '');
  const wsUrl = base.replace(/^http/, 'ws') + '/ws';

  ws = new WebSocket(wsUrl);

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'count') {
      count.value = msg.count;
      loading.value = false;
    } else if (msg.type === 'room') {
      const seen = new Set<string>();
      for (const c of msg.cursors) {
        if (c.color === localColor.value) continue;
        const key = c.user + ':' + c.color;
        seen.add(key);
        cursors[key] = { user: c.user, x: c.x, y: c.y, color: c.color };
      }
      for (const key of Object.keys(cursors)) {
        if (!seen.has(key)) delete cursors[key];
      }
    } else if (msg.type === 'welcome') {
      localColor.value = msg.color;
    }
  };

  ws.onclose = () => { setTimeout(connectWs, 2000); };
  ws.onerror = () => { ws?.close(); };
}

function increment() {
  if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'increment' }));
}

function onMouseMove(e: MouseEvent) {
  localCursor.x = e.clientX;
  localCursor.y = e.clientY;
  if (throttleTimer) return;
  throttleTimer = window.setTimeout(() => { throttleTimer = null; }, 50);
  if (ws?.readyState === 1) {
    ws.send(JSON.stringify({ type: 'cursor', user: username.value, x: e.clientX, y: e.clientY }));
  }
}

// Get username from parent frame via postMessage
function onMessage(e: MessageEvent) {
  if (e.data?.type === 'username' && e.data.user) {
    username.value = e.data.user;
    if (usernameInterval) { clearInterval(usernameInterval); usernameInterval = null; }
  }
}

onMounted(() => {
  window.addEventListener('message', onMessage);
  window.parent.postMessage({ type: 'get-username' }, '*');
  usernameInterval = window.setInterval(() => {
    window.parent.postMessage({ type: 'get-username' }, '*');
  }, 200);

  connectWs();
  window.addEventListener('mousemove', onMouseMove);
});

onUnmounted(() => {
  window.removeEventListener('message', onMessage);
  window.removeEventListener('mousemove', onMouseMove);
  if (usernameInterval) clearInterval(usernameInterval);
  ws?.close();
});
</script>

<template>
  <div class="app">
    <h1>${ appName }</h1>
    <p>Hello World</p>
    <p v-if="loading" class="muted">Loading...</p>
    <button v-else @click="increment">Count: {{ count }}</button>
    <p class="muted">Click count is persisted in Postgres</p>
  </div>

  <!-- Local username label (follows native cursor, no pointer SVG) -->
  <span
    v-if="localColor"
    class="local-label"
    :style="{ left: localCursor.x + 20 + 'px', top: localCursor.y + 16 + 'px', background: localColor }"
  >{{ username }}</span>

  <!-- Remote cursors -->
  <div
    v-for="(cur, key) in cursors"
    :key="key"
    class="cursor-pointer"
    :style="{ left: cur.x + 'px', top: cur.y + 'px' }"
  >
    <svg width="24" height="28" viewBox="0 0 24 28" fill="none">
      <path d="M1 1L1 22L6.5 16.5L11 26L15 24.5L10.5 15H19L1 1Z" :fill="cur.color" stroke="#333" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>
    <span class="cursor-label" :style="{ background: cur.color }">{{ cur.user }}</span>
  </div>
</template>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; overflow: hidden; }

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
.muted {
  color: #888;
  font-size: 0.85rem;
}

.cursor-pointer {
  position: fixed;
  pointer-events: none;
  z-index: 9999;
  transition: left 0.05s linear, top 0.05s linear;
}

.cursor-label {
  position: absolute;
  left: 22px;
  top: 16px;
  font-size: 11px;
  font-weight: 600;
  font-family: system-ui, sans-serif;
  padding: 2px 6px;
  border-radius: 3px;
  white-space: nowrap;
  color: #333;
  pointer-events: none;
}

.local-label {
  position: fixed;
  font-size: 11px;
  font-weight: 600;
  font-family: system-ui, sans-serif;
  padding: 2px 6px;
  border-radius: 3px;
  white-space: nowrap;
  color: #333;
  pointer-events: none;
  z-index: 9999;
  transition: left 0.05s linear, top 0.05s linear;
}
</style>
`,
    },
    {
      path:    'client/src/env.d.ts',
      content: `/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
`,
    },
    {
      path:    'server/package.json',
      content: JSON.stringify({
        name:         `${ safeName }-server`,
        version:      '0.1.0',
        private:      true,
        type:         'module',
        scripts:      {
          dev:   'node --watch src/index.js',
          build: 'echo "No build step needed"',
          start: 'node src/index.js',
        },
        dependencies: {
          express: '^4.21.0',
          pg:      '^8.13.0',
          ws:      '^8.18.0',
        },
      }, null, 2),
    },
    {
      path:    'server/src/index.js',
      content: `import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import pg from 'pg';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;

const pool = new Pool({
  host:     process.env.PGHOST     || 'localhost',
  port:     Number(process.env.PGPORT || 5432),
  user:     process.env.PGUSER     || 'app',
  password: process.env.PGPASSWORD || 'app',
  database: process.env.PGDATABASE || '${ safeName }',
});

// Wait for Postgres to be ready (retries for up to ~30s)
async function initDb() {
  for (let i = 0; i < 15; i++) {
    try {
      await pool.query(\`
        CREATE TABLE IF NOT EXISTS click_counter (
          id    INTEGER PRIMARY KEY DEFAULT 1,
          count INTEGER NOT NULL DEFAULT 0
        )
      \`);
      await pool.query(\`
        INSERT INTO click_counter (id, count) VALUES (1, 0)
        ON CONFLICT (id) DO NOTHING
      \`);
      console.log('Database ready');
      return;
    } catch (err) {
      console.log(\`Waiting for Postgres... (\${err.message})\`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw new Error('Could not connect to Postgres after 30s');
}
await initDb();

const app = express();
app.use(express.json());

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// REST endpoints (still available for non-WS clients)
app.get('/api/count', async (_req, res) => {
  const { rows } = await pool.query('SELECT count FROM click_counter WHERE id = 1');
  res.json({ count: rows[0]?.count ?? 0 });
});

app.post('/api/count', async (_req, res) => {
  const { rows } = await pool.query(
    'UPDATE click_counter SET count = count + 1 WHERE id = 1 RETURNING count'
  );
  res.json({ count: rows[0].count });
});

// SPA fallback
app.get('*', (_req, res) => res.sendFile(join(publicDir, 'index.html')));

// HTTP + WebSocket server
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Track connected clients: ws -> { user, x, y, color }
const clients = new Map();

function broadcastRoom() {
  const cursors = [];
  for (const [, info] of clients) {
    cursors.push({ user: info.user, x: info.x, y: info.y, color: info.color });
  }
  const msg = JSON.stringify({ type: 'room', cursors });
  for (const [ws] of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

function broadcastCount(count) {
  const msg = JSON.stringify({ type: 'count', count });
  for (const [ws] of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

wss.on('connection', async (ws) => {
  const hue = Math.floor(Math.random() * 360);
  const color = \`hsl(\${hue}, 70%, 80%)\`;

  const clientInfo = { user: 'anonymous', x: 0, y: 0, color };
  clients.set(ws, clientInfo);

  // Tell client its color so it can identify itself in room updates
  ws.send(JSON.stringify({ type: 'welcome', color }));

  try {
    const { rows } = await pool.query('SELECT count FROM click_counter WHERE id = 1');
    ws.send(JSON.stringify({ type: 'count', count: rows[0]?.count ?? 0 }));
  } catch {}

  broadcastRoom();

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'increment') {
      try {
        const { rows } = await pool.query(
          'UPDATE click_counter SET count = count + 1 WHERE id = 1 RETURNING count'
        );
        broadcastCount(rows[0].count);
      } catch {}
    } else if (msg.type === 'cursor') {
      clientInfo.user = msg.user || 'anonymous';
      clientInfo.x = msg.x;
      clientInfo.y = msg.y;
      broadcastRoom();
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    broadcastRoom();
  });
});

const port = process.env.PORT || 3001;
server.listen(port, () => console.log(\`Server listening on :\${port}\`));
`,
    },
    {
      path:    'Dockerfile',
      content: `FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package.json ./
RUN npm install
COPY client/ .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY server/package.json ./
RUN npm install --omit=dev
COPY server/ .
COPY --from=client-build /app/client/dist ./public

# Express serves the built client from /public
ENV NODE_ENV=production
ENV PORT=80
EXPOSE 80
CMD ["node", "src/index.js"]
`,
    },
    {
      path:    'scripts/build.sh',
      content: `#!/bin/bash
set -e
echo "Installing client dependencies..."
cd client && npm install && npm run build && cd ..
echo "Installing server dependencies..."
cd server && npm install && cd ..
echo "Build complete."
`,
    },
  ];
}
