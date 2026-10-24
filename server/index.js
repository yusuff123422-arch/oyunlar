/**
 * Hide and Seek 3D — Online Oda Sunucusu
 * Bağımlılık YOK. Sadece Node.js.
 *
 * Çalıştır:  node server/index.js
 * Varsayılan port: 8080  (PORT=3000 node server/index.js)
 *
 * Uç noktalar (hepsi /api altında):
 *   GET  /api/health
 *   GET  /api/rooms
 *   POST /api/room/create   { playerId, name, map, difficulty }
 *   POST /api/room/join     { playerId, name, code }
 *   POST /api/room/leave    { playerId, code }
 *   POST /api/room/start    { playerId, code }        (sadece host)
 *   POST /api/room/position { code, playerId, x, y, z, yaw, role }
 *   GET  /api/room/state?code=ABC123&playerId=p_xxx
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

/* Yerel ağ IP'sini bul (Wi-Fi / Ethernet) */
function getLocalIPs() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      // sanal adaptörleri atla
      if (/vmnet|virtualbox|vmware|loopback|vethernet|wsl|hyper-v|adapter 3|ethernet 3|^ethernet \d/i.test(name)) continue;
      // 192.168.x.1 genelde sanal adaptör gateway'idir, atla
      if (/\.1$/.test(iface.address) && /ethernet/i.test(name)) continue;
      out.push({ name, address: iface.address });
    }
  }
  return out;
}

const PORT = process.env.PORT || 8080;
const SITE_DIR = path.join(__dirname, '..', 'site');
const MAX_PLAYERS = 8;
const ROOM_TTL = 1000 * 60 * 60;      // 1 saat
const PLAYER_TTL = 1000 * 60;          // 1 dk hareketsiz oyuncu atılır

/** code -> room */
const rooms = new Map();

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

function newRoom(host) {
  let code = randomCode();
  while (rooms.has(code)) code = randomCode();

  const room = {
    code,
    hostId: host.id,
    map: host.map || 'open',
    difficulty: host.difficulty || 'normal',
    started: false,
    createdAt: Date.now(),
    players: new Map(),   // id -> player
  };
  addPlayer(room, host);
  rooms.set(code, room);
  return room;
}

function addPlayer(room, { id, name, role }) {
  room.players.set(id, {
    id,
    name: cleanName(name),
    role: role || 'hider',
    x: 0, y: 0, z: 0, yaw: 0,
    joinedAt: Date.now(),
    lastSeen: Date.now(),
    host: room.hostId === id,
  });
}

function cleanName(n) {
  return String(n || 'Oyuncu').replace(/[<>&"']/g, '').slice(0, 18) || 'Oyuncu';
}

function playerList(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id, name: p.name, role: p.role,
    x: p.x, y: p.y, z: p.z, yaw: p.yaw,
    host: p.host,
  }));
}

function assignRoles(room) {
  const ids = [...room.players.keys()];
  // ilk oyuncu ebe, geri kalanlar saklanan (3+ oyuncuda 2 ebe)
  const seekers = ids.length >= 4 ? 2 : 1;
  const roles = {};
  ids.forEach((id, i) => {
    roles[id] = i < seekers ? 'seeker' : 'hider';
    const p = room.players.get(id);
    if (p) p.role = roles[id];
  });
  return roles;
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
    });
  });
}

/* ---- temizlik döngüsü ---- */
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    // hareketsiz oyuncuları at
    for (const [id, p] of room.players) {
      if (now - p.lastSeen > PLAYER_TTL) room.players.delete(id);
    }
    if (room.players.size === 0) { rooms.delete(code); continue; }
    if (now - room.createdAt > ROOM_TTL) rooms.delete(code);
  }
}, 15000);

/* ---- HTTP sunucu ---- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') return send(res, 204, {});

  /* ===== API ===== */
  if (pathname.startsWith('/api/')) {
    const route = pathname.slice(4);

    if (route === '/health') return send(res, 200, { ok: true, rooms: rooms.size, uptime: process.uptime() });

    if (route === '/rooms') {
      const list = [...rooms.values()].map((r) => ({
        code: r.code, players: r.players.size, map: r.map, started: r.started,
      }));
      return send(res, 200, { rooms: list });
    }

    if (route === '/room/create' && req.method === 'POST') {
      const b = await readBody(req);
      if (!b.playerId) return send(res, 400, { error: 'playerId gerekli' });
      const room = newRoom({ id: b.playerId, name: b.name, map: b.map, difficulty: b.difficulty });
      return send(res, 200, { code: room.code, players: playerList(room), hostId: room.hostId });
    }

    if (route === '/room/join' && req.method === 'POST') {
      const b = await readBody(req);
      const room = rooms.get(String(b.code || '').toUpperCase());
      if (!room) return send(res, 404, { error: 'Oda bulunamadı' });
      if (room.players.size >= MAX_PLAYERS) return send(res, 409, { error: 'Oda dolu' });
      if (room.started) return send(res, 409, { error: 'Maç başladı' });
      addPlayer(room, { id: b.playerId, name: b.name });
      return send(res, 200, { code: room.code, players: playerList(room), hostId: room.hostId });
    }

    if (route === '/room/leave' && req.method === 'POST') {
      const b = await readBody(req);
      const room = rooms.get(String(b.code || '').toUpperCase());
      if (room) {
        room.players.delete(b.playerId);
        if (room.hostId === b.playerId) {
          const next = [...room.players.keys()][0];
          room.hostId = next || null;
          if (next) room.players.get(next).host = true;
        }
        if (room.players.size === 0) rooms.delete(room.code);
      }
      return send(res, 200, { ok: true });
    }

    if (route === '/room/start' && req.method === 'POST') {
      const b = await readBody(req);
      const room = rooms.get(String(b.code || '').toUpperCase());
      if (!room) return send(res, 404, { error: 'Oda yok' });
      if (room.hostId !== b.playerId) return send(res, 403, { error: 'Sadece oda sahibi başlatabilir' });
      room.started = true;
      room.startedAt = Date.now();
      room.roles = assignRoles(room);
      room.time = room.difficulty === 'easy' ? 120 : room.difficulty === 'hard' ? 65 : 90;
      return send(res, 200, { ok: true, roles: room.roles });
    }

    if (route === '/room/position' && req.method === 'POST') {
      const b = await readBody(req);
      const room = rooms.get(String(b.code || '').toUpperCase());
      if (!room) return send(res, 404, { error: 'Oda yok' });
      const p = room.players.get(b.playerId);
      if (!p) return send(res, 404, { error: 'Oyuncu yok' });
      p.x = +b.x || 0; p.y = +b.y || 0; p.z = +b.z || 0;
      p.yaw = +b.yaw || 0;
      if (b.role) p.role = b.role;
      p.lastSeen = Date.now();
      return send(res, 200, { ok: true });
    }

    if (route === '/room/state') {
      const code = String(url.searchParams.get('code') || '').toUpperCase();
      const playerId = url.searchParams.get('playerId');
      const room = rooms.get(code);
      if (!room) return send(res, 404, { error: 'Oda yok' });
      const me = room.players.get(playerId);
      if (me) me.lastSeen = Date.now();
      return send(res, 200, {
        code: room.code,
        hostId: room.hostId,
        started: room.started,
        map: room.map,
        difficulty: room.difficulty,
        time: room.time,
        roles: room.roles || {},
        players: playerList(room),
      });
    }

    // kalan oyuncuları süresi geçmiş sayma (polling yapan oyuncular canlı)
    return send(res, 404, { error: 'Bilinmeyen uç nokta' });
  }

  /* ===== Statik dosyalar (site) ===== */
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(SITE_DIR, decodeURIComponent(filePath).replace(/\.\./g, ''));

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(SITE_DIR, 'index.html'), (e2, d2) => {
        if (e2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(d2);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.webmanifest': 'application/manifest+json',
      '.ico': 'image/x-icon',
    };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  🎮 Hide and Seek 3D — Online Sunucu');
  console.log('  ────────────────────────────────────');
  console.log('  Yerel:  http://localhost:' + PORT);
  console.log('  API:    http://localhost:' + PORT + '/api/health');
  console.log('  Oda:    ' + rooms.size + ' aktif');
  console.log('');
  const ips = getLocalIPs();
  console.log('  AYNI WI-FI ILE OYNAMAK ICIN:');
  if (ips.length) {
    for (const ip of ips) {
      console.log('  -->  http://' + ip.address + ':' + PORT + '     (' + ip.name + ')');
    }
    console.log('');
    console.log('  Arkadasin bu adresi kendi telefonuna/bilgisayarina yazsin.');
  } else {
    console.log('  Yerel ag IP bulunamadi, Ethernet/Wi-Fi bagli mi?');
  }
  console.log('');
  console.log('  Internetten oynamak icin: ngrok http ' + PORT);
  console.log('  Windows guvenlik duvari sorarsa: IZIN VER');
  console.log('');
});
