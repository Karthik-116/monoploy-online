'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { RoomManager } = require('./rooms');

/**
 * @param {object} [options]
 * @param {string} [options.indexFile] serve this single HTML file instead of the public/ folder
 *                                     (used by the single-file hosting build)
 */
function createServer(options = {}) {
  const app = express();
  if (options.indexFile) {
    app.get(['/', '/index.html'], (_req, res) => res.sendFile(options.indexFile));
  } else {
    app.use(express.static(path.join(__dirname, '..', 'public')));
  }
  app.get('/health', (_req, res) => res.json({ ok: true }));

  const server = http.createServer(app);
  const io = new Server(server, { cors: options.cors });
  const rooms = new RoomManager(io, options).attach();
  return { app, server, io, rooms };
}

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST || '0.0.0.0';
  const { server } = createServer();
  server.listen(PORT, HOST, () => {
    console.log(`Monopoly Online running at http://localhost:${PORT}`);
  });
}

module.exports = { createServer };
