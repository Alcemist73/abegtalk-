'use strict';
const express = require('express');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const { Pool } = require('pg');
const { WebSocketServer } = require('ws');

const { DATABASE_URL, ALLOWED_ORIGIN } = process.env; // ALLOWED_ORIGIN e.g. https://abegtalk.onrender.com
if (!DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(1); }
const pool = new Pool({ connectionString: DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false } });
const REASONS = ['harassment', 'threats', 'spam', 'inappropriate'];
const sha = t => crypto.createHash('sha256').update(t).digest('hex');

// ---- tiny in-memory rate limiter (single instance only) ----
const hits = new Map();
function rl(key, max, ms) {
  const now = Date.now(), a = (hits.get(key) || []).filter(t => now - t < ms);
  if (a.length >= max) { hits.set(key, a); return false; }
  a.push(now); hits.set(key, a); return true;
}
setInterval(() => { for (const [k, v] of hits) if (!v.length || Date.now() - v[v.length - 1] > 60000) hits.delete(k); }, 60000).unref();

async function tx(fn) {
  const c = await pool.connect();
  try { await c.query('begin'); const r = await fn(c); await c.query('commit'); return r; }
  catch (e) { await c.query('rollback').catch(() => {}); throw e; }
  finally { c.release(); }
}

// ---- realtime registry: sessionId -> Set<ws> ----
const socks = new Map(), graceTimers = new Map();
function push(sid, obj) {
  const s = socks.get(sid); if (!s) return;
  const j = JSON.stringify(obj);
  for (const w of s) if (w.readyState === 1) w.send(j);
}

async function leave(sid) {
  const other = await tx(async c => {
    await c.query('delete from queue where session_id=$1', [sid]);
    const r = await c.query('select room_id from room_participants where session_id=$1 and left_at is null', [sid]);
    if (!r.rowCount) return null;
