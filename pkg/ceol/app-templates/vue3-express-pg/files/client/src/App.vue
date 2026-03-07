<script setup lang="ts">
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
  const base = href.replace(/\/[^/]*$/, '');
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
    <h1>__APP_NAME__</h1>
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
