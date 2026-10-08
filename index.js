
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const express = require('express');
const config = {
  name: 'Minecraft AFK Bot',
  server: {
    ip: 'TOKENSMPMC-0vjp.aternos.me',
    port: 53404,
    version: '1.21.11'
  },
  username: 'Mota',
  auth: 'offline',
  autoReconnect: true,
  reconnectDelay: 10000
};

// ============================================================
// EXPRESS SERVER - Keep Render/Aternos alive
// ============================================================

const app = express();
const PORT = process.env.PORT || 5000;

// Bot state tracking
let botState = {
  connected: false,
  lastActivity: Date.now(),
  reconnectAttempts: 0,
  startTime: Date.now(),
  errors: []
};

// Health check endpoint for monitoring
app.get('/', (req, res) => {
  const uptime = Math.floor((Date.now() - botState.startTime) / 1000);

  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>${config.name} Status</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: #0f172a;
      color: #f8fafc;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      overflow: hidden;
    }

    .container {
      background: #1e293b;
      padding: 40px;
      border-radius: 20px;
      box-shadow: 0 0 50px rgba(45, 212, 191, 0.2);
      text-align: center;
      width: 400px;
      max-width: 80%;
      border: 1px solid #334155;
    }

    .status {
      font-size: 22px;
      margin: 20px 0;
    }

    .online {
      color: #22c55e;
    }

    .offline {
      color: #ef4444;
    }

    .info {
      color: #94a3b8;
      margin: 8px 0;
    }
  </style>
</head>

<body>
  <div class="container">
    <h1>${config.name}</h1>

    <div class="status ${botState.connected ? 'online' : 'offline'}">
      ${botState.connected ? '● ONLINE' : '● OFFLINE'}
    </div>

    <div class="info">
      Server: ${config.server.ip}:${config.server.port}
    </div>

    <div class="info">
      Reconnect Attempts: ${botState.reconnectAttempts}
    </div>

    <div class="info">
      Uptime: ${uptime}s
    </div>

    <div class="info">
      Last Activity:
      ${new Date(botState.lastActivity).toLocaleString()}
    </div>
  </div>
</body>
</html>
  `);
});

app.get('/status', (req, res) => {
  res.json({
    ...botState,
    uptime: Date.now() - botState.startTime
  });
});

app.listen(PORT, () => {
  console.log(`[Web] Status server running on port ${PORT}`);
});

// ============================================================
// BOT STATE
// ============================================================

let bot = null;
let reconnectTimer = null;
let keepAliveTimer = null;

// ============================================================
// CREATE BOT
// ============================================================

function createBot() {
  console.log('');
  console.log('='.repeat(50));
  console.log('Minecraft AFK Bot v2.3 - Bug Fix Edition');
  console.log('='.repeat(50));
  console.log(`Server: ${config.server.ip}:${config.server.port}`);
  console.log(`Version: ${config.server.version}`);
  console.log(`Username: ${config.username}`);
  console.log(
    `Auto-Reconnect: ${config.autoReconnect ? 'Enabled' : 'Disabled'}`
  );
  console.log('='.repeat(50));

  botState.connected = false;
  botState.lastActivity = Date.now();

  const options = {
    host: config.server.ip,
    port: config.server.port,
    username: config.username,
    auth: config.auth,
    version: config.server.version
  };

  bot = mineflayer.createBot(options);

  bot.loadPlugin(pathfinder);

  // ==========================================================
  // LOGIN
  // ==========================================================

  bot.once('login', () => {
    console.log('[Bot] Login successful');
    botState.lastActivity = Date.now();
  });

  // ==========================================================
  // SPAWN
  // ==========================================================

  bot.once('spawn', () => {
    console.log('[Bot] Spawned successfully');

    botState.connected = true;
    botState.lastActivity = Date.now();
    botState.reconnectAttempts = 0;

    setupPathfinder();
    startKeepAlive();

    console.log('[Bot] AFK mode started');
  });

  // ==========================================================
  // CHAT
  // ==========================================================

  bot.on('chat', (username, message) => {
    botState.lastActivity = Date.now();
    console.log(`[Chat] ${username}: ${message}`);
  });

  // ==========================================================
  // KICK
  // ==========================================================

  bot.on('kicked', (reason) => {
    console.log('[Bot] Kicked:', reason);

    botState.connected = false;
    stopKeepAlive();
    scheduleReconnect();
  });

  // ==========================================================
  // END
  // ==========================================================

  bot.on('end', (reason) => {
    console.log('[Bot] Connection ended:', reason);

    botState.connected = false;
    stopKeepAlive();
    scheduleReconnect();
  });

  // ==========================================================
  // ERROR
  // ==========================================================

  bot.on('error', (err) => {
    console.log('[Bot] Error:', err.message);

    botState.errors.push({
      type: 'bot',
      message: err.message,
      time: Date.now()
    });

    if (botState.errors.length > 20) {
      botState.errors.shift();
    }
  });

  // ==========================================================
  // PHYSICS TICK
  // ==========================================================

  bot.on('physicsTick', () => {
    botState.lastActivity = Date.now();
  });
}

// ============================================================
// PATHFINDER
// ============================================================

function setupPathfinder() {
  if (!bot || !bot.entity) return;

  try {
    const mcData = require('minecraft-data')(bot.version);
    const defaultMove = new Movements(bot, mcData);

    bot.pathfinder.setMovements(defaultMove);

    console.log('[Bot] Pathfinder initialized');
  } catch (err) {
    console.log('[Pathfinder] Could not initialize:', err.message);
  }
}

// ============================================================
// KEEP ALIVE / AFK
// ============================================================

function startKeepAlive() {
  stopKeepAlive();

  keepAliveTimer = setInterval(() => {
    if (!bot || !bot.entity || !botState.connected) {
      return;
    }

    try {
      bot.setControlState('jump', true);

      setTimeout(() => {
        if (bot && botState.connected) {
          bot.setControlState('jump', false);
        }
      }, 300);
    } catch (err) {
      console.log('[KeepAlive] Error:', err.message);
    }
  }, 60000);
}

function stopKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

// ============================================================
// AUTO RECONNECT
// ============================================================

function scheduleReconnect() {
  if (!config.autoReconnect) {
    return;
  }

  if (reconnectTimer) {
    return;
  }

  botState.reconnectAttempts++;

  console.log(
    `[Reconnect] Attempt ${botState.reconnectAttempts} in ${
      config.reconnectDelay / 1000
    }s`
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;

    try {
      createBot();
    } catch (err) {
      console.log('[Reconnect] Failed:', err.message);

      botState.errors.push({
        type: 'reconnect',
        message: err.message,
        time: Date.now()
      });

      scheduleReconnect();
    }
  }, config.reconnectDelay);
}

// ============================================================
// CRASH RECOVERY - IMMORTAL MODE
// ============================================================

process.on('uncaughtException', (err) => {
  console.log(`[FATAL] Uncaught Exception: ${err.message}`);

  botState.errors.push({
    type: 'uncaught',
    message: err.message,
    time: Date.now()
  });

  if (botState.errors.length > 20) {
    botState.errors.shift();
  }

  console.log('[System] Keeping process alive...');

  if (config.autoReconnect) {
    stopKeepAlive();

    setTimeout(() => {
      scheduleReconnect();
    }, 10000);
  }
});

process.on('unhandledRejection', (reason) => {
  console.log(`[FATAL] Unhandled Rejection: ${reason}`);

  botState.errors.push({
    type: 'rejection',
    message: String(reason),
    time: Date.now()
  });

  if (botState.errors.length > 20) {
    botState.errors.shift();
  }

  console.log('[System] Keeping process alive...');
});

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

process.on('SIGTERM', () => {
  console.log('[System] SIGTERM received. Exiting...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[System] Manual stop requested. Exiting...');
  process.exit(0);
});

// ============================================================
// START THE BOT
// ============================================================

console.log('='.repeat(50));
console.log('Minecraft AFK Bot v2.3 - Bug Fix Edition');
console.log('='.repeat(50));
console.log(`Server: ${config.server.ip}:${config.server.port}`);
console.log(`Version: ${config.server.version}`);
console.log(`Username: ${config.username}`);
console.log(
  `Auto-Reconnect: ${config.autoReconnect ? 'Enabled' : 'Disabled'}`
);
console.log('='.repeat(50));

createBot();
npm install mineflayer mineflayer-pathfinder minecraft-data express
