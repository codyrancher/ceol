import express from 'express';
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
  database: process.env.PGDATABASE || '__SAFE_NAME__',
});

// Wait for Postgres to be ready (retries for up to ~30s)
async function initDb() {
  for (let i = 0; i < 15; i++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS click_counter (
          id    INTEGER PRIMARY KEY DEFAULT 1,
          count INTEGER NOT NULL DEFAULT 0
        )
      `);
      await pool.query(`
        INSERT INTO click_counter (id, count) VALUES (1, 0)
        ON CONFLICT (id) DO NOTHING
      `);
      console.log('Database ready');
      return;
    } catch (err) {
      console.log(`Waiting for Postgres... (${err.message})`);
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
  const color = `hsl(${hue}, 70%, 80%)`;

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
server.listen(port, () => console.log(`Server listening on :${port}`));
