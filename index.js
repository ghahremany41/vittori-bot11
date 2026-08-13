require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const Database = require('better-sqlite3');
const https = require('https');
// vittori-bot

const bot = new Telegraf(process.env.BOT_TOKEN, {
  handlerTimeout: 60000,
});
const ADMIN_ID = Number(process.env.ADMIN_ID);
let ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'Amin_qh';
let CARD_NUMBER = process.env.CARD_NUMBER;
let CARD_OWNER = process.env.CARD_OWNER;
let CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || 'fastXline';
let PANEL_URL = process.env.PANEL_URL || 'https://vip-03.fl-sub.site:2096';
let PANEL_USERNAME = process.env.PANEL_USERNAME || 'b69_Amin1';
let PANEL_PASSWORD = process.env.PANEL_PASSWORD || '$iwbf*2V5*LvYC';

// Panel API
let panelToken = null;
let panelTokenExpiry = 0;

// Cache for detected API path
let detectedApiPath = null;

function getPanelToken() {
  return new Promise((resolve, reject) => {
    if (panelToken && Date.now() < panelTokenExpiry) return resolve(panelToken);

    const baseUrl = PANEL_URL.replace(/\/+$/, '');
    const hostname = new URL(baseUrl).hostname;
    const port = new URL(baseUrl).port || 443;

    // Common API paths to try
    const apiPaths = detectedApiPath
      ? [detectedApiPath]  // Use cached path first
      : ['/api/admin/token', '/dashboard/api/admin/token', '/xui/api/admin/token', '/api/v1/admin/token'];

    let pathIndex = 0;

    const tryPath = (useJson) => {
      if (pathIndex >= apiPaths.length) {
        return reject(new Error('مسیر API پیدا نشد. آدرس پنل را بررسی کنید.'));
      }

      const apiPath = apiPaths[pathIndex];
      const data = useJson
        ? JSON.stringify({ username: PANEL_USERNAME, password: PANEL_PASSWORD })
        : `grant_type=&username=${PANEL_USERNAME}&password=${encodeURIComponent(PANEL_PASSWORD)}`;

      const options = {
        hostname: hostname,
        port: port,
        path: apiPath,
        method: 'POST',
        headers: {
          'Content-Type': useJson ? 'application/json' : 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        rejectUnauthorized: false,
        timeout: 10000,
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            if (j.access_token) {
              panelToken = j.access_token;
              panelTokenExpiry = Date.now() + 3300000;
              detectedApiPath = apiPath; // Cache the working path
              console.log(`[PANEL] API path detected: ${apiPath}`);
              resolve(panelToken);
            } else if (useJson) {
              tryPath(false); // Try form-urlencoded
            } else {
              pathIndex++;
              tryPath(true); // Try next path
            }
          } catch (e) {
            if (useJson) {
              tryPath(false);
            } else {
              pathIndex++;
              tryPath(true);
            }
          }
        });
      });
      req.on('error', (e) => {
        if (useJson) {
          tryPath(false);
        } else {
          pathIndex++;
          tryPath(true);
        }
      });
      req.on('timeout', () => {
        req.destroy();
        if (useJson) {
          tryPath(false);
        } else {
          pathIndex++;
          tryPath(true);
        }
      });
      req.write(data);
      req.end();
    };

    tryPath(true);
  });
}
function panelApi(method, apiPath, bodyData) {
  return new Promise((resolve, reject) => {
    getPanelToken().then(token => {
      const baseUrl = PANEL_URL.replace(/\/+$/, '');
      const hostname = new URL(baseUrl).hostname;
      const port = new URL(baseUrl).port || 443;

      // Build full API path
      let fullPath;
      if (detectedApiPath) {
        // Extract base prefix from detected path (e.g., '/dashboard/api/admin/token' -> '/dashboard')
        const base = detectedApiPath.replace('/api/admin/token', '');
        fullPath = base + '/api' + apiPath;
      } else {
        fullPath = '/api' + apiPath;
      }

      const options = {
        hostname: hostname,
        port: port,
        path: fullPath,
        method: method,
        headers: {
          'Authorization': 'Bearer ' + token,
          'Accept': 'application/json',
        },
        rejectUnauthorized: false,
      };
      if (bodyData) {
        options.headers['Content-Type'] = 'application/json';
      }
      options.timeout = 10000;
      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch { resolve(body); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      if (bodyData) req.write(JSON.stringify(bodyData));
      req.end();
    }).catch(reject);
  });
}

// Fetch live user info from panel
async function fetchPanelUserInfo(panelUsername) {
  if (!panelUsername) return null;
  try {
    const data = await panelApi('GET', `/user/${panelUsername}`);
    if (data && data.username) return data;
  } catch (e) {}
  return null;
}

// === Auto-delivery function ===
async function autoDeliverOrder(orderId, ctx) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return false;

  const panel = order.panel || 'pasarguard';
  const dataLimitBytes = order.plan_gb * 1024 * 1024 * 1024;
  const expireUnix = Math.floor(Date.now() / 1000) + order.validity * 86400;
  const panelUsername = `fastxline_${Math.floor(1000 + Math.random() * 9000)}`;

  try {
    // Create user on panel
    const created = await panelApi('POST', '/user', {
      username: panelUsername,
      data_limit: dataLimitBytes,
      expire: expireUnix,
      note: `Order #${orderId} | User: ${order.user_id}`,
      group_ids: discoveredGroupIds.length > 0 ? discoveredGroupIds : [1, 2],
    });

    if (!created || !created.username) {
      throw new Error('Panel user creation failed: ' + JSON.stringify(created));
    }

    const subUrl = created.subscription_url.startsWith('http') 
      ? created.subscription_url 
      : 'https://' + new URL(PANEL_URL).host + created.subscription_url;

    // Generate QR via API
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(subUrl)}`;

    // Save to DB
    db.prepare("UPDATE orders SET status = 'delivered', sub_link = ?, panel_username = ? WHERE id = ?")
      .run(subUrl, panelUsername, orderId);

    // Send to user
    const expireDate = new Date(expireUnix * 1000).toLocaleDateString('fa-IR');
    const msg = 
      `✅ *سفارش شما تحویل داده شد!*\n\n` +
      `🔹 *سرویس:* ${escapeMarkdown(order.plan_name)}\n` +
      `🗜 *حجم:* ${order.plan_gb} گیگابایت\n` +
      `⏳ *مدت زمان:* ${order.validity} روز (تا ${expireDate})\n\n` +
      `🔗 *لینک اتصال:*\n\`${subUrl}\`\n\n` +
      `📱 برای اتصال از کلاینت‌های V2Ray استفاده کنید.`;

    await ctx.replyWithPhoto(qrUrl, {
      caption: msg,
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[b('سرویس‌های من 📦', 'my_services', 'myServices')]]),
    });

    // Notify admin
    bot.telegram.sendMessage(ADMIN_ID,
      `✅ سفارش #${orderId} به صورت اتوماتیک تحویل داده شد\n` +
      `👤 @${ctx.from.username || 'ندارد'} (${ctx.from.id})\n` +
      `🔹 ${order.plan_name} | ${order.plan_gb}GB | ${order.validity} روز`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});

    return true;
  } catch (err) {
    console.error('Auto-deliver error:', err.message);
    bot.telegram.sendMessage(ADMIN_ID,
      `❌ خطا در تحویل اتوماتیک سفارش #${orderId}\n${err.message}\n\nلطفاً دستی تحویل دهید.`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
    return false;
  }
}
let discoveredGroupIds = [];

async function discoverGroupIds() {
  // 1. First try /groups endpoint
  try {
    const groups = await panelApi('GET', '/groups');
    if (Array.isArray(groups) && groups.length > 0) {
      discoveredGroupIds = groups.map(g => g.id || g).filter(id => typeof id === 'number');
      if (discoveredGroupIds.length > 0) {
        console.log('[GROUPS] Discovered from API:', discoveredGroupIds);
        // Save to DB for future use
        try {
          db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('group_ids', JSON.stringify(discoveredGroupIds));
        } catch (_) {}
        return discoveredGroupIds;
      }
    }
  } catch (e) {
    console.log('[GROUPS] API /api/groups failed:', e.message);
  }

  // 2. Try to get from DB settings (saved from previous successful discovery)
  try {
    const saved = db.prepare("SELECT value FROM settings WHERE key = 'group_ids'").get();
    if (saved && saved.value) {
      const parsed = JSON.parse(saved.value);
      if (Array.isArray(parsed) && parsed.length > 0) {
        discoveredGroupIds = parsed;
        console.log('[GROUPS] Loaded from DB settings:', discoveredGroupIds);
        return discoveredGroupIds;
      }
    }
  } catch (e) {
    console.log('[GROUPS] Failed to load from DB:', e.message);
  }

  // 3. If panel doesn't support groups or no groups found, use empty array
  // The bot will fallback to [1, 2] when creating users (see autoDeliverOrder and free_test)
  console.log('[GROUPS] No groups found - will use panel defaults');
  discoveredGroupIds = [];
  return discoveredGroupIds;
}

const fs = require('fs');
const path = require('path');

// Database path with fallback
const dbPath = process.env.DB_PATH || '/data/bot.db';
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);
// redeploy trigger
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    user_id INTEGER UNIQUE,
    username TEXT,
    first_name TEXT,
    wallet INTEGER DEFAULT 0,
    banned INTEGER DEFAULT 0,
    referred_by INTEGER,
    used_free_test INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    plan_name TEXT,
    plan_gb INTEGER,
    validity INTEGER,
    price INTEGER,
    status TEXT DEFAULT 'pending',
    panel TEXT DEFAULT 'pasarguard',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
  );

  CREATE TABLE IF NOT EXISTS charges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    amount INTEGER,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
  );

  CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    gb INTEGER NOT NULL,
    validity INTEGER NOT NULL,
    price INTEGER NOT NULL,
    active INTEGER DEFAULT 1,
    panel TEXT DEFAULT 'pasarguard',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS free_trials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    qr_file_id TEXT,
    sub_link TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    claimed_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS panels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description TEXT,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS discount_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    percent INTEGER NOT NULL,
    max_uses INTEGER DEFAULT -1,
    used_count INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const planCount = db.prepare('SELECT COUNT(*) as c FROM plans').get().c;
if (planCount === 0) {
  const insert = db.prepare('INSERT INTO plans (name, gb, validity, price, panel) VALUES (?, ?, ?, ?, ?)');
  const defaultPlans = [
    ['10GB', 10, 31, 70000, 'pasarguard'],
    ['20GB', 20, 31, 140000, 'pasarguard'],
    ['30GB', 30, 31, 210000, 'pasarguard'],
    ['50GB', 50, 31, 350000, 'pasarguard'],
    ['100GB', 100, 31, 700000, 'pasarguard'],
    ['25GB', 25, 31, 160000, 'economic'],
    ['30GB', 30, 31, 190000, 'economic'],
    ['35GB', 35, 31, 220000, 'economic'],
    ['55GB', 55, 31, 370000, 'economic'],
    ['100GB', 100, 31, 580000, 'economic'],
  ];
  const insertMany = db.transaction((plans) => { for (const p of plans) insert.run(...p); });
  insertMany(defaultPlans);
}

const panelCount = db.prepare('SELECT COUNT(*) as c FROM panels').get().c;
if (panelCount === 0) {
  const insertPanel = db.prepare('INSERT INTO panels (name, display_name, description) VALUES (?, ?, ?)');
  insertPanel.run('pasarguard', 'Pasarguard', 'پنل Pasarguard - مناسب گیمینگ و ترید');
  insertPanel.run('economic', 'اقتصادی', 'پنل اقتصادی - مناسب AI و وب گردی');
}

try {
  db.exec(`ALTER TABLE users ADD COLUMN referred_by INTEGER`);
} catch (_) {}

try {
  db.exec(`ALTER TABLE users ADD COLUMN banned INTEGER DEFAULT 0`);
} catch (_) {}

try {
  db.exec(`ALTER TABLE users ADD COLUMN used_free_test INTEGER DEFAULT 0`);
} catch (_) {}

try {
  db.exec(`ALTER TABLE free_trials ADD COLUMN claimed_by INTEGER`);
} catch (_) {}

try {
  db.exec(`ALTER TABLE plans ADD COLUMN panel TEXT DEFAULT 'pasarguard'`);
} catch (_) {}

try { db.exec(`ALTER TABLE orders ADD COLUMN panel TEXT DEFAULT 'pasarguard'`); } catch (_) {}
try { db.exec(`ALTER TABLE orders ADD COLUMN qr_file_id TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE orders ADD COLUMN panel_username TEXT`); } catch (_) {}
try { db.exec(`ALTER TABLE orders ADD COLUMN sub_link TEXT`); } catch (_) {}

db.prepare("UPDATE plans SET panel = 'pasarguard' WHERE panel = 'pasargad'").run();
db.prepare("UPDATE orders SET panel = 'pasarguard' WHERE panel = 'pasargad'").run();

function showPlanList(ctx, panel) {
  const panelData = getPanelByName(panel);
  const panelText = panelData ? panelData.display_name : panel;
  const plans = db.prepare('SELECT * FROM plans WHERE active = 1 AND panel = ? ORDER BY validity ASC, price ASC').all(panel);

  let text = `📦 *پنل ${panelText}*\n\n`;
  if (plans.length === 0) {
    text += 'هیچ پلنی وجود ندارد.';
  } else {
    plans.forEach((p) => {
      text += `▫️ *${escapeMarkdown(p.name)}* | ${p.gb}GB | ${p.validity} روز | ${formatNumber(p.price)} تومان\n`;
    });
  }

  const buttons = [];
  buttons.push([Markup.button.callback('➕ افزودن پلن جدید', `admin_plan_add_${panel}`)]);
  plans.forEach((p) => {
    buttons.push([
      Markup.button.callback(`✏️ ${p.name}`, `admin_plan_edit_${p.id}`),
      Markup.button.callback(`🗑️`, `admin_plan_delete_${p.id}`),
    ]);
  });
  buttons.push([b('بازگشت ◀️', `admin_plans_${panel}`, 'back')]);

  safeEdit(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

const adminState = {};
const userState = {};
let botOff = false;
let buttonStyles = true;
let buttonColors = {
  // Admin panel
  dashboard: 'primary',
  panels: 'default',
  plans: 'default',
  trials: 'success',
  orders: 'danger',
  charges: 'danger',
  users: 'default',
  search: 'default',
  broadcast: 'default',
  botStatus: 'success',
  // User menu
  buy: 'primary',
  myServices: 'default',
  wallet: 'default',
  referral: 'default',
  support: 'default',
  // Buy flow
  panelSelect: 'primary',
  planSelect: 'success',
  payment: 'success',
  // Wallet
  addBalance: 'success',
  // Admin actions
  chargeConfirm: 'success',
  chargeReject: 'danger',
  // Discount
  discount: 'primary',
  // Extra buttons
  backToPlans: 'danger',
  backFromDelete: 'danger',
  // Common
  back: 'danger',
  toggle: 'default',
  delete: 'danger',
  edit: 'default',
  settings: 'default',
};

// === Configurable settings (loaded from DB) ===
let referralReward = 30000;
let minCharge = 10000;
let maxCharge = 2000000;
let welcomeImage = ''; // Feature 1: Welcome image URL
let welcomeMessage = '🎉 به fastxlinebot خوش آمدید!\n\nخوشحالیم که ما را انتخاب کردید. 🌹\nما در تلاشیم تا تجربه‌ای امن، پرسرعت و پایدار از اینترنت آزاد را برای شما فراهم کنیم.\n\n🚀 ویژگی‌های سرویس ما:\n⚡️ سرعت و پایداری بالا\n🛡 امنیت و حریم خصوصی تضمین‌شده\n📞 پشتیبانی پاسخگو\n💰 تعرفه‌های منصفانه و اقتصادی\n\n👇 برای شروع، لطفاً از منوی زیر انتخاب کنید:';
let channelMessage = '⚠️ *عضویت اجباری*\n\nبرای استفاده از ربات، ابتدا در کانال ما عضو شوید:\n\n📢 @{CHANNEL}\n\nپس از عضویت، دکمه زیر را بزنید:';

function loadSettings() {
  const saved = db.prepare("SELECT key, value FROM settings WHERE key IN ('buttonStyles', 'buttonColors', 'botOff', 'referralReward', 'minCharge', 'maxCharge', 'welcomeMessage', 'welcomeImage', 'channelMessage', 'ADMIN_USERNAME', 'CARD_NUMBER', 'CARD_OWNER', 'CHANNEL_USERNAME', 'PANEL_URL', 'PANEL_USERNAME', 'PANEL_PASSWORD', 'group_ids')").all();
  saved.forEach(row => {
    if (row.key === 'buttonStyles') {
      buttonStyles = row.value === 'true';
    } else if (row.key === 'buttonColors') {
      try { buttonColors = { ...buttonColors, ...JSON.parse(row.value) }; } catch (_) {}
    } else if (row.key === 'botOff') {
      botOff = row.value === 'true';
    } else if (row.key === 'referralReward') {
      referralReward = Number(row.value) || 30000;
    } else if (row.key === 'minCharge') {
      minCharge = Number(row.value) || 10000;
    } else if (row.key === 'maxCharge') {
      maxCharge = Number(row.value) || 2000000;
    } else if (row.key === 'welcomeMessage') {
      welcomeMessage = row.value || welcomeMessage;
    } else if (row.key === 'welcomeImage') {
      welcomeImage = row.value || '';
    } else if (row.key === 'channelMessage') {
      channelMessage = row.value || channelMessage;
    } else if (row.key === 'ADMIN_USERNAME') {
      ADMIN_USERNAME = row.value || ADMIN_USERNAME;
    } else if (row.key === 'CARD_NUMBER') {
      CARD_NUMBER = row.value || CARD_NUMBER;
    } else if (row.key === 'CARD_OWNER') {
      CARD_OWNER = row.value || CARD_OWNER;
    } else if (row.key === 'CHANNEL_USERNAME') {
      CHANNEL_USERNAME = row.value || CHANNEL_USERNAME;
    } else if (row.key === 'PANEL_URL') {
      PANEL_URL = row.value || PANEL_URL;
    } else if (row.key === 'PANEL_USERNAME') {
      PANEL_USERNAME = row.value || PANEL_USERNAME;
    } else if (row.key === 'PANEL_PASSWORD') {
      PANEL_PASSWORD = row.value || PANEL_PASSWORD;
    } else if (row.key === 'group_ids') {
      try { discoveredGroupIds = JSON.parse(row.value); } catch (_) {}
    }
  });
  // Clear cached token so it re-authenticates with potentially new credentials
  panelToken = null;
  panelTokenExpiry = 0;
}

function saveSettings() {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('buttonStyles', String(buttonStyles));
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('buttonColors', JSON.stringify(buttonColors));
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('botOff', String(botOff));
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('referralReward', String(referralReward));
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('minCharge', String(minCharge));
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('maxCharge', String(maxCharge));
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('welcomeMessage', String(welcomeMessage));
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('welcomeImage', String(welcomeImage));
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('channelMessage', String(channelMessage));
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('ADMIN_USERNAME', String(ADMIN_USERNAME));
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('CARD_NUMBER', String(CARD_NUMBER));
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('CARD_OWNER', String(CARD_OWNER));
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('CHANNEL_USERNAME', String(CHANNEL_USERNAME));
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('PANEL_URL', String(PANEL_URL));
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('PANEL_USERNAME', String(PANEL_USERNAME));
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('PANEL_PASSWORD', String(PANEL_PASSWORD));
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('group_ids', JSON.stringify(discoveredGroupIds));
  panelToken = null; // Force new token after panel change
  detectedApiPath = null; // Clear detected API path
  // Re-discover groups for new panel
  discoverGroupIds().catch(() => {});
}

loadSettings();
// Discover group IDs on startup
discoverGroupIds().catch(() => {});

function ensureUser(ctx) {
  const userId = ctx.from.id;
  const username = ctx.from.username || '';
  const firstName = ctx.from.first_name || '';
  const existing = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
  if (!existing) {
    db.prepare('INSERT INTO users (user_id, username, first_name) VALUES (?, ?, ?)').run(userId, username, firstName);
  }
  return db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
}

function isBanned(userId) {
  const user = db.prepare('SELECT banned FROM users WHERE user_id = ?').get(userId);
  return user && user.banned === 1;
}

async function isChannelMember(userId) {
  try {
    const member = await bot.telegram.getChatMember(`@${CHANNEL_USERNAME}`, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (err) {
    // Fallback: try to invite the user — if they're already a member, Telegram returns USER_ALREADY_PARTICIPANT
    try {
      await bot.telegram.unbanChatMember(`@${CHANNEL_USERNAME}`, userId, { only_if_banned: true });
      // If unban succeeds without error, they were a banned member — treat as member
      return true;
    } catch (inviteErr) {
      const msg = inviteErr.message || '';
      if (msg.includes('USER_ALREADY_PARTICIPANT') || msg.includes('already a member') || msg.includes('user is already')) {
        return true;
      }
      if (msg.includes('USER_NOT_PARTICIPANT') || msg.includes('not a member') || msg.includes('CHAT_WRITE_FORBIDDEN') || msg.includes('have no rights')) {
        return false;
      }
      console.error('Channel check error:', err.message, '| Fallback error:', msg);
      return false;
    }
  }
}

function channelJoinMessage() {
  return {
    text: channelMessage.replace('{CHANNEL}', CHANNEL_USERNAME),
    ...Markup.inlineKeyboard([
      [Markup.button.url('📢 عضویت در کانال', `https://t.me/${CHANNEL_USERNAME}`)],
      [Markup.button.callback('✅ عضو شدم', 'check_membership')],
    ]),
  };
}

function getWallet(userId) {
  const user = db.prepare('SELECT wallet FROM users WHERE user_id = ?').get(userId);
  return user ? user.wallet : 0;
}

function formatNumber(n) {
  return n.toLocaleString('en-US');
}

function escapeMarkdown(s) {
  return String(s).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

async function safeAnswer(ctx) {
  try { await ctx.answerCbQuery(); } catch (_) {}
}

async function safeEdit(ctx, text, options = {}) {
  try {
    await ctx.editMessageText(text, options);
  } catch (_) {}
}

// Feature 3: Loading message helper
async function showLoading(ctx, message = '⏳ در حال پردازش...') {
  try {
    return await ctx.reply(message);
  } catch (_) { return null; }
}

async function deleteMessage(ctx, msg) {
  if (!msg || !msg.message_id) return;
  try {
    await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id);
  } catch (_) {}
}

function b(text, data, colorKey) {
  const btn = Markup.button.callback(text, data);
  if (buttonStyles && colorKey && buttonColors[colorKey]) {
    btn.style = buttonColors[colorKey];
  }
  return btn;
}

function getPlans() {
  return db.prepare('SELECT * FROM plans WHERE active = 1 ORDER BY price ASC').all();
}

function getPlansByPanel(panel) {
  return db.prepare('SELECT * FROM plans WHERE active = 1 AND panel = ? ORDER BY price ASC').all(panel);
}

function getPlanByGb(gb, panel = 'pasarguard') {
  return db.prepare('SELECT * FROM plans WHERE gb = ? AND active = 1 AND panel = ?').get(gb, panel);
}

function getActivePanels() {
  return db.prepare('SELECT * FROM panels WHERE active = 1 ORDER BY id ASC').all();
}

function getAllPanels() {
  return db.prepare('SELECT * FROM panels ORDER BY id ASC').all();
}

function getPanelByName(name) {
  return db.prepare('SELECT * FROM panels WHERE name = ?').get(name);
}

function getAllPlans() {
  return db.prepare('SELECT * FROM plans ORDER BY price ASC').all();
}

function mainMenu() {
  return Markup.inlineKeyboard([
    [b('🔐 خرید سرویس', 'buy_sub', 'buy')],
    [b('🎁 تست رایگان', 'free_test', 'trials')],
    [b('💰 کیف پول', 'wallet', 'wallet'), b('🛍️ سرویس‌های من', 'my_services', 'myServices')],
    [b('👥 دعوت دوستان', 'referral', 'referral'), b('👤 پشتیبانی', 'support', 'support')],
  ]);
}

function adminMenu() {
  const pendingOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'pending'").get().c;
  const pendingCharges = db.prepare("SELECT COUNT(*) as c FROM charges WHERE status = 'waiting_admin'").get().c;
  const totalUsers = db.prepare("SELECT COUNT(*) as c FROM users").get().c;
  const totalTrials = db.prepare("SELECT COUNT(*) as c FROM free_trials WHERE active = 1").get().c;
  const totalPanels = db.prepare("SELECT COUNT(*) as c FROM panels WHERE active = 1").get().c;
  const botStatus = botOff ? '🔴 ربات خاموش است' : '🟢 ربات روشن است';

  return Markup.inlineKeyboard([
    [b('📊 آمار و داشبورد', 'admin_dashboard', 'dashboard')],
    [
      b(`🖥 پنل‌ها (${totalPanels})`, 'admin_panels', 'panels'),
      b(`📦 مدیریت پلن‌ها`, 'admin_plans', 'plans'),
    ],
    [
      b(`💰 شارژها (${pendingCharges})`, 'admin_charges', 'charges'),
      b(`👥 کاربران (${totalUsers})`, 'admin_users', 'users'),
    ],
    [
      b(`🔍 جستجوی کاربر`, 'admin_search_user', 'search'),
      b(`📢 پیام همگانی`, 'admin_broadcast', 'broadcast'),
    ],
    [b(`${botStatus}`, 'admin_toggle_bot', 'botStatus')],
    [b('🔄 تغییر پنل', 'admin_quick_panel', 'panels')],
    [b('⚙️ تنظیمات ربات', 'admin_bot_settings', 'settings')],
    [b('🎨 تنظیمات رنگ دکمه‌ها', 'admin_color_settings', 'toggle')],
    [b('💾 بکاپ کامل', 'admin_backup', 'settings')],
  ]);
}

bot.use(async (ctx, next) => {
  // DEBUG: Log ALL callback queries
  if (ctx.updateType === 'callback_query') {
  }

  // Register user IMMEDIATELY on any interaction (before channel check)
  if (ctx.from && ctx.from.id !== ADMIN_ID) {
    ensureUser(ctx);
  }

  if (botOff && ctx.from && ctx.from.id !== ADMIN_ID) {
    if (ctx.updateType === 'callback_query') {
      await safeAnswer(ctx);
      return safeEdit(ctx, '🔴 ربات در حال حاضر خاموش است.\nلطفاً بعداً تلاش کنید.');
    }
  }

  if (ctx.from && ctx.from.id !== ADMIN_ID) {
    if (ctx.updateType === 'callback_query' && ctx.callbackQuery.data === 'check_membership') {
      await safeAnswer(ctx);
      const isMember = await isChannelMember(ctx.from.id);
      if (isMember) {
        return safeEdit(ctx, '✅ عضویت شما تایید شد!\n\nاکنون می‌توانید از ربات استفاده کنید.', mainMenu());
      }
      return safeEdit(ctx, '❌ شما هنوز عضو کانال نشده‌اید!\n\nلطفاً ابتدا در کانال عضو شوید و سپس دوباره تلاش کنید.', Markup.inlineKeyboard([
        [Markup.button.url('📢 عضویت در کانال', `https://t.me/${CHANNEL_USERNAME}`)],
        [Markup.button.callback('🔄 بررسی مجدد', 'check_membership')],
      ]));
    }

    const isMember = await isChannelMember(ctx.from.id);
    if (!isMember) {
      if (ctx.updateType === 'callback_query') {
        await safeAnswer(ctx);
        // Try edit first, fallback to reply
        const channelText = '⚠️ *عضویت اجباری*\n\nبرای استفاده از ربات، ابتدا در کانال ما عضو شوید:\n\n📢 @' + CHANNEL_USERNAME + '\n\nپس از عضویت، دکمه زیر را بزنید:';
        const channelButtons = Markup.inlineKeyboard([
          [Markup.button.url('📢 عضویت در کانال', `https://t.me/${CHANNEL_USERNAME}`)],
          [Markup.button.callback('✅ عضو شدم', 'check_membership')],
        ]);
        try {
          await ctx.editMessageText(channelText, { parse_mode: 'Markdown', ...channelButtons });
        } catch (_) {
          try {
            await ctx.reply(channelText, { parse_mode: 'Markdown', ...channelButtons });
          } catch (_) {}
        }
        return;
      }
      return ctx.reply(channelJoinMessage().text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([
        [Markup.button.url('📢 عضویت در کانال', `https://t.me/${CHANNEL_USERNAME}`)],
        [Markup.button.callback('✅ عضو شدم', 'check_membership')],
      ]) });
    }
  }

  if (ctx.updateType === 'callback_query') {
  }
  return next();
});

bot.start(async (ctx) => {
  const existingUser = db.prepare('SELECT * FROM users WHERE user_id = ?').get(ctx.from.id);
  const user = ensureUser(ctx);
  if (isBanned(ctx.from.id)) return ctx.reply('❌ حساب شما مسدود شده است.');

  const payload = ctx.startPayload;
  console.log('[START] User:', ctx.from.id, 'Existing:', !!existingUser, 'Payload:', payload);

  if (payload && payload.startsWith('ref_')) {
    const referrerId = Number(payload.replace('ref_', ''));
    const newUserId = ctx.from.id;
    console.log('[REFERRAL] Payload:', payload, 'ReferrerId:', referrerId, 'NewUserId:', newUserId, 'ExistingUser:', !!existingUser);

    // Validate referral reward amount
    if (referralReward <= 0) {
      console.log('[REFERRAL] ❌ Skip: referralReward is', referralReward);
    }

    // Only give reward if user has no referral yet
    const currentUser = db.prepare('SELECT referred_by FROM users WHERE user_id = ?').get(newUserId);
    console.log('[REFERRAL] CurrentUser referred_by:', currentUser?.referred_by);

    if (referrerId && referrerId !== newUserId && referralReward > 0 && (!currentUser || !currentUser.referred_by)) {
      const referrer = db.prepare('SELECT * FROM users WHERE user_id = ?').get(referrerId);
      console.log('[REFERRAL] Referrer row:', referrer ? { id: referrer.user_id, banned: referrer.banned, username: referrer.username } : 'NOT FOUND');

      if (referrer && !referrer.banned && referrerId !== ADMIN_ID) {
        const insertReferral = db.transaction((referrerId, userId) => {
          db.prepare('UPDATE users SET referred_by = ? WHERE user_id = ?').run(referrerId, userId);
          db.prepare('UPDATE users SET wallet = wallet + ? WHERE user_id = ?').run(referralReward, referrerId);
        });
        try {
          insertReferral(referrerId, newUserId);
          console.log('[REFERRAL] ✅ Reward given to:', referrerId, 'amount:', referralReward);
          bot.telegram.sendMessage(referrerId, `🎉 کاربر جدید با لینک دعوت شما وارد ربات شد!\n\n💰 *${formatNumber(referralReward)} تومان* به کیف پول شما اضافه شد!`, { parse_mode: 'Markdown' }).catch(() => {});
        } catch (err) {
          console.error('[REFERRAL] ❌ Transaction error:', err.message);
          bot.telegram.sendMessage(ADMIN_ID, `❌ خطای دیتابیس در رفرال:\n${err.message}\nReferrer: ${referrerId}, New: ${newUserId}`).catch(() => {});
        }
      } else if (!referrer) {
        console.log('[REFERRAL] ❌ Skip: referrer not in database (never started bot)');
        bot.telegram.sendMessage(ADMIN_ID, `⚠️ رفرال ناموفق: دعوت‌کننده (${referrerId}) در دیتابیس نیست. او ربات رو استارت نزده.`).catch(() => {});
      } else if (referrer.banned) {
        console.log('[REFERRAL] ❌ Skip: referrer is banned');
      } else if (referrerId === ADMIN_ID) {
        console.log('[REFERRAL] ❌ Skip: referrer is admin');
      }
    } else if (currentUser && currentUser.referred_by) {
      console.log('[REFERRAL] ❌ Skip: user already has referral (ID:', newUserId, ')');
    } else if (referrerId === newUserId) {
      console.log('[REFERRAL] ❌ Skip: self-referral');
    } else if (referralReward <= 0) {
      console.log('[REFERRAL] ❌ Skip: referralReward <= 0');
      bot.telegram.sendMessage(ADMIN_ID, `⚠️ رفرال ناموفق: مبلغ جایزه (referralReward) روی ${referralReward} ست شده. در تنظیمات ادمین اصلاح کنید.`).catch(() => {});
    } else {
      console.log('[REFERRAL] ❌ Skip: invalid referrer or condition not met');
    }
  }

  if (ctx.from.id === ADMIN_ID) {
    return ctx.reply('🔒 پنل مدیریت', adminMenu());
  }
  if (botOff) {
    return ctx.reply('🔴 ربات در حال حاضر خاموش است.\nلطفاً بعداً تلاش کنید.');
  }

  // Feature 1: Welcome with image - only for NEW users
  if (welcomeImage && !existingUser) {
    try {
      await ctx.replyWithPhoto(welcomeImage, {
        caption: welcomeMessage,
        parse_mode: 'Markdown',
        ...mainMenu(),
      });
      return;
    } catch (_) {}
  }
  ctx.reply(welcomeMessage, mainMenu());
});

bot.command('admin', (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  ctx.reply('🔒 پنل مدیریت', adminMenu());
});

bot.command('buy', (ctx) => {
  ensureUser(ctx);
  if (isBanned(ctx.from.id)) return ctx.reply('❌ حساب شما مسدود شده است.');
  if (botOff) return ctx.reply('🔴 ربات در حال حاضر خاموش است.\nلطفاً بعداً تلاش کنید.');
  ctx.reply('📦 *خرید سرویس*\n\nپنل مورد نظر خود را انتخاب کنید:', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      ...getActivePanels().map(p => [b(`🔹 ${p.display_name}`, `select_${p.name}`, 'primary')]),
      [b('بازگشت ◀️', 'back_to_menu', 'back')],
    ]),
  });
});

bot.command('menu', (ctx) => {
  ensureUser(ctx);
  if (isBanned(ctx.from.id)) return ctx.reply('❌ حساب شما مسدود شده است.');
  if (ctx.from.id === ADMIN_ID) return ctx.reply('🔒 پنل مدیریت', adminMenu());
  ctx.reply('لطفاً یکی از گزینه‌های زیر را انتخاب کنید:', mainMenu());
});

bot.command('renew', (ctx) => {
  ensureUser(ctx);
  if (isBanned(ctx.from.id)) return ctx.reply('❌ حساب شما مسدود شده است.');
  if (botOff) return ctx.reply('🔴 ربات در حال حاضر خاموش است.\nلطفاً بعداً تلاش کنید.');
  const orders = db.prepare("SELECT * FROM orders WHERE user_id = ? AND status = 'delivered' ORDER BY created_at DESC").all(ctx.from.id);
  if (orders.length === 0) return ctx.reply('❌ شما سرویس فعالی ندارید.\nابتدا یک اشتراک خریداری کنید.', mainMenu());
  const latest = orders[0];
  const plan = getPlanByGb(latest.plan_gb, latest.panel || 'pasarguard');
  if (!plan) return ctx.reply('❌ پلن یافت نشد.', mainMenu());

  const wallet = getWallet(ctx.from.id);
  const canPay = wallet >= plan.price;

  ctx.reply(
    `♻️ *تمدید سرویس*\n\n` +
    `🔹 سرویس قبلی: ${escapeMarkdown(plan.name)}\n` +
    `🔹 مدت: ${plan.validity} روز\n` +
    `🔹 قیمت: ${formatNumber(plan.price)} تومان\n` +
    `💰 موجودی کیف پول: ${formatNumber(wallet)} تومان\n\n` +
    (canPay ? `✅ موجودی کافی است` : `❌ موجودی کافی نیست`),
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([
      canPay
        ? [b(`💳 تمدید - ${formatNumber(plan.price)} تومان`, `pay_${plan.gb}_${latest.panel || 'pasarguard'}`, 'primary')]
        : [b('💰 افزایش موجودی', 'add_balance', 'addBalance')],
      [b('بازگشت ◀️', 'back_to_menu', 'back')],
    ])}
  );
});

bot.command('services', (ctx) => {
  ensureUser(ctx);
  if (isBanned(ctx.from.id)) return ctx.reply('❌ حساب شما مسدود شده است.');
  const orders = db.prepare("SELECT * FROM orders WHERE user_id = ? AND status = 'delivered' ORDER BY created_at DESC").all(ctx.from.id);
  if (orders.length === 0) return ctx.reply('🛍️ شما هنوز سرویسی خریداری نکرده‌اید.', mainMenu());
  let text = '🛍️ *سرویس‌های شما*\n\n';
  orders.forEach((o, i) => {
    text += `${i + 1}. ${escapeMarkdown(o.plan_name)} | ${o.validity} روز | ${formatNumber(o.price)} تومان\n   📅 ${o.created_at}\n\n`;
  });
  ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[b('بازگشت به منوی اصلی ◀️', 'back_to_menu', 'back')]]) });
});

bot.command('wallet', (ctx) => {
  ensureUser(ctx);
  if (isBanned(ctx.from.id)) return ctx.reply('❌ حساب شما مسدود شده است.');
  const wallet = getWallet(ctx.from.id);
  ctx.reply(`🏦 *کیف پول*\n\nموجودی فعلی شما: *${formatNumber(wallet)}* تومان`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('➕ افزایش موجودی', 'add_balance')],
      [b('بازگشت به منوی اصلی ◀️', 'back_to_menu', 'back')],
    ]),
  });
});

bot.command('support', (ctx) => {
  ctx.reply(`👤 پشتیبانی\n\nبرای ارتباط با پشتیبانی:\n🆔 @${ADMIN_USERNAME}\n⏰ پاسخگویی در ساعات کاری.`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📞 پیام به پشتیبانی', url: `https://t.me/${ADMIN_USERNAME}` }],
        [{ text: 'بازگشت به منوی اصلی ◀️', callback_data: 'back_to_menu', style: buttonStyles ? 'danger' : undefined }],
      ],
    },
  });
});

bot.command('referral', (ctx) => {
  ensureUser(ctx);
  if (isBanned(ctx.from.id)) return ctx.reply('❌ حساب شما مسدود شده است.');
  const userId = ctx.from.id;
  const referralCount = db.prepare('SELECT COUNT(*) as c FROM users WHERE referred_by = ?').get(userId).c;
  const botInfo = bot.botInfo;
  const referralLink = `https://t.me/${botInfo.username}?start=ref_${userId}`;
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('🚀 با استفاده از این لینک به ربات fastxlinebot بپیوندید و از تخفیف ویژه بهره‌مند شوید:')}`;
  ctx.reply(
    `👥 *سیستم دعوت دوستان*\n\n` +
    `🎁 با دعوت هر دوستان خود *${formatNumber(referralReward)} تومان* جایزه بگیرید!\n\n` +
    `🔗 لینک دعوت شما:\n\`${referralLink}\`\n\n` +
    `📊 آمار دعوت:\n` +
    `   ▫️ تعداد دعوت شده: *${referralCount}* نفر`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([
      [Markup.button.url('📤 ارسال لینک دعوت', shareUrl)],
      [b('بازگشت ◀️', 'back_to_menu', 'back')],
    ]) }
  );
});

bot.action('back_to_menu', async (ctx) => {
  safeAnswer(ctx);
  delete userState[ctx.from.id];
  delete adminState[ctx.from.id];
  if (ctx.from.id === ADMIN_ID) {
    try {
      await ctx.editMessageText('🔒 پنل مدیریت', adminMenu());
    } catch (_) {
      await ctx.reply('🔒 پنل مدیریت', adminMenu());
    }
    return;
  }
  try {
    await ctx.editMessageText('لطفاً یکی از گزینه‌های زیر را انتخاب کنید:', mainMenu());
  } catch (_) {
    await ctx.reply('لطفاً یکی از گزینه‌های زیر را انتخاب کنید:', mainMenu());
  }
});

bot.action('referral', (ctx) => {
  safeAnswer(ctx);
  if (isBanned(ctx.from.id)) return;
  const userId = ctx.from.id;
  const referralCount = db.prepare('SELECT COUNT(*) as c FROM users WHERE referred_by = ?').get(userId).c;
  const botInfo = bot.botInfo;
  const referralLink = `https://t.me/${botInfo.username}?start=ref_${userId}`;
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('🚀 با استفاده از این لینک به ربات fastxlinebot بپیوندید و از تخفیف ویژه بهره‌مند شوید:')}`;
  safeEdit(ctx,
    `👥 *سیستم دعوت دوستان*\n\n` +
    `🎁 با دعوت هر دوستان خود *${formatNumber(referralReward)} تومان* جایزه بگیرید!\n\n` +
    `🔗 لینک دعوت شما:\n\`${referralLink}\`\n\n` +
    `📊 آمار دعوت:\n` +
    `   ▫️ تعداد دعوت شده: *${referralCount}* نفر`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([
      [Markup.button.url('📤 ارسال لینک دعوت', shareUrl)],
      [b('بازگشت ◀️', 'back_to_menu', 'back')],
    ]) }
  );
});

bot.action('admin_toggle_bot', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  botOff = !botOff;
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('botOff', String(botOff));
  const status = botOff ? '🔴 ربات خاموش شد' : '🟢 ربات روشن شد';
  safeEdit(ctx, `✅ ${status}\n\n${botOff ? 'کاربران اکنون پیام خاموشی دریافت می‌کنند.' : 'ربات به حالت عادی بازگشت.'}`);
  setTimeout(() => safeEdit(ctx, '🔒 پنل مدیریت', adminMenu()), 2000);
});

bot.action('admin_color_settings', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const s = buttonStyles ? 'فعال ✅' : 'غیرفعال ❌';
  const colorNames = { default: '⬜', primary: '🔵', success: '🟢', danger: '🔴' };
  const btnNames = {
    dashboard: '📊 داشبورد', panels: '🖥 پنل‌ها', plans: '📦 پلن‌ها',
    trials: '🎁 تست رایگان', orders: '📋 سفارشات', charges: '💰 شارژها',
    users: '👥 کاربران', search: '🔍 جستجو', broadcast: '📢 پیام همگانی', botStatus: '🟢/🔴 وضعیت ربات',
    buy: '🔐 خرید سرویس', myServices: '🛍️ سرویس‌های من',
    wallet: '🏦 کیف پول', referral: '👥 دعوت دوستان', support: '👤 پشتیبانی',
    panelSelect: '🔹 انتخاب پنل', planSelect: '📦 انتخاب پلن', payment: '💳 پرداخت',
    addBalance: '➕ افزایش موجودی',
    chargeConfirm: '✅ تایید شارژ', chargeReject: '❌ رد شارژ',
    discount: '🏷️ کد تخفیف', settings: '⚙️ تنظیمات',
    back: '◀️ بازگشت', toggle: '🔄 تغییر وضعیت', delete: '🗑️ حذف', edit: '✏️ ویرایش',
  };

  const mkBtn = (key) => ({
    text: `${btnNames[key]}: ${colorNames[buttonColors[key]]} ${buttonColors[key]}`,
    callback_data: `admin_set_color_${key}`,
    style: buttonStyles ? buttonColors[key] : undefined,
  });

  safeEdit(ctx, `🎨 *تنظیمات رنگ دکمه‌ها*\nوضعیت: ${s}`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      // Admin panel section
      [{ text: '── پنل مدیریت ──', callback_data: 'noop' }],
      [mkBtn('dashboard')],
      [mkBtn('panels'), mkBtn('plans')],
      [mkBtn('trials'), mkBtn('orders')],
      [mkBtn('charges'), mkBtn('users')],
      [mkBtn('search'), mkBtn('broadcast')],
      [mkBtn('botStatus')],
      // User menu section
      [{ text: '── منوی کاربر ──', callback_data: 'noop' }],
      [mkBtn('buy')],
      [mkBtn('myServices')],
      [mkBtn('wallet')],
      [mkBtn('referral'), mkBtn('support')],
      // Buy flow section
      [{ text: '── فرآیند خرید ──', callback_data: 'noop' }],
      [mkBtn('panelSelect'), mkBtn('planSelect')],
      // Wallet section
      [{ text: '── کیف پول ──', callback_data: 'noop' }],
      [mkBtn('addBalance')],
      // Admin actions section
      [{ text: '── اقدامات ادمین ──', callback_data: 'noop' }],
      [mkBtn('chargeConfirm'), mkBtn('chargeReject')],
      [mkBtn('discount'), mkBtn('settings')],
      // Common section
      [{ text: '── عمومی ──', callback_data: 'noop' }],
      [mkBtn('back'), mkBtn('toggle')],
      [mkBtn('delete'), mkBtn('edit')],
      // Controls
      [{ text: buttonStyles ? '⬜ غیرفعال کردن رنگ‌ها' : '🎨 فعال کردن رنگ‌ها', callback_data: 'admin_toggle_style' }],
      [{ text: 'بازگشت ◀️', callback_data: 'back_to_menu', style: buttonStyles ? 'danger' : undefined }],
    ]),
  });
});

bot.action('noop', (ctx) => { safeAnswer(ctx); });

bot.action(/^admin_set_color_(\w+)$/, (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const colorKey = ctx.match[1];
  if (!buttonColors.hasOwnProperty(colorKey)) return;

  const currentColor = buttonColors[colorKey];
  const colorOptions = ['default', 'primary', 'success', 'danger'];
  const colorNames = { default: '⬜ خاکستری', primary: '🔵 آبی', success: '🟢 سبز', danger: '🔴 قرمز' };

  const buttons = colorOptions.map(c => ({
    text: `${colorNames[c]}${c === currentColor ? ' ✅' : ''}`,
    callback_data: `admin_pick_color_${colorKey}_${c}`,
    style: buttonStyles ? c : undefined,
  }));

  const btnNames = {
    // Admin panel
    dashboard: 'داشبورد', panels: 'پنل‌ها', plans: 'پلن‌ها', trials: 'تست رایگان',
    orders: 'سفارشات', charges: 'شارژها', users: 'کاربران', search: 'جستجو',
    broadcast: 'پیام همگانی', botStatus: 'وضعیت ربات',
    // User menu
    buy: 'خرید سرویس', myServices: 'سرویس‌های من',
    wallet: 'کیف پول', referral: 'دعوت دوستان', support: 'پشتیبانی',
    // Buy flow
    panelSelect: 'انتخاب پنل', planSelect: 'انتخاب پلن', payment: 'پرداخت',
    // Wallet
    addBalance: 'افزایش موجودی',
    // Admin actions
    chargeConfirm: 'تایید شارژ', chargeReject: 'رد شارژ',
    discount: 'کد تخفیف', settings: 'تنظیمات',
    // Common
    back: 'بازگشت', toggle: 'تغییر وضعیت', delete: 'حذف', edit: 'ویرایش',
  };

  safeEdit(ctx, `🎨 رنگ "${btnNames[colorKey]}" را انتخاب کنید:`, Markup.inlineKeyboard([
    buttons,
    [{ text: 'بازگشت ◀️', callback_data: 'admin_color_settings' }],
  ]));
});

bot.action(/^admin_pick_color_(\w+)_(\w+)$/, (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const colorKey = ctx.match[1];
  const color = ctx.match[2];
  if (!buttonColors.hasOwnProperty(colorKey)) return;

  buttonColors[colorKey] = color;
  saveSettings();
  const colorNames = { default: 'خاکستری', primary: 'آبی', success: 'سبز', danger: 'قرمز' };
  const btnNames = {
    // Admin panel
    dashboard: 'داشبورد', panels: 'پنل‌ها', plans: 'پلن‌ها', trials: 'تست رایگان',
    orders: 'سفارشات', charges: 'شارژها', users: 'کاربران', search: 'جستجو',
    broadcast: 'پیام همگانی', botStatus: 'وضعیت ربات',
    // User menu
    buy: 'خرید سرویس', myServices: 'سرویس‌های من',
    wallet: 'کیف پول', referral: 'دعوت دوستان', support: 'پشتیبانی',
    // Buy flow
    panelSelect: 'انتخاب پنل', planSelect: 'انتخاب پلن', payment: 'پرداخت',
    // Wallet
    addBalance: 'افزایش موجودی',
    // Admin actions
    chargeConfirm: 'تایید شارژ', chargeReject: 'رد شارژ',
    // Common
    back: 'بازگشت', toggle: 'تغییر وضعیت', delete: 'حذف', edit: 'ویرایش',
  };

  safeEdit(ctx, `✅ رنگ "${btnNames[colorKey]}" به ${colorNames[color]} تغییر کرد.`);
  setTimeout(() => {
    bot.telegram.editMessageText(ctx.chat.id, ctx.callbackQuery.message.message_id, undefined,
      '🎨 تنظیمات رنگ هر دکمه', {
        ...Markup.inlineKeyboard([
          [{ text: 'بازگشت به تنظیمات ◀️', callback_data: 'admin_color_settings' }],
        ]),
      }
    );
  }, 1000);
});

bot.action('admin_toggle_style', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  buttonStyles = !buttonStyles;
  saveSettings();
  setTimeout(() => {
    bot.telegram.editMessageText(ctx.chat.id, ctx.callbackQuery.message.message_id, undefined,
      '🎨 تنظیمات رنگ هر دکمه', {
        ...Markup.inlineKeyboard([
          [{ text: 'بازگشت به تنظیمات ◀️', callback_data: 'admin_color_settings' }],
        ]),
      }
    );
  }, 500);
});

bot.action('cancel_charge', (ctx) => {
  safeAnswer(ctx);
  delete userState[ctx.from.id];
  safeEdit(ctx, '❌ درخواست شارژ لغو شد.', mainMenu());
});

bot.action('buy_sub', (ctx) => {
  safeAnswer(ctx);
  if (isBanned(ctx.from.id)) return;
  const text =
    `📦 *خرید سرویس*\n\n` +
    `پنل مورد نظر خود را انتخاب کنید:`;

  const buttons = [
    ...getActivePanels().map(p => [b(`🔹 ${p.display_name}`, `select_${p.name}`, 'panelSelect')]),
    [b('بازگشت ◀️', 'back_to_menu', 'back')],
  ];

  safeEdit(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('free_test', async (ctx) => {
  safeAnswer(ctx);
  if (isBanned(ctx.from.id)) return;

  // Atomic check + lock: mark as used IMMEDIATELY to prevent race condition
  const user = db.prepare('SELECT used_free_test FROM users WHERE user_id = ?').get(ctx.from.id);
  if (!user) return safeEdit(ctx, '❌ خطای سیستمی.', mainMenu());
  if (user.used_free_test === 1) {
    return safeEdit(ctx, '⚠️ شما قبلاً از تست رایگان استفاده کرده‌اید.\nهر کاربر فقط یک بار می‌تواند تست رایگان دریافت کند.', mainMenu());
  }

  // Mark as used BEFORE API call to prevent double-claim race condition
  const lockResult = db.prepare('UPDATE users SET used_free_test = 1 WHERE user_id = ? AND used_free_test = 0').run(ctx.from.id);
  if (lockResult.changes === 0) {
    return safeEdit(ctx, '⚠️ شما قبلاً از تست رایگان استفاده کرده‌اید.', mainMenu());
  }

  try {
    await ctx.editMessageText('🔄 در حال ایجاد سرویس تست... لطفاً صبر کنید.');

    // Create user on panel (100MB for 24h)
    const panelUsername = 'fastxline_trial_' + Math.floor(1000 + Math.random() * 9000);
    const expireUnix = Math.floor(Date.now() / 1000) + 86400; // +24h
    const dataLimitBytes = 100 * 1024 * 1024; // 100 MB

    // === Create user with ALL groups selected ===
    // group_ids: [1, 2] selects both "Exclusive" and "Standard" groups
    const userPayload = {
      username: panelUsername,
      data_limit: dataLimitBytes,
      expire: expireUnix,
      note: 'Free trial from bot | User: ' + ctx.from.id,
      group_ids: discoveredGroupIds.length > 0 ? discoveredGroupIds : [1, 2],  // Auto-discovered groups
    };

    const created = await panelApi('POST', '/user', userPayload);

    if (!created || !created.username) {
      db.prepare('UPDATE users SET used_free_test = 0 WHERE user_id = ?').run(ctx.from.id);
      throw new Error(JSON.stringify(created));
    }

    const subUrl = created.subscription_url.startsWith('http') ? created.subscription_url : 'https://' + new URL(PANEL_URL).host + created.subscription_url;
    let expireDate = '';
    if (created.expire) {
      const d = new Date(created.expire);
      expireDate = d.toLocaleDateString('fa-IR');
    }

    const volumeMB = Math.round(dataLimitBytes / (1024 * 1024));

    const trialMessage =
      `✅ *سرویس با موفقیت ایجاد شد*\n\n` +
      `🌿 *نام سرویس:* تست رایگان\n` +
      `⏳ *مدت زمان:* ${expireDate ? expireDate : '۲۴ ساعت'}\n` +
      `🗜 *حجم سرویس:* ${volumeMB} مگابایت\n\n` +
      `🔗 *لینک اتصال:*\n\`${subUrl}\`\n\n` +
      `📱 برای اتصال از کلاینت‌های V2Ray استفاده کنید.`;

    // Generate QR code via API
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(subUrl)}`;

    try {
      await ctx.replyWithPhoto(qrUrl, {
        caption: trialMessage,
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[b('بازگشت ◀️', 'back_to_menu', 'back')]]),
      });
    } catch (_) {
      safeEdit(ctx, trialMessage, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[b('بازگشت ◀️', 'back_to_menu', 'back')]])
      });
    }

  } catch (err) {
    console.error('Free trial error:', err.message);
    try {
      await ctx.editMessageText('❌ خطا در ایجاد سرویس تست.\nلطفاً بعداً تلاش کنید یا با پشتیبانی تماس بگیرید.', mainMenu());
    } catch (_) {
      await ctx.reply('❌ خطا در ایجاد سرویس تست.\nلطفاً بعداً تلاش کنید یا با پشتیبانی تماس بگیرید.', mainMenu());
    }
  }
});

bot.action(/^select_([\w]+)$/, (ctx) => {
  safeAnswer(ctx);
  if (isBanned(ctx.from.id)) return;
  const panelName = ctx.match[1];
  const panel = getPanelByName(panelName);
  if (!panel) return safeEdit(ctx, '❌ پنل یافت نشد.', mainMenu());

  // Show all plans directly (no duration selection)
  const plans = db.prepare('SELECT * FROM plans WHERE active = 1 AND panel = ? ORDER BY price ASC').all(panelName);
  if (plans.length === 0) {
    return safeEdit(ctx, '❌ پلنی برای این پنل موجود نیست.', Markup.inlineKeyboard([
      [b('بازگشت ◀️', 'buy_sub', 'back')],
    ]));
  }
  const buttons = plans.map((p) => [
    b(`${p.validity} روز | ${formatNumber(p.price)} تومان | ${p.name}`, `plan_${p.gb}_${panelName}`, 'planSelect'),
  ]);
  buttons.push([b('بازگشت ◀️', 'buy_sub', 'back')]);
  safeEdit(ctx, `📦 *پلن‌های ${panel.display_name}*\n\nپلن مورد نظر خود را انتخاب کنید:`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^plan_(\d+)_(pasarguard|economic|[\w]+)(_2m)?$/, (ctx) => {
  safeAnswer(ctx);
  if (isBanned(ctx.from.id)) return;
  const gb = Number(ctx.match[1]);
  const panel = ctx.match[2];
  const plan = getPlanByGb(gb, panel);
  if (!plan) return safeEdit(ctx, '❌ این پلن دیگر موجود نیست.', mainMenu());

  const validity = plan.validity;
  const price = plan.price;
  const wallet = getWallet(ctx.from.id);
  const text =
    `📋 *جزئیات سفارش*\n\n` +
    `🔹 نام سرویس: ${escapeMarkdown(plan.name)}\n` +
    `🔹 مدت اعتبار: ${validity} روز\n` +
    `🔹 قیمت: ${formatNumber(price)} تومان\n` +
    `🔹 موجودی کیف پول شما: ${formatNumber(wallet)} تومان`;

  const payAction = `pay_${plan.gb}_${panel}`;
  const buttons = [
    [b('💳 پرداخت و دریافت سرویس', payAction, 'payment')],
    [b('🏷️ استفاده از کد تخفیف', `discount_apply_${plan.gb}_${panel}`, 'discount')],
    [b('بازگشت به منوی اصلی ◀️', 'back_to_menu', 'back')],
  ];

  safeEdit(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^discount_apply_(\d+)_(pasarguard|economic)$/, (ctx) => {
  safeAnswer(ctx);
  if (isBanned(ctx.from.id)) return;
  const gb = Number(ctx.match[1]);
  const panel = ctx.match[2];
  userState[ctx.from.id] = { action: 'wait_discount_code', gb, panel };
  safeEdit(ctx, '🏷️ *کد تخفیف*\n\n📝 کد تخفیف خود را ارسال کنید:', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[b('لغو', 'back_to_menu', 'back')]]),
  });
});

bot.action(/^pay_(\d+)_(pasarguard|economic)(_2m)?$/, async (ctx) => {
  safeAnswer(ctx);
  if (isBanned(ctx.from.id)) return;
  const gb = Number(ctx.match[1]);
  const panel = ctx.match[2];
  const plan = getPlanByGb(gb, panel);
  if (!plan) return safeEdit(ctx, '❌ این پلن دیگر موجود نیست.', mainMenu());
  const userId = ctx.from.id;
  const currentWallet = getWallet(userId);

  const validity = plan.validity;
  const price = plan.price;

  if (currentWallet < price) {
    return ctx.reply('❌ موجودی کیف پول شما کافی نیست.\nلطفاً ابتدا کیف پول خود را شارژ کنید.', mainMenu());
  }

  // Feature 3: Show loading
  const loadingMsg = await showLoading(ctx, '⏳ در حال پردازش سفارش...');

  db.prepare('UPDATE users SET wallet = wallet - ? WHERE user_id = ?').run(price, userId);
  db.prepare('INSERT INTO orders (user_id, plan_name, plan_gb, validity, price, status, panel) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    userId, plan.name, plan.gb, validity, price, 'pending', panel
  );

  const order = db.prepare('SELECT id FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(userId);

  // Auto-deliver immediately
  const delivered = await autoDeliverOrder(order.id, ctx);

  // Feature 3: Delete loading message
  deleteMessage(ctx, loadingMsg);

  const adminText =
    `📥 *سفارش جدید*\n\n` +
    `🆔 #${order.id}\n` +
    `👤 کاربر: @${escapeMarkdown(ctx.from.username || 'ندارد')} (${ctx.from.id})\n` +
    `🔹 سرویس: ${escapeMarkdown(plan.name)}\n` +
    `🔹 پنل: ${panel === 'pasarguard' ? 'Pasarguard' : 'اقتصادی'}\n` +
    `🔹 مدت: ${validity} روز\n` +
    `🔹 مبلغ: ${formatNumber(price)} تومان\n` +
    `🔹 موجودی باقی‌مانده: ${formatNumber(currentWallet - price)} تومان`;

  bot.telegram.sendMessage(ADMIN_ID, adminText, { parse_mode: 'Markdown' });
});

// Pay with discount code
bot.action(/^pay_discount_(\d+)_(pasarguard|economic)_(.+)$/, async (ctx) => {
  safeAnswer(ctx);
  if (isBanned(ctx.from.id)) return;
  const gb = Number(ctx.match[1]);
  const panel = ctx.match[2];
  const code = ctx.match[3];
  const plan = getPlanByGb(gb, panel);
  if (!plan) return safeEdit(ctx, '❌ این پلن دیگر موجود نیست.', mainMenu());

  const discount = db.prepare('SELECT * FROM discount_codes WHERE code = ? AND active = 1').get(code);
  if (!discount) return safeEdit(ctx, '❌ کد تخفیف معتبر نیست.', mainMenu());
  if (discount.max_uses !== -1 && discount.used_count >= discount.max_uses) {
    return safeEdit(ctx, '❌ کد تخفیف به حداکثر استفاده رسیده.', mainMenu());
  }

  const userId = ctx.from.id;
  const currentWallet = getWallet(userId);
  const originalPrice = plan.price;
  const discountAmount = Math.round(originalPrice * discount.percent / 100);
  const finalPrice = originalPrice - discountAmount;

  if (currentWallet < finalPrice) {
    return ctx.reply(`❌ موجودی کیف پول شما کافی نیست.\nموجودی: ${formatNumber(currentWallet)} تومان\nنیاز: ${formatNumber(finalPrice)} تومان`, mainMenu());
  }

  db.prepare('UPDATE users SET wallet = wallet - ? WHERE user_id = ?').run(finalPrice, userId);
  db.prepare('INSERT INTO orders (user_id, plan_name, plan_gb, validity, price, status, panel) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    userId, plan.name, plan.gb, plan.validity, finalPrice, 'pending', panel
  );
  db.prepare('UPDATE discount_codes SET used_count = used_count + 1 WHERE id = ?').run(discount.id);

  const order = db.prepare('SELECT id FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(userId);

  // Auto-deliver immediately
  await autoDeliverOrder(order.id, ctx);

  const adminText =
    `📥 *سفارش جدید با تخفیف*\n\n` +
    `🆔 #${order.id}\n` +
    `👤 کاربر: @${escapeMarkdown(ctx.from.username || 'ندارد')} (${ctx.from.id})\n` +
    `🔹 سرویس: ${escapeMarkdown(plan.name)}\n` +
    `🔹 پنل: ${panel === 'pasarguard' ? 'Pasarguard' : 'اقتصادی'}\n` +
    `🔹 مدت: ${plan.validity} روز\n` +
    `🔹 قیمت اصلی: ${formatNumber(originalPrice)} تومان\n` +
    `🏷️ کد تخفیف: ${code} (${discount.percent}%)\n` +
    `💰 مبلغ نهایی: ${formatNumber(finalPrice)} تومان\n` +
    `🔹 موجودی باقی‌مانده: ${formatNumber(currentWallet - finalPrice)} تومان`;

  bot.telegram.sendMessage(ADMIN_ID, adminText, { parse_mode: 'Markdown' });
});

bot.action('wallet', (ctx) => {
  safeAnswer(ctx);
  if (isBanned(ctx.from.id)) return;
  const wallet = getWallet(ctx.from.id);
  const text = `🏦 *کیف پول*\n\nموجودی فعلی شما: *${formatNumber(wallet)}* تومان`;
  const buttons = [
    [b('➕ افزایش موجودی', 'add_balance', 'addBalance')],
    [b('بازگشت به منوی اصلی ◀️', 'back_to_menu', 'back')],
  ];
  safeEdit(ctx,text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('add_balance', (ctx) => {
  safeAnswer(ctx);
  if (isBanned(ctx.from.id)) return;
  userState[ctx.from.id] = 'wait_amount';
  safeEdit(ctx,
    '💰 مبلغ مورد نظر برای شارژ را وارد کنید:\n' + `min: ${formatNumber(minCharge)} | max: ${formatNumber(maxCharge)} تومان)`,
    Markup.inlineKeyboard([[b('بازگشت ◀️', 'back_to_menu', 'back')]])
  );
});

// Feature 1: Handle photo for welcome image
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;

  // Admin welcome image
  if (userId === ADMIN_ID && adminState[userId] && adminState[userId].action === 'edit_setting_welcome_image') {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileId = photo.file_id;

    welcomeImage = fileId;
    saveSettings();
    delete adminState[userId];

    ctx.reply('✅ تصویر خوش‌آمدگویی با موفقیت تنظیم شد!');
    try {
      await ctx.reply(adminBotSettingsText(), { parse_mode: 'Markdown', ...adminBotSettingsKeyboard() });
    } catch (_) {
      await ctx.reply(adminBotSettingsText().replace(/[*_`]/g, ''), { ...adminBotSettingsKeyboard() });
    }
    return;
  }

  // Admin trial QR
  if (userId === ADMIN_ID && adminState[userId] && adminState[userId].action === 'add_trial_qr') {
    const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    adminState[userId].qrFileId = fileId;
    adminState[userId].action = 'add_trial_link';
    ctx.reply('✅ QR کد دریافت شد.\n\nمرحله ۲: لینک اشتراک را ارسال کنید:');
    return;
  }

  // User charge receipt
  if (botOff) {
    return ctx.reply('🔴 ربات در حال حاضر خاموش است.\nلطفاً بعداً تلاش کنید.');
  }

  const state = userState[ctx.from.id];
  if (state && state.action === 'wait_charge_receipt') {
    const charge = db.prepare('SELECT * FROM charges WHERE id = ? AND status = ?').get(state.chargeId, 'pending');
    if (!charge) {
      delete userState[ctx.from.id];
      return ctx.reply('❌ این درخواست قبلاً پردازش شده است.');
    }

    db.prepare('UPDATE charges SET status = ? WHERE id = ?').run('waiting_admin', state.chargeId);
    const receiptFileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

    const caption =
      `💰 *فیش شارژ جدید*\n\n` +
      `🆔 #${state.chargeId}\n` +
      `👤 کاربر: @${escapeMarkdown(ctx.from.username || 'ندارد')} (${ctx.from.id})\n` +
      `💵 مبلغ: ${formatNumber(charge.amount)} تومان`;

    try {
      await bot.telegram.sendPhoto(ADMIN_ID, receiptFileId, {
        caption,
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [{ text: '✅ تایید شارژ', callback_data: `admin_confirm_${state.chargeId}`, style: 'success' }],
          [{ text: '❌ رد شارژ', callback_data: `admin_reject_${state.chargeId}`, style: 'danger' }],
        ]),
      });
      console.log('[CHARGE] Receipt sent to admin for charge:', state.chargeId);
    } catch (err) {
      console.error('[CHARGE] Failed to send to admin:', err.message);
      return ctx.reply('❌ خطا در ارسال به ادمین. لطفاً دوباره تلاش کنید.');
    }

    ctx.reply('✅ فیش واریزی شما دریافت شد و به ادمین ارسال شد.\n⏳ منتظر تایید ادمین باشید...', mainMenu());
    delete userState[ctx.from.id];
    return;
  }
});

bot.on('text', async (ctx) => {
  const user = ensureUser(ctx);
  const userId = ctx.from.id;

  if (userId === ADMIN_ID && adminState[userId]) {
    const state = adminState[userId];

    if (state.action === 'add_trial_qr') {
      if (ctx.message.text === 'رد کردن') {
        adminState[userId] = { action: 'add_trial_link' };
        return ctx.reply('✅ QR کد رد شد.\n\nمرحله ۲: لینک اشتراک را ارسال کنید:');
      }
      return ctx.reply('❌ لطفاً یک تصویر (QR کد) ارسال کنید.\nیا "رد کردن" تایپ کنید.');
    }

    if (state.action === 'add_trial_link') {
      const link = ctx.message.text.trim();
      if (!link.startsWith('http')) {
        return ctx.reply('❌ لطفاً یک لینک معتبر وارد کنید:');
      }
      if (state.qrFileId) {
        db.prepare('INSERT INTO free_trials (qr_file_id, sub_link) VALUES (?, ?)').run(state.qrFileId, link);
      } else {
        db.prepare('INSERT INTO free_trials (sub_link) VALUES (?)').run(link);
      }
      delete adminState[userId];
      ctx.reply(`✅ تست رایگان جدید اضافه شد.`);
      // Re-show free trials list
      const trials = db.prepare('SELECT ft.*, u.username FROM free_trials ft LEFT JOIN users u ON ft.claimed_by = u.user_id ORDER BY ft.created_at DESC').all();
      let text = '🎁 مدیریت تست رایگان\n\n';
      trials.forEach((t) => {
        const status = t.claimed_by ? `📨 @${t.username || t.claimed_by}` : (t.active ? '✅ موجود' : '❌ غیرفعال');
        text += `#${t.id} | ${status}\n   🔗 \`${t.sub_link.substring(0, 35)}${t.sub_link.length > 35 ? '...' : ''}\`\n`;
      });
      const buttons = [[Markup.button.callback('➕ افزودن تست جدید', 'admin_add_trial')]];
      trials.forEach((t) => {
        buttons.push([
          Markup.button.callback('🗑️ حذف', `admin_delete_trial_${t.id}`),
        ]);
      });
      buttons.push([b('بازگشت ◀️', 'back_to_menu', 'back')]);
      return ctx.reply(text, Markup.inlineKeyboard(buttons));
    }

    if (state.action === 'broadcast') {
      const allUsers = db.prepare('SELECT user_id FROM users WHERE banned = 0').all();
      let sent = 0;
      let failed = 0;
      ctx.reply(`📢 ارسال پیام همگانی شروع شد...\n👥 تعداد کاربران: ${allUsers.length}`);
      for (const u of allUsers) {
        try {
          await bot.telegram.sendMessage(u.user_id, `📢 *پیام مدیریت*\n\n${ctx.message.text}`, { parse_mode: 'MarkdownV2' });
          sent++;
        } catch (err) {
          // If MarkdownV2 fails, try plain text without formatting
          try {
            await bot.telegram.sendMessage(u.user_id, `📢 پیام مدیریت\n\n${ctx.message.text}`);
            sent++;
          } catch (_) { failed++; }
        }
        // Rate limiting: pause every 20 messages to avoid Telegram flood
        if (sent > 0 && sent % 20 === 0) await new Promise(r => setTimeout(r, 1500));
      }
      ctx.reply(`📢 ارسال پیام همگانی کامل شد.\n✅ موفق: ${sent}\n❌ ناموفق: ${failed}`);
      delete adminState[userId];
      return;
    }

    if (state.action === 'manual_charge') {
      const amount = parseInt(ctx.message.text.replace(/[^0-9]/g, ''));
      if (isNaN(amount) || amount < 1000) {
        return ctx.reply('❌ مبلغ نامعتبر است. حداقل ۱,۰۰۰ تومان.');
      }
      db.prepare('UPDATE users SET wallet = wallet + ? WHERE user_id = ?').run(amount, state.targetUserId);
      db.prepare("INSERT INTO charges (user_id, amount, status) VALUES (?, ?, 'confirmed')").run(state.targetUserId, amount);
      ctx.reply(`✅ کاربر ${state.targetUserId} به مبلغ ${formatNumber(amount)} تومان شارژ شد.`);
      bot.telegram.sendMessage(state.targetUserId, `✅ کیف پول شما به مبلغ *${formatNumber(amount)} تومان* شارژ شد!\nموجودی فعلی: *${formatNumber(getWallet(state.targetUserId))}* تومان`, { parse_mode: 'Markdown' });
      delete adminState[userId];
      return;
    }

    if (state.action === 'manual_deduct') {
      const amount = parseInt(ctx.message.text.replace(/[^0-9]/g, ''));
      if (isNaN(amount) || amount < 1000) {
        return ctx.reply('❌ مبلغ نامعتبر است. حداقل ۱,۰۰۰ تومان.');
      }
      const currentWallet = getWallet(state.targetUserId);
      if (amount > currentWallet) {
        return ctx.reply(`❌ موجودی کیف پول کاربر کافی نیست.\nموجودی فعلی: ${formatNumber(currentWallet)} تومان`);
      }
      db.prepare('UPDATE users SET wallet = wallet - ? WHERE user_id = ?').run(amount, state.targetUserId);
      ctx.reply(`✅ ${formatNumber(amount)} تومان از کیف پول کاربر ${state.targetUserId} کسر شد.`);
      delete adminState[userId];
      return;
    }

    if (state.action === 'add_plan_name_gb') {
      const input = ctx.message.text.trim();
      const gbMatch = input.match(/(\d+)\s*[Gg][Bb]/);
      const gb = gbMatch ? parseInt(gbMatch[1]) : parseInt(input.replace(/[^0-9]/g, ''));
      const name = input;
      if (name.length < 1 || name.length > 50) {
        return ctx.reply('❌ نام پلن باید بین ۱ تا ۵۰ کاراکتر باشد.');
      }
      if (isNaN(gb) || gb < 1) {
        return ctx.reply('❌ حجم نامعتبر است. مثال: 20GB');
      }
      adminState[userId] = { action: 'add_plan_validity', name, gb, panel: state.panel };
      return ctx.reply(`✅ نام: ${name} | حجم: ${gb}GB\n\n📅 مدت اشتراک (روز) را وارد کنید:\n(مثال: 31 برای ۱ ماه)`);
    }

    if (state.action === 'add_plan_name') {
      const name = ctx.message.text.trim();
      if (name.length < 1 || name.length > 50) {
        return ctx.reply('❌ نام پلن باید بین ۱ تا ۵۰ کاراکتر باشد.');
      }
      adminState[userId] = { action: 'add_plan_gb', name, panel: state.panel, validity: state.validity };
      return ctx.reply('💾 حجم پلن (GB) را وارد کنید:');
    }

    if (state.action === 'add_plan_gb') {
      const gb = parseInt(ctx.message.text.replace(/[^0-9]/g, ''));
      if (isNaN(gb) || gb < 1) {
        return ctx.reply('❌ حجم نامعتبر است. یک عدد صحیح وارد کنید.');
      }
      adminState[userId] = { action: 'add_plan_price', name: state.name, gb, panel: state.panel, validity: state.validity };
      return ctx.reply('💰 قیمت (تومان) را وارد کنید:');
    }

    if (state.action === 'add_plan_validity') {
      const validity = parseInt(ctx.message.text.replace(/[^0-9]/g, ''));
      if (isNaN(validity) || validity < 1) {
        return ctx.reply('❌ مدت نامعتبر است. یک عدد صحیح وارد کنید.');
      }
      adminState[userId] = { action: 'add_plan_price', name: state.name, gb: state.gb, panel: state.panel, validity };
      return ctx.reply(`✅ نام: ${state.name} | حجم: ${state.gb}GB | مدت: ${validity} روز\n\n💰 قیمت (تومان) را وارد کنید:`);
    }

    if (state.action === 'add_plan_price') {
      const price = parseInt(ctx.message.text.replace(/[^0-9]/g, ''));
      if (isNaN(price) || price < 1000) {
        return ctx.reply('❌ قیمت نامعتبر است. حداقل ۱,۰۰۰ تومان.');
      }
      db.prepare('INSERT INTO plans (name, gb, validity, price, panel) VALUES (?, ?, ?, ?, ?)').run(state.name, state.gb, state.validity, price, state.panel);
      delete adminState[userId];
      ctx.reply(`✅ پلن ${state.name} با موفقیت اضافه شد.`);
      // Show all plans for this panel
      const plans = db.prepare('SELECT * FROM plans WHERE active = 1 AND panel = ? ORDER BY validity ASC, price ASC').all(state.panel);
      let text = `📦 پلن‌های پنل ${state.panel}\n\n`;
      plans.forEach(p => {
        text += `▫️ ${p.name} | ${p.gb}GB | ${p.validity} روز | ${formatNumber(p.price)} تومان\n`;
      });
      return ctx.reply(text);
    }

    if (state.action === 'edit_plan_name') {
      const name = ctx.message.text.trim();
      if (name.length < 1 || name.length > 50) {
        return ctx.reply('❌ نام پلن باید بین ۱ تا ۵۰ کاراکتر باشد.');
      }
      db.prepare('UPDATE plans SET name = ? WHERE id = ?').run(name, state.planId);
      const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(state.planId);
      delete adminState[userId];
      ctx.reply(`✅ نام پلن به ${name} تغییر یافت.`);
      return showPlanList(ctx, plan.panel);
    }

    if (state.action === 'edit_plan_gb') {
      const gb = parseInt(ctx.message.text.replace(/[^0-9]/g, ''));
      if (isNaN(gb) || gb < 1) {
        return ctx.reply('❌ حجم نامعتبر است. یک عدد صحیح وارد کنید.');
      }
      db.prepare('UPDATE plans SET gb = ? WHERE id = ?').run(gb, state.planId);
      const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(state.planId);
      delete adminState[userId];
      ctx.reply(`✅ حجم پلن به ${gb}GB تغییر یافت.`);
      return showPlanList(ctx, plan.panel);
    }

    if (state.action === 'edit_plan_validity') {
      const validity = parseInt(ctx.message.text.replace(/[^0-9]/g, ''));
      if (isNaN(validity) || validity < 1) {
        return ctx.reply('❌ مدت نامعتبر است. یک عدد صحیح وارد کنید.');
      }
      db.prepare('UPDATE plans SET validity = ? WHERE id = ?').run(validity, state.planId);
      const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(state.planId);
      delete adminState[userId];
      ctx.reply(`✅ مدت اعتبار پلن به ${validity} روز تغییر یافت.`);
      return showPlanList(ctx, plan.panel);
    }

    if (state.action === 'edit_plan_price') {
      const price = parseInt(ctx.message.text.replace(/[^0-9]/g, ''));
      if (isNaN(price) || price < 1000) {
        return ctx.reply('❌ قیمت نامعتبر است. حداقل ۱,۰۰۰ تومان.');
      }
      db.prepare('UPDATE plans SET price = ? WHERE id = ?').run(price, state.planId);
      const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(state.planId);
      delete adminState[userId];
      ctx.reply(`✅ قیمت پلن به ${formatNumber(price)} تومان تغییر یافت.`);
      return showPlanList(ctx, plan.panel);
    }

    if (state.action === 'add_panel_name') {
      const name = ctx.message.text.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (name.length < 2 || name.length > 30) {
        return ctx.reply('❌ نام پنل باید بین ۲ تا ۳۰ کاراکتر باشد (فقط حروف انگلیسی، اعداد و underscore).');
      }
      const existing = getPanelByName(name);
      if (existing) {
        return ctx.reply('❌ این نام پنل قبلاً استفاده شده است.');
      }
      adminState[userId] = { action: 'add_panel_display_name', name };
      return ctx.reply('✅ نام تایید شد.\n\nنام نمایشی پنل را وارد کنید:\n(مثال: پنل ویژه)');
    }

    if (state.action === 'add_panel_display_name') {
      const displayName = ctx.message.text.trim();
      if (displayName.length < 1 || displayName.length > 50) {
        return ctx.reply('❌ نام نمایشی باید بین ۱ تا ۵۰ کاراکتر باشد.');
      }
      adminState[userId] = { action: 'add_panel_description', name: state.name, display_name: displayName };
      return ctx.reply('توضیحات پنل را وارد کنید:\n(یا "رد کردن" برای بدون توضیحات)');
    }

    if (state.action === 'add_panel_description') {
      const description = ctx.message.text === 'رد کردن' ? null : ctx.message.text.trim();
      db.prepare('INSERT INTO panels (name, display_name, description) VALUES (?, ?, ?)').run(state.name, state.display_name, description);
      delete adminState[userId];
      ctx.reply(`✅ پنل ${state.display_name} با موفقیت اضافه شد.`);
      // Re-show panels list
      const panels = getAllPanels();
      let text = '🖥 مدیریت پنل‌ها\n\n';
      panels.forEach((p) => {
        const status = p.active ? '✅ فعال' : '❌ غیرفعال';
        const planCount = db.prepare("SELECT COUNT(*) as c FROM plans WHERE panel = ? AND active = 1").get(p.name).c;
        text += `#${p.id} | ${p.display_name} (${p.name}) | ${status} | ${planCount} پلن\n`;
        if (p.description) text += `   ${p.description}\n`;
      });
      const buttons = [[Markup.button.callback('➕ افزودن پنل جدید', 'admin_add_panel')]];
      panels.forEach((p) => {
        buttons.push([
          Markup.button.callback(`🔍 جزئیات #${p.id}`, `admin_panel_detail_${p.id}`),
          Markup.button.callback(`${p.active ? '❌ غیرفعال' : '✅ فعال'} #${p.id}`, `admin_toggle_panel_${p.id}`),
          Markup.button.callback('🗑️ حذف', `admin_delete_panel_${p.id}`),
        ]);
      });
      buttons.push([b('بازگشت ◀️', 'back_to_menu', 'back')]);
      return ctx.reply(text, Markup.inlineKeyboard(buttons));
    }

    if (state.action === 'edit_panel_display') {
      const displayName = ctx.message.text.trim();
      if (displayName.length < 1 || displayName.length > 50) {
        return ctx.reply('❌ نام نمایشی باید بین ۱ تا ۵۰ کاراکتر باشد.');
      }
      db.prepare('UPDATE panels SET display_name = ? WHERE id = ?').run(displayName, state.panelId);
      delete adminState[userId];
      const panel = db.prepare('SELECT * FROM panels WHERE id = ?').get(state.panelId);
      ctx.reply(`✅ نام نمایشی پنل به "${displayName}" تغییر یافت.`);
      // Re-show detail
      const planCount = db.prepare("SELECT COUNT(*) as c FROM plans WHERE panel = ? AND active = 1").get(panel.name).c;
      const totalPlanCount = db.prepare("SELECT COUNT(*) as c FROM plans WHERE panel = ?").get(panel.name).c;
      const orderCount = db.prepare("SELECT COUNT(*) as c FROM orders WHERE panel = ?").get(panel.name).c;
      const status = panel.active ? '✅ فعال' : '❌ غیرفعال';
      let text2 = '🔍 جزئیات پنل\n\n';
      text2 += `شناسه: #${panel.id}\n`;
      text2 += `نام: ${panel.name}\n`;
      text2 += `نام نمایشی: ${panel.display_name}\n`;
      text2 += `توضیحات: ${panel.description || '---'}\n`;
      text2 += `وضعیت: ${status}\n`;
      text2 += `پلن‌های فعال: ${planCount}\n`;
      text2 += `کل پلن‌ها: ${totalPlanCount}\n`;
      text2 += `سفارشات: ${orderCount}\n`;
      text2 += `تاریخ ایجاد: ${panel.created_at}\n`;
      const buttons = [
        [
          Markup.button.callback('📝 ویرایش نام نمایشی', `admin_edit_panel_display_${panel.id}`),
          Markup.button.callback('📝 ویرایش توضیحات', `admin_edit_panel_desc_${panel.id}`),
        ],
        [
          Markup.button.callback(`${panel.active ? '❌ غیرفعال' : '✅ فعال'} کردن`, `admin_toggle_panel_${panel.id}`),
          Markup.button.callback('🗑️ حذف', `admin_delete_panel_${panel.id}`),
        ],
        [b('بازگشت ◀️', 'admin_panels', 'back')],
      ];
      return ctx.reply(text2, Markup.inlineKeyboard(buttons));
    }

    if (state.action === 'edit_panel_desc') {
      const description = ctx.message.text === 'رد کردن' ? null : ctx.message.text.trim();
      db.prepare('UPDATE panels SET description = ? WHERE id = ?').run(description, state.panelId);
      delete adminState[userId];
      const panel = db.prepare('SELECT * FROM panels WHERE id = ?').get(state.panelId);
      ctx.reply(`✅ توضیحات پنل بروزرسانی شد.`);
      // Re-show detail
      const planCount = db.prepare("SELECT COUNT(*) as c FROM plans WHERE panel = ? AND active = 1").get(panel.name).c;
      const totalPlanCount = db.prepare("SELECT COUNT(*) as c FROM plans WHERE panel = ?").get(panel.name).c;
      const orderCount = db.prepare("SELECT COUNT(*) as c FROM orders WHERE panel = ?").get(panel.name).c;
      const status = panel.active ? '✅ فعال' : '❌ غیرفعال';
      let text3 = '🔍 جزئیات پنل\n\n';
      text3 += `شناسه: #${panel.id}\n`;
      text3 += `نام: ${panel.name}\n`;
      text3 += `نام نمایشی: ${panel.display_name}\n`;
      text3 += `توضیحات: ${panel.description || '---'}\n`;
      text3 += `وضعیت: ${status}\n`;
      text3 += `پلن‌های فعال: ${planCount}\n`;
      text3 += `کل پلن‌ها: ${totalPlanCount}\n`;
      text3 += `سفارشات: ${orderCount}\n`;
      text3 += `تاریخ ایجاد: ${panel.created_at}\n`;
      const buttons = [
        [
          Markup.button.callback('📝 ویرایش نام نمایشی', `admin_edit_panel_display_${panel.id}`),
          Markup.button.callback('📝 ویرایش توضیحات', `admin_edit_panel_desc_${panel.id}`),
        ],
        [
          Markup.button.callback(`${panel.active ? '❌ غیرفعال' : '✅ فعال'} کردن`, `admin_toggle_panel_${panel.id}`),
          Markup.button.callback('🗑️ حذف', `admin_delete_panel_${panel.id}`),
        ],
        [b('بازگشت ◀️', 'admin_panels', 'back')],
      ];
      return ctx.reply(text3, Markup.inlineKeyboard(buttons));
    }

    if (state.action === 'search_user') {
      const query = ctx.message.text.trim();
      let user = null;

      if (/^\d+$/.test(query)) {
        user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(Number(query));
      }
      if (!user) {
        user = db.prepare('SELECT * FROM users WHERE username = ? OR username = ?').get(query, query.replace('@', ''));
      }

      delete adminState[userId];

      if (!user) {
        return ctx.reply('❌ کاربری یافت نشد.', Markup.inlineKeyboard([
          [Markup.button.callback('🔍 جستجوی مجدد', 'admin_search_user')],
          [b('بازگشت ◀️', 'back_to_menu', 'back')],
        ]));
      }

      return showUserDetailMsg(ctx, user.user_id);
    }
  }

  // === Admin settings text input handlers ===
  if (userId === ADMIN_ID && adminState[userId] && adminState[userId].action === 'edit_setting_referral') {
    const val = parseInt(ctx.message.text.replace(/[^0-9]/g, ''));
    if (isNaN(val) || val < 0) return ctx.reply('❌ مبلغ نامعتبر است.');
    referralReward = val;
    saveSettings();
    delete adminState[userId];
    ctx.reply(`✅ پاداش دعوت به ${formatNumber(val)} تومان تغییر کرد.`);
    // Return to settings page
    try {
      await ctx.reply(adminBotSettingsText(), { parse_mode: 'Markdown', ...adminBotSettingsKeyboard() });
    } catch (_) {
      await ctx.reply(adminBotSettingsText().replace(/[*_`]/g, ''), { ...adminBotSettingsKeyboard() });
    }
    return;
  }

  if (userId === ADMIN_ID && adminState[userId] && adminState[userId].action === 'edit_setting_card_number') {
    CARD_NUMBER = ctx.message.text.trim();
    saveSettings();
    delete adminState[userId];
    ctx.reply(`✅ شماره کارت به ${CARD_NUMBER} تغییر کرد.`);
    try {
      await ctx.reply(adminBotSettingsText(), { parse_mode: 'Markdown', ...adminBotSettingsKeyboard() });
    } catch (_) {
      await ctx.reply(adminBotSettingsText().replace(/[*_`]/g, ''), { ...adminBotSettingsKeyboard() });
    }
    return;
  }

  if (userId === ADMIN_ID && adminState[userId] && adminState[userId].action === 'edit_setting_card_owner') {
    CARD_OWNER = ctx.message.text.trim();
    saveSettings();
    delete adminState[userId];
    ctx.reply(`✅ نام صاحب کارت به ${CARD_OWNER} تغییر کرد.`);
    try {
      await ctx.reply(adminBotSettingsText(), { parse_mode: 'Markdown', ...adminBotSettingsKeyboard() });
    } catch (_) {
      await ctx.reply(adminBotSettingsText().replace(/[*_`]/g, ''), { ...adminBotSettingsKeyboard() });
    }
    return;
  }

  if (userId === ADMIN_ID && adminState[userId] && adminState[userId].action === 'edit_setting_min_charge') {
    const val = parseInt(ctx.message.text.replace(/[^0-9]/g, ''));
    if (isNaN(val) || val < 100) return ctx.reply('❌ مبلغ نامعتبر است.');
    minCharge = val;
    saveSettings();
    delete adminState[userId];
    ctx.reply(`✅ حداقل شارژ به ${formatNumber(val)} تومان تغییر کرد.`);
    try {
      await ctx.reply(adminBotSettingsText(), { parse_mode: 'Markdown', ...adminBotSettingsKeyboard() });
    } catch (_) {
      await ctx.reply(adminBotSettingsText().replace(/[*_`]/g, ''), { ...adminBotSettingsKeyboard() });
    }
    return;
  }

  if (userId === ADMIN_ID && adminState[userId] && adminState[userId].action === 'edit_setting_max_charge') {
    const val = parseInt(ctx.message.text.replace(/[^0-9]/g, ''));
    if (isNaN(val) || val < 1000) return ctx.reply('❌ مبلغ نامعتبر است.');
    maxCharge = val;
    saveSettings();
    delete adminState[userId];
    ctx.reply(`✅ حداکثر شارژ به ${formatNumber(val)} تومان تغییر کرد.`);
    try {
      await ctx.reply(adminBotSettingsText(), { parse_mode: 'Markdown', ...adminBotSettingsKeyboard() });
    } catch (_) {
      await ctx.reply(adminBotSettingsText().replace(/[*_`]/g, ''), { ...adminBotSettingsKeyboard() });
    }
    return;
  }

  if (userId === ADMIN_ID && adminState[userId] && adminState[userId].action === 'edit_setting_welcome') {
    welcomeMessage = ctx.message.text;
    saveSettings();
    delete adminState[userId];
    ctx.reply(`✅ پیام خوش‌آمدگویی بروزرسانی شد.`);
    try {
      await ctx.reply(adminBotSettingsText(), { parse_mode: 'Markdown', ...adminBotSettingsKeyboard() });
    } catch (_) {
      await ctx.reply(adminBotSettingsText().replace(/[*_`]/g, ''), { ...adminBotSettingsKeyboard() });
    }
    return;
  }

  if (userId === ADMIN_ID && adminState[userId] && adminState[userId].action === 'edit_setting_channel_msg') {
    channelMessage = ctx.message.text;
    saveSettings();
    delete adminState[userId];
    ctx.reply(`✅ پیام عضویت اجباری بروزرسانی شد.`);
    try {
      await ctx.reply(adminBotSettingsText(), { parse_mode: 'Markdown', ...adminBotSettingsKeyboard() });
    } catch (_) {
      await ctx.reply(adminBotSettingsText().replace(/[*_`]/g, ''), { ...adminBotSettingsKeyboard() });
    }
    return;
  }

  if (userId === ADMIN_ID && adminState[userId] && adminState[userId].action === 'edit_setting_channel_name') {
    CHANNEL_USERNAME = ctx.message.text.trim().replace('@', '');
    saveSettings();
    delete adminState[userId];
    ctx.reply(`✅ نام کانال به @${CHANNEL_USERNAME} تغییر کرد.`);
    try {
      await ctx.reply(adminBotSettingsText(), { parse_mode: 'Markdown', ...adminBotSettingsKeyboard() });
    } catch (_) {
      await ctx.reply(adminBotSettingsText().replace(/[*_`]/g, ''), { ...adminBotSettingsKeyboard() });
    }
    return;
  }

  if (userId === ADMIN_ID && adminState[userId] && adminState[userId].action === 'edit_setting_support') {
    ADMIN_USERNAME = ctx.message.text.trim().replace('@', '');
    saveSettings();
    delete adminState[userId];
    ctx.reply(`✅ نام کاربری پشتیبانی به @${ADMIN_USERNAME} تغییر کرد.`);
    try {
      await ctx.reply(adminBotSettingsText(), { parse_mode: 'Markdown', ...adminBotSettingsKeyboard() });
    } catch (_) {
      await ctx.reply(adminBotSettingsText().replace(/[*_`]/g, ''), { ...adminBotSettingsKeyboard() });
    }
    return;
  }

  if (userId === ADMIN_ID && adminState[userId] && adminState[userId].action === 'edit_setting_welcome_image') {
    const input = ctx.message.text.trim();
    if (input === 'حذف' || input === 'پاک کن' || input === 'حذف کن') {
      welcomeImage = '';
      saveSettings();
      delete adminState[userId];
      ctx.reply('✅ تصویر خوش‌آمدگویی حذف شد.');
      try {
        await ctx.reply(adminBotSettingsText(), { parse_mode: 'Markdown', ...adminBotSettingsKeyboard() });
      } catch (_) {
        await ctx.reply(adminBotSettingsText().replace(/[*_`]/g, ''), { ...adminBotSettingsKeyboard() });
      }
      return;
    }
    // If not delete, they need to send a photo, not text
    return ctx.reply('❌ لطفاً یک تصویر ارسال کنید (نه متن).\nیا "حذف" تایپ کنید.');
  }

  if (userId === ADMIN_ID && adminState[userId] && adminState[userId].action === 'edit_setting_panel_url') {
    PANEL_URL = ctx.message.text.trim().replace(/\/+$/, '');
    panelToken = null;
    panelTokenExpiry = 0;
    detectedApiPath = null;
    saveSettings();
    const from = adminState[userId].from;
    delete adminState[userId];
    ctx.reply(`✅ آدرس پنل به \`${PANEL_URL}\` تغییر کرد.`, { parse_mode: 'Markdown' });
    // Return to quick panel menu if came from there
    if (from === 'admin_quick_panel') {
      return adminQuickPanel(ctx);
    }
    try {
      await ctx.reply(adminBotSettingsText(), { parse_mode: 'Markdown', ...adminBotSettingsKeyboard() });
    } catch (_) {
      await ctx.reply(adminBotSettingsText().replace(/[*_`]/g, ''), { ...adminBotSettingsKeyboard() });
    }
    return;
  }

  if (userId === ADMIN_ID && adminState[userId] && adminState[userId].action === 'edit_setting_panel_username') {
    PANEL_USERNAME = ctx.message.text.trim();
    panelToken = null;
    panelTokenExpiry = 0;
    detectedApiPath = null;
    saveSettings();
    const from = adminState[userId].from;
    delete adminState[userId];
    ctx.reply(`✅ یوزرنیم پنل به \`${PANEL_USERNAME}\` تغییر کرد.`, { parse_mode: 'Markdown' });
    // Return to quick panel menu if came from there
    if (from === 'admin_quick_panel') {
      return adminQuickPanel(ctx);
    }
    try {
      await ctx.reply(adminBotSettingsText(), { parse_mode: 'Markdown', ...adminBotSettingsKeyboard() });
    } catch (_) {
      await ctx.reply(adminBotSettingsText().replace(/[*_`]/g, ''), { ...adminBotSettingsKeyboard() });
    }
    return;
  }

  if (userId === ADMIN_ID && adminState[userId] && adminState[userId].action === 'edit_setting_panel_password') {
    PANEL_PASSWORD = ctx.message.text.trim();
    panelToken = null;
    panelTokenExpiry = 0;
    detectedApiPath = null;
    saveSettings();
    const from = adminState[userId].from;
    delete adminState[userId];
    ctx.reply('✅ پسورد پنل با موفقیت تغییر کرد.');
    // Return to quick panel menu if came from there
    if (from === 'admin_quick_panel') {
      return adminQuickPanel(ctx);
    }
    try {
      await ctx.reply(adminBotSettingsText(), { parse_mode: 'Markdown', ...adminBotSettingsKeyboard() });
    } catch (_) {
      await ctx.reply(adminBotSettingsText().replace(/[*_`]/g, ''), { ...adminBotSettingsKeyboard() });
    }
    return;
  }

  // === Discount Code Creation (3 steps) ===
  if (userId === ADMIN_ID && adminState[userId] && adminState[userId].action === 'add_discount_code') {
    const code = ctx.message.text.trim().toUpperCase();
    if (code.length < 3 || code.length > 20) return ctx.reply('❌ نام کد باید بین ۳ تا ۲۰ کاراکتر باشد.');
    const exists = db.prepare('SELECT id FROM discount_codes WHERE code = ?').get(code);
    if (exists) return ctx.reply('❌ این کد قبلاً وجود دارد. کد دیگری وارد کنید.');
    adminState[userId] = { action: 'add_discount_percent', code };
    return ctx.reply(`✅ کد: \`${code}\`\n\n💰 درصد تخفیف را وارد کنید:\n(مثال: 20 یعنی ۲۰٪ تخفیف)`, { parse_mode: 'Markdown' });
  }

  if (userId === ADMIN_ID && adminState[userId] && adminState[userId].action === 'add_discount_percent') {
    const percent = parseInt(ctx.message.text.replace(/[^0-9]/g, ''));
    if (isNaN(percent) || percent < 1 || percent > 99) return ctx.reply('❌ درصد باید بین ۱ تا ۹۹ باشد.');
    adminState[userId] = { action: 'add_discount_max_uses', code: adminState[userId].code, percent };
    return ctx.reply(`✅ کد: \`${adminState[userId].code}\` | تخفیف: ${percent}%\n\n🔢 حداکثر تعداد استفاده را وارد کنید:\n(-1 برای نامحدود)`, { parse_mode: 'Markdown' });
  }

  if (userId === ADMIN_ID && adminState[userId] && adminState[userId].action === 'add_discount_max_uses') {
    const maxUses = parseInt(ctx.message.text.replace(/[^0-9-]/g, ''));
    if (isNaN(maxUses) || maxUses < -1 || maxUses === 0) return ctx.reply('❌ مقدار نامعتبر است. عددی وارد کنید (یا -1 برای نامحدود).');
    const { code, percent } = adminState[userId];
    try {
      db.prepare('INSERT INTO discount_codes (code, percent, max_uses) VALUES (?, ?, ?)').run(code, percent, maxUses);
      delete adminState[userId];
      const usageText = maxUses === -1 ? 'نامحدود' : maxUses;
      ctx.reply(`✅ کد تخفیف ساخته شد!\n\n🏷️ کد: \`${code}\`\n💰 تخفیف: ${percent}%\n🔢 حداکثر استفاده: ${usageText}`, { parse_mode: 'Markdown' });
      // Show discount codes list
      const buttons = [
        [Markup.button.callback('➕ ساخت کد جدید', 'admin_add_discount_code')],
        [b('بازگشت ◀️', 'back_to_menu', 'back')],
      ];
      await ctx.reply(discountCodesList(), { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    } catch (err) {
      delete adminState[userId];
      ctx.reply('❌ خطا در ساخت کد: ' + err.message);
    }
    return;
  }

  if (isBanned(userId)) return ctx.reply('❌ حساب شما مسدود شده است.');

  if (botOff && userId !== ADMIN_ID) {
    return ctx.reply('🔴 ربات در حال حاضر خاموش است.\nلطفاً بعداً تلاش کنید.');
  }

  // === User Discount Code Input ===
  const userStateObj = userState[userId];
  if (userStateObj && typeof userStateObj === 'object' && userStateObj.action === 'wait_discount_code') {
    const code = ctx.message.text.trim().toUpperCase();
    const discount = db.prepare('SELECT * FROM discount_codes WHERE code = ? AND active = 1').get(code);
    if (!discount) {
      return ctx.reply('❌ کد تخفیف معتبر نیست یا غیرفعال است.\n\n📝 کد دیگری وارد کنید یا برگردید.', Markup.inlineKeyboard([
        [b('🔙 بازگشت به انتخاب پلن', 'buy_sub', 'backToPlans')],
      ]));
    }
    if (discount.max_uses !== -1 && discount.used_count >= discount.max_uses) {
      return ctx.reply('❌ این کد تخفیف به حداکثر استفاده رسیده است.', Markup.inlineKeyboard([
        [b('🔙 بازگشت', 'buy_sub', 'back')],
      ]));
    }
    const plan = getPlanByGb(userStateObj.gb, userStateObj.panel);
    if (!plan) {
      delete userState[userId];
      return ctx.reply('❌ پلن یافت نشد.', mainMenu());
    }
    const originalPrice = plan.price;
    const discountAmount = Math.round(originalPrice * discount.percent / 100);
    const finalPrice = originalPrice - discountAmount;
    const wallet = getWallet(userId);

    const text =
      `📋 *جزئیات سفارش با تخفیف*\n\n` +
      `🔹 نام سرویس: ${escapeMarkdown(plan.name)}\n` +
      `🔹 مدت اعتبار: ${plan.validity} روز\n` +
      `🔹 قیمت اصلی: ${formatNumber(originalPrice)} تومان\n` +
      `🏷️ کد تخفیف: \`${code}\` (${discount.percent}%)\n` +
      `🔻 مبلغ تخفیف: -${formatNumber(discountAmount)} تومان\n` +
      `💰 قیمت نهایی: *${formatNumber(finalPrice)} تومان*\n` +
      `🔹 موجودی کیف پول شما: ${formatNumber(wallet)} تومان`;

    const payAction = `pay_discount_${plan.gb}_${userStateObj.panel}_${code}`;
    const buttons = [
      [b(`💳 پرداخت ${formatNumber(finalPrice)} تومان`, payAction, 'success')],
      [b('🔙 بازگشت به انتخاب پلن', 'buy_sub', 'backToPlans')],
    ];

    delete userState[userId];
    ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    return;
  }

  if (userState[userId] === 'wait_amount') {
    const amount = parseInt(ctx.message.text.replace(/[^0-9]/g, ''));
    if (isNaN(amount) || amount < minCharge || amount > maxCharge) {
      return ctx.reply(`❌ مبلغ وارد شده معتبر نیست.\nلطفاً مبلغی بین ${formatNumber(minCharge)} تا ${formatNumber(maxCharge)} تومان وارد کنید.`);
    }

    db.prepare('INSERT INTO charges (user_id, amount) VALUES (?, ?)').run(userId, amount);
    const charge = db.prepare('SELECT id FROM charges WHERE user_id = ? AND status = ? ORDER BY id DESC LIMIT 1').get(userId, 'pending');

    userState[userId] = { action: 'wait_charge_receipt', chargeId: charge.id };

    const text =
      `✅ *درخواست شارژ ثبت شد*\n\n` +
      `💵 مبلغ: *${formatNumber(amount)}* تومان\n\n` +
      `شماره کارت:\n\`${CARD_NUMBER}\`\n\n` +
      `به نام:\n*${CARD_OWNER}*\n\n` +
      `⚠️ لطفاً تصویر فیش واریزی را ارسال کنید.`;

    const buttons = [
      [b('لغو', 'cancel_charge', 'back')],
    ];

    ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    return;
  }

});

bot.action(/^admin_confirm_(\d+)$/, (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;

  const chargeId = Number(ctx.match[1]);
  const charge = db.prepare('SELECT * FROM charges WHERE id = ? AND status = ?').get(chargeId, 'waiting_admin');

  if (!charge) {
    return safeEdit(ctx,'❌ این درخواست قبلاً پردازش شده است.');
  }

  db.prepare('UPDATE charges SET status = ? WHERE id = ?').run('confirmed', chargeId);
  db.prepare('UPDATE users SET wallet = wallet + ? WHERE user_id = ?').run(charge.amount, charge.user_id);

  safeEdit(ctx,`✅ شارژ با موفقیت تایید شد.\nکاربر ${charge.user_id} به مبلغ ${formatNumber(charge.amount)} تومان شارژ شد.`);

  bot.telegram.sendMessage(
    charge.user_id,
    `✅ کیف پول شما به مبلغ *${formatNumber(charge.amount)} تومان* شارژ شد!\n\nموجودی فعلی: *${formatNumber(getWallet(charge.user_id))}* تومان`,
    { parse_mode: 'Markdown', ...mainMenu() }
  );
});

bot.action(/^admin_reject_(\d+)$/, (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;

  const chargeId = Number(ctx.match[1]);
  const charge = db.prepare('SELECT * FROM charges WHERE id = ? AND status = ?').get(chargeId, 'waiting_admin');

  if (!charge) {
    return safeEdit(ctx,'❌ این درخواست قبلاً پردازش شده است.');
  }

  db.prepare('UPDATE charges SET status = ? WHERE id = ?').run('rejected', chargeId);
  safeEdit(ctx,`❌ شارژ کاربر ${charge.user_id} رد شد.`);
  bot.telegram.sendMessage(charge.user_id, '❌ پرداخت شما توسط ادمین تایید نشد.\nلطفاً با پشتیبانی تماس بگیرید.', mainMenu());
});

bot.action(/^admin_order_reject_(\d+)$/, (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;

  const orderId = Number(ctx.match[1]);
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND status = ?').get(orderId, 'pending');

  if (!order) {
    return safeEdit(ctx,'❌ این سفارش قبلاً پردازش شده است.');
  }

  db.prepare("UPDATE orders SET status = 'rejected' WHERE id = ?").run(orderId);
  db.prepare('UPDATE users SET wallet = wallet + ? WHERE user_id = ?').run(order.price, order.user_id);

  safeEdit(ctx,`❌ سفارش #${orderId} رد شد. مبلغ ${formatNumber(order.price)} تومان به کیف پول کاربر برگردانده شد.`);
  bot.telegram.sendMessage(order.user_id, '❌ سفارش شما توسط ادمین رد شد.\nمبلغ به کیف پول شما بازگردانده شد.', mainMenu());
});

bot.action('prices', (ctx) => {
  safeAnswer(ctx);
  safeEdit(ctx, '💰 *لیست قیمت‌ها*\n\nمدت اشتراک را انتخاب کنید:', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📅 قیمت ۱ ماهه', 'show_prices_1m')],
      [Markup.button.callback('📅 قیمت ۲ ماهه', 'show_prices_2m')],
      [b('بازگشت به منوی اصلی ◀️', 'back_to_menu', 'back')],
    ]),
  });
});

bot.action('show_prices_1m', (ctx) => {
  safeAnswer(ctx);
  const panels = getActivePanels();
  const validity = 31;

  let text = '💰 *لیست قیمت ۱ ماهه*\n';
  text += '━━━━━━━━━━━━━━━━━━\n\n';

  panels.forEach((panel) => {
    const plans = db.prepare('SELECT * FROM plans WHERE active = 1 AND panel = ? AND validity = ? ORDER BY price ASC').all(panel.name, validity);
    if (plans.length > 0) {
      text += `🔹 *${panel.display_name}*\n`;
      plans.forEach((p) => {
        text += `▫️ ${p.gb}GB | ${p.validity} روز | ${formatNumber(p.price)} تومان\n`;
      });
      text += '\n';
    }
  });

  if (panels.length === 0) {
    text += 'پلنی موجود نیست.\n\n';
  }

  text += '━━━━━━━━━━━━━━━━━━\n';
  text += '⚠️ قیمت‌ها به تومان می‌باشند.';
  const buttons = [[b('بازگشت ◀️', 'prices', 'back')]];
  safeEdit(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('show_prices_2m', (ctx) => {
  safeAnswer(ctx);
  const panels = getActivePanels();
  const validity = 60;

  let text = '💰 *لیست قیمت ۲ ماهه*\n';
  text += '━━━━━━━━━━━━━━━━━━\n\n';

  panels.forEach((panel) => {
    const plans = db.prepare('SELECT * FROM plans WHERE active = 1 AND panel = ? AND validity = ? ORDER BY price ASC').all(panel.name, validity);
    if (plans.length > 0) {
      text += `🔹 *${panel.display_name}*\n`;
      plans.forEach((p) => {
        text += `▫️ ${p.gb}GB | ${p.validity} روز | ${formatNumber(p.price)} تومان\n`;
      });
      text += '\n';
    }
  });

  if (panels.length === 0) {
    text += 'پلنی موجود نیست.\n\n';
  }

  text += '━━━━━━━━━━━━━━━━━━\n';
  text += '⚠️ قیمت‌ها به تومان می‌باشند.';
  const buttons = [[b('بازگشت ◀️', 'prices', 'back')]];
  safeEdit(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('my_services', async (ctx) => {
  if (isBanned(ctx.from.id)) return;
  try { await ctx.answerCbQuery(); } catch (_) {}
  const userId = ctx.from.id;

  // Get delivered orders only (purchased services)
  const orders = db.prepare("SELECT * FROM orders WHERE user_id = ? AND status = 'delivered' ORDER BY created_at DESC").all(userId);

  if (orders.length === 0) {
    const text = '🛍️ شما هنوز سرویسی خریداری نکرده‌اید.';
    const opts = mainMenu();
    try { await ctx.reply(text, opts); } catch (_) {}
    return;
  }

  let text = '🛍️ <b>سرویس‌های شما</b>\n\nیک سرویس را انتخاب کنید:';
  const buttons = [];

  // Orders only
  orders.forEach((o, i) => {
    const shortName = o.plan_name.length > 25 ? o.plan_name.substring(0, 25) + '…' : o.plan_name;
    buttons.push([Markup.button.callback(`${i + 1}. ${shortName} | ${o.validity} روز`, `service_detail_order_${o.id}`)]);
  });

  buttons.push([b('🏠 بازگشت به منوی اصلی ◀️', 'back_to_menu', 'back')]);

  const options = { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) };

  try { 
    await ctx.reply(text, options); 
  } catch (err) {
    console.error('[MY_SERVICES] Reply FAILED:', err.message);
    try { await ctx.reply(text.replace(/<[^>]+>/g, ''), { ...Markup.inlineKeyboard(buttons) }); } catch (_) {}
  }
});

// Service detail for free trial
bot.action(/^service_detail_trial_(\d+)$/, async (ctx) => {
  if (isBanned(ctx.from.id)) return;
  try { await ctx.answerCbQuery(); } catch (_) {}
  const trialId = Number(ctx.match[1]);

  const trial = db.prepare('SELECT * FROM free_trials WHERE id = ? AND claimed_by = ?').get(trialId, ctx.from.id);
  if (!trial) {
    const msg = '❌ تست رایگان یافت نشد.';
    try { await ctx.reply(msg); } catch (_) {}
    return;
  }

  let expireDate = 'نامشخص';
  if (trial.created_at) {
    const d = new Date(trial.created_at);
    expireDate = d.toLocaleDateString('fa-IR');
  }

  // Show basic info immediately
  const text =
    `🎁 *تست رایگان #${trial.id}*\n━━━━━━━━━━━━━━━━━━\n\n` +
    `📅 تاریخ فعال‌سازی: ${expireDate}\n` +
    `🔗 لینک اتصال:\n\`${trial.sub_link}\`\n\n` +
    `📱 برای اتصال از کلاینت‌های V2Ray استفاده کنید.`;

  const buttons = [
    [Markup.button.callback('📋 کپی لینک', `copy_link_${trial.sub_link}`)],
    [Markup.button.callback('🔄 بروزرسانی اطلاعات پنل', `refresh_trial_${trialId}`)],
    [b('بازگشت ◀️', 'my_services', 'back')],
  ];

  // Always reply (more reliable than edit)
  const options = { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) };
  try { 
    await ctx.reply(text.replace(/\*/g, '<b>').replace(/`/g, '<code>'), options); 
    console.log('[SERVICE_DETAIL_TRIAL] Basic info sent for trial:', trialId);
  } catch (err) {
    console.error('[SERVICE_DETAIL_TRIAL] Reply failed:', err.message);
  }

  // Try to fetch live info in background
  try {
    const userInfo = await Promise.race([
      panelApi('GET', '/user/ft' + ctx.from.id),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 8000))
    ]);
    if (userInfo) {
      let remainingGB = 'نامشخص';
      let remainingTime = 'نامشخص';
      let usedGB = 'نامشخص';

      if (userInfo.data_limit && userInfo.used_traffic !== undefined) {
        usedGB = (userInfo.used_traffic / (1024 * 1024 * 1024)).toFixed(2);
        remainingGB = ((userInfo.data_limit - userInfo.used_traffic) / (1024 * 1024 * 1024)).toFixed(2);
      }
      if (created.expire) {
        const now = Math.floor(Date.now() / 1000);
        const daysLeft = Math.max(0, Math.ceil((userInfo.expire - now) / 86400));
        remainingTime = `${daysLeft} روز`;
      }

      const liveText =
        `🎁 *تست رایگان #${trial.id}*\n━━━━━━━━━━━━━━━━━━\n\n` +
        `📅 تاریخ فعال‌سازی: ${expireDate}\n` +
        `🔗 لینک اتصال:\n\`${trial.sub_link}\`\n` +
        `\n📊 *اطلاعات زنده از پنل:*\n` +
        `   📥 حجم استفاده شده: ${usedGB} GB\n` +
        `   📤 حجم باقی‌مانده: ${remainingGB} GB\n` +
        `   ⏰ زمان باقی‌مانده: ${remainingTime}\n\n` +
        `📱 برای اتصال از کلاینت‌های V2Ray استفاده کنید.`;

      await safeEdit(ctx, liveText, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    }
  } catch (err) {
    // Silent fail - basic info already shown
  }
});

// Refresh trial info handler
bot.action(/^refresh_trial_(\d+)$/, async (ctx) => {
  safeAnswer(ctx, '🔄 در حال بروزرسانی...');
  if (isBanned(ctx.from.id)) return;
  const trialId = Number(ctx.match[1]);

  const trial = db.prepare('SELECT * FROM free_trials WHERE id = ? AND claimed_by = ?').get(trialId, ctx.from.id);
  if (!trial) return safeEdit(ctx, '❌ تست رایگان یافت نشد.', mainMenu());

  const text = `🔄 در حال دریافت اطلاعات زنده...`;
  await safeEdit(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[b('بازگشت ◀️', 'my_services', 'back')]]) });

  try {
    const userInfo = await Promise.race([
      panelApi('GET', '/user/ft' + ctx.from.id),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 8000))
    ]);
    if (userInfo) {
      let remainingGB = 'نامشخص';
      let remainingTime = 'نامشخص';
      let usedGB = 'نامشخص';

      if (userInfo.data_limit && userInfo.used_traffic !== undefined) {
        usedGB = (userInfo.used_traffic / (1024 * 1024 * 1024)).toFixed(2);
        remainingGB = ((userInfo.data_limit - userInfo.used_traffic) / (1024 * 1024 * 1024)).toFixed(2);
      }
      if (created.expire) {
        const now = Math.floor(Date.now() / 1000);
        const daysLeft = Math.max(0, Math.ceil((userInfo.expire - now) / 86400));
        remainingTime = `${daysLeft} روز`;
      }

      const expireDate = trial.created_at ? new Date(trial.created_at).toLocaleDateString('fa-IR') : 'نامشخص';
      const liveText =
        `🎁 *تست رایگان #${trial.id}*\n━━━━━━━━━━━━━━━━━━\n\n` +
        `📅 تاریخ فعال‌سازی: ${expireDate}\n` +
        `🔗 لینک اتصال:\n\`${trial.sub_link}\`\n` +
        `\n📊 *اطلاعات زنده از پنل:*\n` +
        `   📥 حجم استفاده شده: ${usedGB} GB\n` +
        `   📤 حجم باقی‌مانده: ${remainingGB} GB\n` +
        `   ⏰ زمان باقی‌مانده: ${remainingTime}\n\n` +
        `📱 برای اتصال از کلاینت‌های V2Ray استفاده کنید.`;

      const buttons = [
        [Markup.button.callback('📋 کپی لینک', `copy_link_${trial.sub_link}`)],
        [Markup.button.callback('🔄 بروزرسانی', `refresh_trial_${trialId}`)],
        [b('بازگشت ◀️', 'my_services', 'back')],
      ];

      return safeEdit(ctx, liveText, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    }
  } catch (err) {
    return safeEdit(ctx, `❌ خطا در دریافت اطلاعات.\n\n🔗 لینک:\n\`${trial.sub_link}\``, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[b('بازگشت ◀️', 'my_services', 'back')]]) });
  }
});

// Service detail for order
bot.action(/^service_detail_order_(\d+)$/, async (ctx) => {
  safeAnswer(ctx);
  if (isBanned(ctx.from.id)) return;
  const orderId = Number(ctx.match[1]);

  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ? AND status = 'delivered'").get(orderId, ctx.from.id);
  if (!order) {
    return safeEdit(ctx, '❌ سفارش یافت نشد.', mainMenu());
  }

  // Send QR code photo if available
  if (order.qr_file_id) {
    try {
      await ctx.replyWithPhoto(order.qr_file_id, {
        caption: `📱 QR کد سرویس: ${escapeMarkdown(order.plan_name)}`,
      });
    } catch (err) {}
  }

  // Try to fetch live data from panel
  let liveData = null;
  if (order.panel_username) {
    liveData = await fetchPanelUserInfo(order.panel_username);
  }

  let text = `📦 *${escapeMarkdown(order.plan_name)}*\n━━━━━━━━━━━━━━━━━━\n\n`;

  if (liveData) {
    // Live data from panel
    const dataLimitGB = liveData.data_limit ? (liveData.data_limit / (1024 * 1024 * 1024)).toFixed(1) : order.plan_gb;
    const usedGB = liveData.used_traffic ? (liveData.used_traffic / (1024 * 1024 * 1024)).toFixed(1) : '0';
    const totalGB = order.plan_gb;
    const usagePercent = Math.min(100, Math.round((usedGB / totalGB) * 100));

    let expireText = 'نامحدود';
    let remainingDays = 0;
    if (liveData.expire) {
      const expDate = new Date(liveData.expire);
      if (!isNaN(expDate.getTime()) && expDate.getTime() > 0) {
        remainingDays = Math.ceil((expDate - Date.now()) / (1024 * 60 * 60 * 24));
        expireText = `${expDate.toLocaleDateString('fa-IR')} (${remainingDays} روز باقی‌مانده)`;
      }
    }

    const statusText = liveData.status === 'active' ? '✅ فعال' : '❌ غیرفعال';

    // Create usage progress bar
    const barLength = 10;
    const filledBars = Math.round((usagePercent / 100) * barLength);
    const emptyBars = barLength - filledBars;
    const usageBar = '█'.repeat(filledBars) + '░'.repeat(emptyBars);

    // Create time progress bar
    const timePercent = order.validity > 0 ? Math.min(100, Math.round(((order.validity - remainingDays) / order.validity) * 100)) : 0;
    const timeFilled = Math.round((timePercent / 100) * barLength);
    const timeEmpty = barLength - timeFilled;
    const timeBar = '█'.repeat(timeFilled) + '░'.repeat(timeEmpty);

    text +=
      `👤 *نام کاربری پنل:* \`${liveData.username}\`\n` +
      `📊 *وضعیت:* ${statusText}\n\n` +
      `🗜 *حجم مصرف شده:*\n` +
      `\`${usageBar}\` ${usagePercent}%\n` +
      `${usedGB} گیگابایت از ${totalGB} گیگابایت\n` +
      `✅ باقی‌مانده: ${(totalGB - usedGB).toFixed(1)} گیگابایت\n\n` +
      `⏳ *زمان باقی‌مانده:*\n` +
      `\`${timeBar}\` ${timePercent}%\n` +
      `${expireText}\n\n` +
      (order.sub_link ? `🔗 *لینک اشتراک:*\n\`${order.sub_link}\`` : '');
  } else {
    // Fallback to DB data
    const createdDate = new Date(order.created_at).toLocaleDateString('fa-IR');
    const expiryDate = new Date(new Date(order.created_at).getTime() + order.validity * 24 * 60 * 60 * 1000).toLocaleDateString('fa-IR');

    // Calculate time progress
    const daysPassed = Math.floor((Date.now() - new Date(order.created_at).getTime()) / (1000 * 60 * 60 * 24));
    const timePercent = Math.min(100, Math.round((daysPassed / order.validity) * 100));
    const barLength = 10;
    const timeFilled = Math.round((timePercent / 100) * barLength);
    const timeEmpty = barLength - timeFilled;
    const timeBar = '█'.repeat(timeFilled) + '░'.repeat(timeEmpty);

    text +=
      `📅 تاریخ فعال‌سازی: ${createdDate}\n` +
      `📅 تاریخ انقضا: ${expiryDate}\n\n` +
      `⏱ *زمان سپری شده:*\n` +
      `\`${timeBar}\` ${timePercent}%\n` +
      `${daysPassed} روز از ${order.validity} روز\n\n` +
      `🗜 حجم اشتراک: ${order.plan_gb} گیگابایت\n` +
      `💰 مبلغ پرداختی: ${formatNumber(order.price)} تومان\n` +
      `🖥 پنل: ${order.panel === 'pasarguard' ? '🔹 پاسارگارد' : '🔹 اکونومیك'}\n` +
      (order.panel_username ? `\n👤 *نام کاربری:* \`${order.panel_username}\`` : '') +
      (order.sub_link ? `\n🔗 لینک اشتراک:\n\`${order.sub_link}\`` : '') +
      `\n\n⚠️ اطلاعات زنده از پنل دریافت نشد.`;
  }

  const plan = getPlanByGb(order.plan_gb, order.panel || 'pasarguard');
  const buttons = [];

  if (plan) {
    buttons.push([Markup.button.callback(`💳 تمدید سرویس`, 'renew_service')]);
  }

  buttons.push([Markup.button.callback('🗑 حذف سرویس', `delete_service_${order.id}`)]);
  buttons.push([b('بازگشت ◀️', 'my_services', 'back')]);

  safeEdit(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

// Delete service handler
bot.action(/^delete_service_(\d+)$/, async (ctx) => {
  safeAnswer(ctx);
  if (isBanned(ctx.from.id)) return;
  const orderId = Number(ctx.match[1]);

  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ? AND status = 'delivered'").get(orderId, ctx.from.id);
  if (!order) {
    return safeEdit(ctx, '❌ سرویس یافت نشد.', mainMenu());
  }

  // Confirmation
  safeEdit(ctx, `⚠️ آیا از حذف سرویس ${escapeMarkdown(order.plan_name)} اطمینان دارید?\n\nاین عمل قابل بازگشت نیست.`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('✅ بله، حذف شود', `confirm_delete_${orderId}`)],
      [b('❌ خیر، بازگشت', `service_detail_order_${orderId}`, 'backFromDelete')],
    ]),
  });
});

// Confirm delete handler
bot.action(/^confirm_delete_(\d+)$/, async (ctx) => {
  safeAnswer(ctx);
  if (isBanned(ctx.from.id)) return;
  const orderId = Number(ctx.match[1]);

  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ? AND status = 'delivered'").get(orderId, ctx.from.id);
  if (!order) {
    return safeEdit(ctx, '❌ سرویس یافت نشد.', mainMenu());
  }

  // Delete user from panel if panel_username exists
  if (order.panel_username) {
    try {
      await panelApi('DELETE', `/user/${order.panel_username}`);
    } catch (e) {}
  }

  // Delete from orders table
  db.prepare("DELETE FROM orders WHERE id = ?").run(orderId);

  safeEdit(ctx, `✅ سرویس ${escapeMarkdown(order.plan_name)} حذف شد.`, mainMenu());

  // Notify admin
  bot.telegram.sendMessage(ADMIN_ID,
    `🗑 سرویس #${orderId} توسط کاربر حذف شد\n👤 @${ctx.from.username || 'ندارد'} (${ctx.from.id})\n🔹 ${order.plan_name}`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});
});

// Copy link handler
bot.action(/^copy_link_(.+)$/, (ctx) => {
  safeAnswer(ctx, '🔗 لینک کپی شد! (در کلیپ‌بورد خودتان جایگذاری کنید)', true);
});

bot.action('renew_service', (ctx) => {
  safeAnswer(ctx);
  if (isBanned(ctx.from.id)) return;
  const orders = db.prepare("SELECT * FROM orders WHERE user_id = ? AND status = 'delivered' ORDER BY created_at DESC").all(ctx.from.id);

  if (orders.length === 0) {
    return safeEdit(ctx,'❌ شما سرویس فعالی ندارید.\nابتدا یک اشتراک خریداری کنید.', mainMenu());
  }

  const latest = orders[0];
  const plan = getPlanByGb(latest.plan_gb, latest.panel || 'pasarguard');
  if (!plan) {
    return safeEdit(ctx,'❌ پلن یافت نشد.', mainMenu());
  }

  const wallet = getWallet(ctx.from.id);
  const canPay = wallet >= plan.price;

  const text =
    `♻️ *تمدید سرویس*\n\n` +
    `🔹 سرویس قبلی: ${escapeMarkdown(plan.name)}\n` +
    `🔹 مدت: ${plan.validity} روز\n` +
    `🔹 قیمت: ${formatNumber(plan.price)} تومان\n` +
    `💰 موجودی کیف پول: ${formatNumber(wallet)} تومان\n\n` +
    (canPay
      ? `✅ موجودی کافی است`
      : `❌ موجودی کافی نیست\nلطفاً ابتدا کیف پول خود را شارژ کنید`);

  const buttons = [];
  if (canPay) {
    buttons.push([Markup.button.callback(`💳 تمدید - ${formatNumber(plan.price)} تومان`, `pay_${plan.gb}_${latest.panel || 'pasarguard'}`)]);
  } else {
    buttons.push([b('💰 افزایش موجودی', 'add_balance', 'addBalance')]);
  }
  buttons.push([b('بازگشت ◀️', 'back_to_menu', 'back')]);

  safeEdit(ctx,text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('support', (ctx) => {
  safeAnswer(ctx);
  const text =
    `👤 پشتیبانی\n\n` +
    `برای ارتباط با پشتیبانی روی دکمه زیر کلیک کنید:\n\n` +
    `🆔 @${ADMIN_USERNAME}\n\n` +
    `⏰ پاسخگویی در ساعات کاری انجام می‌شود.`;

  safeEdit(ctx, text, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📞 پیام به پشتیبانی', url: `https://t.me/${ADMIN_USERNAME}` }],
        [{ text: 'بازگشت به منوی اصلی ◀️', callback_data: 'back_to_menu', style: buttonStyles ? 'danger' : undefined }],
      ],
    },
  });
});

bot.action('admin_dashboard', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;

  const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const activeUsers = db.prepare('SELECT COUNT(*) as c FROM users WHERE banned = 0').get().c;
  const bannedUsers = db.prepare('SELECT COUNT(*) as c FROM users WHERE banned = 1').get().c;
  const newUsersToday = db.prepare("SELECT COUNT(*) as c FROM users WHERE date(created_at) = date('now')").get().c;
  const newUsersWeek = db.prepare("SELECT COUNT(*) as c FROM users WHERE created_at >= datetime('now', '-7 days')").get().c;

  const totalOrders = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  const pendingOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'pending'").get().c;
  const deliveredOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'delivered'").get().c;
  const rejectedOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'rejected'").get().c;

  const totalCharges = db.prepare('SELECT COUNT(*) as c FROM charges').get().c;
  const pendingCharges = db.prepare("SELECT COUNT(*) as c FROM charges WHERE status = 'waiting_admin'").get().c;
  const confirmedCharges = db.prepare("SELECT COUNT(*) as c FROM charges WHERE status = 'confirmed'").get().c;
  const rejectedCharges = db.prepare("SELECT COUNT(*) as c FROM charges WHERE status = 'rejected'").get().c;

  const totalRevenue = db.prepare("SELECT COALESCE(SUM(price), 0) as s FROM orders WHERE status = 'delivered'").get().s;
  const totalWalletBalance = db.prepare('SELECT COALESCE(SUM(wallet), 0) as s FROM users').get().s;
  const totalChargeAmount = db.prepare("SELECT COALESCE(SUM(amount), 0) as s FROM charges WHERE status = 'confirmed'").get().s;

  const todayOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE date(created_at) = date('now')").get().c;
  const todayRevenue = db.prepare("SELECT COALESCE(SUM(price), 0) as s FROM orders WHERE status = 'delivered' AND date(created_at) = date('now')").get().s;
  const weekOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE created_at >= datetime('now', '-7 days')").get().c;
  const weekRevenue = db.prepare("SELECT COALESCE(SUM(price), 0) as s FROM orders WHERE status = 'delivered' AND created_at >= datetime('now', '-7 days')").get().s;

  const topPlan = db.prepare("SELECT plan_name, COUNT(*) as c FROM orders WHERE status = 'delivered' GROUP BY plan_name ORDER BY c DESC LIMIT 1").get();

  let text = '📊 *داشبورد مدیریت*\n';
  text += '━━━━━━━━━━━━━━━━━━\n\n';

  text += '👥 *کاربران*\n';
  text += `   ▫️ کل: ${totalUsers}\n`;
  text += `   ▫️ فعال: ${activeUsers} | مسدود: ${bannedUsers}\n`;
  text += `   ▫️ امروز: ${newUsersToday} | هفته: ${newUsersWeek}\n\n`;

  const totalReferrals = db.prepare('SELECT COUNT(*) as c FROM users WHERE referred_by IS NOT NULL').get().c;
  text += '👥 *دعوت‌ها*\n';
  text += `   ▫️ کل دعوت شده: ${totalReferrals}\n\n`;

  text += '📋 *سفارشات*\n';
  text += `   ▫️ کل: ${totalOrders}\n`;
  text += `   ▫️ در انتظار: ${pendingOrders}\n`;
  text += `   ▫️ تحویل شده: ${deliveredOrders} | رد شده: ${rejectedOrders}\n`;
  text += `   ▫️ امروز: ${todayOrders} | هفته: ${weekOrders}\n\n`;

  text += '💰 *شارژها*\n';
  text += `   ▫️ کل: ${totalCharges}\n`;
  text += `   ▫️ در انتظار: ${pendingCharges}\n`;
  text += `   ▫️ تایید شده: ${confirmedCharges} | رد شده: ${rejectedCharges}\n\n`;

  text += '💵 *درآمد*\n';
  text += `   ▫️ کل درآمد: ${formatNumber(totalRevenue)} ت\n`;
  text += `   ▫️ درآمد امروز: ${formatNumber(todayRevenue)} ت\n`;
  text += `   ▫️ درآمد هفته: ${formatNumber(weekRevenue)} ت\n`;
  text += `   ▫️ کل شارژها: ${formatNumber(totalChargeAmount)} ت\n`;
  text += `   ▫️ موجودی کیف‌پول‌ها: ${formatNumber(totalWalletBalance)} ت\n\n`;

  if (topPlan) {
    text += '🔥 *پر فروش‌ترین پلن*\n';
    text += `   ▫️ ${escapeMarkdown(topPlan.plan_name)} (${topPlan.c} فروش)\n`;
  }

  const trialUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE used_free_test = 1").get().c;
  const panelUsers = db.prepare("SELECT COUNT(*) as c FROM free_trials WHERE active = 1").get().c;
  text += '\n🎁 *تست رایگان*\n';
  text += `   ▫️ کاربرانی که تست گرفتن: ${trialUsers}\n`;
  text += `   ▫️ پنل‌های تست فعال: ${panelUsers}\n\n`;

  text += '\n━━━━━━━━━━━━━━━━━━';

  const buttons = [
    [Markup.button.callback('👥 لیست دعوت‌ها', 'admin_referral_list')],
    [Markup.button.callback('🗑️ پاک کردن سفارشات', 'admin_reset_orders_confirm')],
    [Markup.button.callback('🗑️ پاک کردن شارژها', 'admin_reset_charges_confirm')],
    [Markup.button.callback('💰 صفر کردن کیف پول‌ها', 'admin_reset_wallets_confirm')],
    [Markup.button.callback('🎁 ریست تست رایگان', 'admin_reset_trials_confirm')],
    [Markup.button.callback('💣 پاک کردن همه', 'admin_reset_all_confirm')],
    [b('🏷️ مدیریت کد تخفیف', 'admin_discount_codes', 'discount')],
    [b('بازگشت ◀️', 'back_to_menu', 'back')],
  ];
  safeEdit(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('admin_referral_list', async (ctx) => {
  await safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;

  try {
    // Simple query without JOIN first
    const referredUsers = db.prepare(`
      SELECT user_id, username, first_name, created_at, referred_by
      FROM users
      WHERE referred_by IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 50
    `).all();

    const totalReferrals = db.prepare('SELECT COUNT(*) as c FROM users WHERE referred_by IS NOT NULL').get().c;

    let text = `👥 *لیست دعوت‌ها*\n━━━━━━━━━━━━━━━━━━\n\n`;
    text += `📊 کل دعوت شده: ${totalReferrals}\n\n`;

    if (referredUsers.length === 0) {
      text += 'هیچ دعوتی ثبت نشده است.';
    } else {
      referredUsers.forEach((u, i) => {
        const displayName = u.username ? `@${u.username}` : (u.first_name || String(u.user_id));
        text += `${i + 1}. ${displayName} (ID: ${u.user_id})\n`;
        text += `   📅 ${new Date(u.created_at).toLocaleDateString('fa-IR')}\n\n`;
      });
    }

    const buttons = [
      [b('بازگشت ◀️', 'admin_dashboard', 'back')],
    ];

    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  } catch (err) {
    console.error('[REFERRAL_LIST] Error:', err.message);
    await ctx.reply('❌ خطا در نمایش لیست دعوت‌ها: ' + err.message).catch(() => {});
  }
});

bot.action('admin_reset_orders_confirm', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  safeEdit(ctx, '⚠️ آیا مطمئنید که می‌خواهید تمام سفارشات را پاک کنید؟\n\nاین عمل غیرقابل بازگشت است!', Markup.inlineKeyboard([
    [Markup.button.callback('✅ بله، پاک کن', 'admin_reset_orders')],
    [b('❌ انصراف', 'admin_dashboard', 'back')],
  ]));
});

bot.action('admin_reset_orders', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  db.prepare('DELETE FROM orders').run();
  safeEdit(ctx, '✅ تمام سفارشات پاک شدند.');
  setTimeout(() => bot.telegram.editMessageText(ctx.chat.id, ctx.callbackQuery.message.message_id, undefined, '✅ تمام سفارشات پاک شدند.\n\n📊 /admin برای بازگشت', { parse_mode: 'Markdown' }), 1000);
});

bot.action('admin_reset_charges_confirm', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  safeEdit(ctx, '⚠️ آیا مطمئنید که می‌خواهید تمام شارژها را پاک کنید؟\n\nاین عمل غیرقابل بازگشت است!', Markup.inlineKeyboard([
    [Markup.button.callback('✅ بله، پاک کن', 'admin_reset_charges')],
    [b('❌ انصراف', 'admin_dashboard', 'back')],
  ]));
});

bot.action('admin_reset_charges', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  db.prepare('DELETE FROM charges').run();
  safeEdit(ctx, '✅ تمام شارژها پاک شدند.\n\n📊 /admin برای بازگشت');
});

bot.action('admin_reset_wallets_confirm', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  safeEdit(ctx, '⚠️ آیا مطمئنید که می‌خواهید موجودی تمام کیف پول‌ها را صفر کنید؟\n\nاین عمل غیرقابل بازگشت است!', Markup.inlineKeyboard([
    [Markup.button.callback('✅ بله، صفر کن', 'admin_reset_wallets')],
    [b('❌ انصراف', 'admin_dashboard', 'back')],
  ]));
});

bot.action('admin_reset_wallets', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  db.prepare('UPDATE users SET wallet = 0').run();
  safeEdit(ctx, '✅ موجودی تمام کیف پول‌ها صفر شد.\n\n📊 /admin برای بازگشت');
});

bot.action('admin_reset_all_confirm', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  safeEdit(ctx, '⚠️ آیا مطمئنید که می‌خواهید همه چیز را پاک کنید؟\n\n✅ تمام سفارشات\n✅ تمام شارژها\n✅ موجودی تمام کیف پول‌ها\n\nاین عمل غیرقابل بازگشت است!', Markup.inlineKeyboard([
    [Markup.button.callback('✅ بله، همه را پاک کن', 'admin_reset_all')],
    [b('❌ انصراف', 'admin_dashboard', 'back')],
  ]));
});

bot.action('admin_reset_all', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  db.prepare('DELETE FROM orders').run();
  db.prepare('DELETE FROM charges').run();
  db.prepare('UPDATE users SET wallet = 0').run();
  safeEdit(ctx, '✅ همه چیز پاک شد:\n\n✅ سفارشات پاک شدند\n✅ شارژها پاک شدند\n✅ کیف پول‌ها صفر شدند\n\n📊 /admin برای بازگشت');
});

bot.action('admin_reset_trials_confirm', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const count = db.prepare("SELECT COUNT(*) as c FROM users WHERE used_free_test = 1").get().c;
  safeEdit(ctx, `⚠️ آیا مطمئنید که می‌خواهید تست رایگان را ریست کنید?\n\n🔄 ${count} کاربر دوباره می‌توانند تست رایگان بگیرند.\n\nاین عمل غیرقابل بازگشت است!`, Markup.inlineKeyboard([
    [Markup.button.callback('✅ بله، ریست کن', 'admin_reset_trials')],
    [b('❌ انصراف', 'admin_dashboard', 'back')],
  ]));
});

bot.action('admin_reset_trials', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const result = db.prepare('UPDATE users SET used_free_test = 0 WHERE used_free_test = 1').run();
  safeEdit(ctx, `✅ تست رایگان ریست شد!\n\n🔄 ${result.changes} کاربر دوباره می‌توانند تست بگیرند.\n\n📊 /admin برای بازگشت`);
});

// === Discount Codes Management ===
function discountCodesList() {
  const codes = db.prepare('SELECT * FROM discount_codes ORDER BY created_at DESC').all();
  let text = '🏷️ *مدیریت کد تخفیف*\n━━━━━━━━━━━━━━━━━━\n\n';
  if (codes.length === 0) {
    text += 'هیچ کد تخفیفی وجود ندارد.';
  } else {
    codes.forEach((c) => {
      const status = c.active ? '✅' : '❌';
      const usage = c.max_uses === -1 ? '∞' : `${c.used_count}/${c.max_uses}`;
      text += `${status} \`${c.code}\` | ${c.percent}% | استفاده: ${usage}\n`;
    });
  }
  return text;
}

bot.action('admin_discount_codes', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const buttons = [
    [Markup.button.callback('➕ ساخت کد جدید', 'admin_add_discount_code')],
    [b('بازگشت ◀️', 'back_to_menu', 'back')],
  ];
  safeEdit(ctx, discountCodesList(), { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('admin_add_discount_code', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  adminState[ADMIN_ID] = { action: 'add_discount_code' };
  safeEdit(ctx, '🏷️ *ساخت کد تخفیف جدید*\n\n📝 نام کد تخفیف را وارد کنید:\n(مثال: RAMADAN20)', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[b('لغو', 'admin_discount_codes', 'back')]]),
  });
});

bot.action(/^admin_toggle_discount_(\d+)$/, (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const id = Number(ctx.match[1]);
  const code = db.prepare('SELECT * FROM discount_codes WHERE id = ?').get(id);
  if (!code) return safeEdit(ctx, '❌ کد یافت نشد.', Markup.inlineKeyboard([
    [b('بازگشت ◀️', 'back_to_menu', 'back')],
  ]));
  const newStatus = code.active ? 0 : 1;
  db.prepare('UPDATE discount_codes SET active = ? WHERE id = ?').run(newStatus, id);
  safeEdit(ctx, `✅ کد \`${code.code}\` ${newStatus ? 'فعال' : 'غیرفعال'} شد.`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([
    [b('بازگشت ◀️', 'back_to_menu', 'back')],
  ]) });
});

bot.action(/^admin_delete_discount_(\d+)$/, (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const id = Number(ctx.match[1]);
  const code = db.prepare('SELECT * FROM discount_codes WHERE id = ?').get(id);
  if (!code) return safeEdit(ctx, '❌ کد یافت نشد.', Markup.inlineKeyboard([
    [b('بازگشت ◀️', 'back_to_menu', 'back')],
  ]));
  db.prepare('DELETE FROM discount_codes WHERE id = ?').run(id);
  safeEdit(ctx, `✅ کد \`${code.code}\` حذف شد.`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([
    [b('بازگشت ◀️', 'back_to_menu', 'back')],
  ]) });
});

bot.action('admin_orders', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;

  const orders = db.prepare("SELECT o.*, u.username FROM orders o LEFT JOIN users u ON o.user_id = u.user_id WHERE o.status = 'pending' ORDER BY o.created_at DESC").all();

  if (orders.length === 0) {
    return safeEdit(ctx,'📋 سفارش در انتظاری وجود ندارد.', adminMenu());
  }

  let text = '📋 *سفارشات در انتظار*\n\n';
  orders.forEach((o) => {
    text += `🆔 #${o.id} | @${escapeMarkdown(o.username || 'ندارد')}\n`;
    text += `🔹 ${escapeMarkdown(o.plan_name)} | ${o.validity} روز | ${formatNumber(o.price)} تومان\n`;
    text += `📅 ${o.created_at}\n\n`;
  });

  const buttons = orders.map((o) => [
    Markup.button.callback(`❌ #${o.id}`, `admin_order_reject_${o.id}`),
  ]);
  buttons.push([b('بازگشت ◀️', 'back_to_menu', 'back')]);

  safeEdit(ctx,text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('admin_charges', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;

  const charges = db.prepare("SELECT c.*, u.username FROM charges c LEFT JOIN users u ON c.user_id = u.user_id WHERE c.status = 'waiting_admin' ORDER BY c.created_at DESC").all();

  if (charges.length === 0) {
    return safeEdit(ctx,'💰 شارژ در انتظاری وجود ندارد.', adminMenu());
  }

  let text = '💰 *شارژهای در انتظار*\n\n';
  charges.forEach((c) => {
    text += `🆔 #${c.id} | @${escapeMarkdown(c.username || 'ندارد')} (${c.user_id})\n`;
    text += `💵 مبلغ: ${formatNumber(c.amount)} تومان\n`;
    text += `📅 ${c.created_at}\n\n`;
  });

  const buttons = charges.map((c) => [
    Markup.button.callback(`✅ #${c.id}`, `admin_confirm_${c.id}`),
    Markup.button.callback(`❌ #${c.id}`, `admin_reject_${c.id}`),
  ]);
  buttons.push([b('بازگشت ◀️', 'back_to_menu', 'back')]);

  safeEdit(ctx,text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('admin_users', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  showUsers(ctx, 0);
});

bot.action(/^admin_users_page_(\d+)$/, (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  showUsers(ctx, Number(ctx.match[1]));
});

bot.action('admin_search_user', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  adminState[ADMIN_ID] = { action: 'search_user' };
  safeEdit(ctx, '🔍 *جستجوی کاربر*\n\nنام کاربری یا آیدی عددی کاربر را وارد کنید:', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[b('لغو', 'back_to_menu', 'back')]]),
  });
});

bot.action(/^admin_user_(\d+)$/, (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const userId = Number(ctx.match[1]);
  showUserDetail(ctx, userId);
});

function showUsers(ctx, page) {
  const perPage = 10;
  const total = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const totalPages = Math.ceil(total / perPage);
  const users = db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?').all(perPage, page * perPage);

  let text = `👥 *کاربران* (${page + 1}/${totalPages}) | کل: ${total}\n\n`;
  users.forEach((u, i) => {
    const status = u.banned ? '🚫' : '✅';
    const displayName = u.username ? `@${u.username}` : (u.first_name || `${u.user_id}`);
    text += `${i + 1}. ${status} ${escapeMarkdown(displayName)} | 💰${formatNumber(u.wallet)}\n`;
  });

  const buttons = users.map((u) => {
    const label = u.username ? `@${u.username}` : `${u.first_name || 'کاربر'} (${u.user_id})`;
    return [Markup.button.callback(label, `admin_user_${u.user_id}`)];
  });

  const nav = [];
  if (page > 0) nav.push(Markup.button.callback('◀️ قبلی', `admin_users_page_${page - 1}`));
  if (page < totalPages - 1) nav.push(Markup.button.callback('بعدی ▶️', `admin_users_page_${page + 1}`));
  if (nav.length) buttons.push(nav);
  buttons.push([b('بازگشت ◀️', 'back_to_menu', 'back')]);

  safeEdit(ctx,text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

function buildUserDetailText(userId) {
  const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
  if (!user) return null;

  const orders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE user_id = ?").get(userId).c;
  const deliveredOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE user_id = ? AND status = 'delivered'").get(userId).c;
  const totalSpent = db.prepare("SELECT COALESCE(SUM(price), 0) as s FROM orders WHERE user_id = ? AND status = 'delivered'").get(userId).s;
  const charges = db.prepare("SELECT COALESCE(SUM(amount), 0) as s FROM charges WHERE user_id = ? AND status = 'confirmed'").get(userId).s;
  const status = user.banned ? '🚫 مسدود' : '✅ فعال';
  const recentOrders = db.prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 5").all(userId);

  let text = '👤 *اطلاعات کاربر*\n';
  text += '━━━━━━━━━━━━━━━━━━\n\n';
  text += `🔹 آیدی عددی: \`${user.user_id}\`\n`;
  text += `🔹 نام کاربری: @${escapeMarkdown(user.username || 'ندارد')}\n`;
  text += `🔹 نام: ${escapeMarkdown(user.first_name || 'ندارد')}\n`;
  text += `🔹 وضعیت: ${status}\n`;
  text += `🔹 موجودی کیف پول: ${formatNumber(user.wallet)} تومان\n`;
  text += `🔹 تاریخ عضویت: ${user.created_at}\n\n`;
  text += '📋 *آمار*\n';
  text += `   ▫️ کل سفارشات: ${orders}\n`;
  text += `   ▫️ تحویل شده: ${deliveredOrders}\n`;
  text += `   ▫️ کل خرید: ${formatNumber(totalSpent)} تومان\n`;
  text += `   ▫️ کل شارژ: ${formatNumber(charges)} تومان\n\n`;

  if (recentOrders.length > 0) {
    text += '📦 *سفارشات اخیر*\n';
    recentOrders.forEach((o) => {
      const statusEmoji = o.status === 'delivered' ? '✅' : o.status === 'pending' ? '⏳' : '❌';
      text += `   ${statusEmoji} ${escapeMarkdown(o.plan_name)} | ${o.validity} روز | ${formatNumber(o.price)} تومان | ${o.created_at}\n`;
    });
  }

  text += '\n━━━━━━━━━━━━━━━━━━';

  const buttons = [];
  if (user.username) {
    buttons.push([Markup.button.url('👤 مشاهده پروفایل', `https://t.me/${user.username}`)]);
  }
  buttons.push([
    Markup.button.callback(`${user.banned ? '🟢 فعال' : '🔴 مسدود'}`, `admin_toggle_ban_${user.user_id}`),
    Markup.button.callback('➕ شارژ', `admin_charge_user_${user.user_id}`),
    Markup.button.callback('➖ کسر', `admin_deduct_user_${user.user_id}`),
  ]);
  buttons.push([Markup.button.callback('🔍 جستجوی کاربر دیگر', 'admin_search_user')]);
  buttons.push([Markup.button.callback('👥 لیست کاربران', 'admin_users')]);
  buttons.push([b('بازگشت ◀️', 'back_to_menu', 'back')]);

  return { text, buttons };
}

function showUserDetail(ctx, userId) {
  const result = buildUserDetailText(userId);
  if (!result) return safeEdit(ctx, '❌ کاربر یافت نشد.', adminMenu());
  safeEdit(ctx, result.text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(result.buttons) });
}

function showUserDetailMsg(ctx, userId) {
  const result = buildUserDetailText(userId);
  if (!result) return ctx.reply('❌ کاربر یافت نشد.');
  ctx.reply(result.text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(result.buttons) });
}

bot.action(/^admin_toggle_ban_(\d+)$/, (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const targetId = Number(ctx.match[1]);
  const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(targetId);
  if (!user) return ctx.reply('❌ کاربر یافت نشد.');

  const newStatus = user.banned ? 0 : 1;
  db.prepare('UPDATE users SET banned = ? WHERE user_id = ?').run(newStatus, targetId);

  const statusText = newStatus ? 'مسدود' : 'فعال';
  ctx.reply(`✅ کاربر @${escapeMarkdown(user.username || targetId)} ${statusText} شد.`);
  if (newStatus) {
    bot.telegram.sendMessage(targetId, '❌ حساب شما توسط مدیر مسدود شد.');
  } else {
    bot.telegram.sendMessage(targetId, '✅ حساب شما توسط مدیر فعال شد.');
  }
});

bot.action(/^admin_charge_user_(\d+)$/, (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const targetId = Number(ctx.match[1]);
  adminState[ADMIN_ID] = { action: 'manual_charge', targetUserId: targetId };
  ctx.reply(`💰 مبلغ شارژ برای کاربر ${targetId} را وارد کنید:`);
});

bot.action(/^admin_deduct_user_(\d+)$/, (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const targetId = Number(ctx.match[1]);
  adminState[ADMIN_ID] = { action: 'manual_deduct', targetUserId: targetId };
  ctx.reply(`💰 مبلغ کاهش از کیف پول کاربر ${targetId} را وارد کنید:`);
});

bot.action('admin_broadcast', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  adminState[ADMIN_ID] = { action: 'broadcast' };
  safeEdit(ctx,'📢 متن پیام همگانی را ارسال کنید:');
});

bot.action('admin_panels', async (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const panels = getAllPanels();

  let text = '🖥 مدیریت پنل‌ها\n\n';
  if (panels.length === 0) {
    text += 'هیچ پنلی وجود ندارد.';
  } else {
    panels.forEach((p) => {
      const status = p.active ? '✅ فعال' : '❌ غیرفعال';
      const planCount = db.prepare("SELECT COUNT(*) as c FROM plans WHERE panel = ? AND active = 1").get(p.name).c;
      text += `#${p.id} | ${p.display_name} (${p.name}) | ${status} | ${planCount} پلن\n`;
      if (p.description) text += `   ${p.description}\n`;
    });
  }

  const buttons = [
    [Markup.button.callback('➕ افزودن پنل جدید', 'admin_add_panel')],
  ];

  if (panels.length > 0) {
    panels.forEach((p) => {
      buttons.push([
        Markup.button.callback(`🔍 جزئیات #${p.id}`, `admin_panel_detail_${p.id}`),
        Markup.button.callback(`${p.active ? '❌ غیرفعال' : '✅ فعال'} #${p.id}`, `admin_toggle_panel_${p.id}`),
        Markup.button.callback('🗑️ حذف', `admin_delete_panel_${p.id}`),
      ]);
    });
  }

  buttons.push([b('بازگشت ◀️', 'back_to_menu', 'back')]);
  try {
    await ctx.editMessageText(text, Markup.inlineKeyboard(buttons));
  } catch (_) {
    await ctx.reply(text, Markup.inlineKeyboard(buttons));
  }
});

bot.action('admin_add_panel', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  adminState[ADMIN_ID] = { action: 'add_panel_name' };
  safeEdit(ctx, '🖥 نام پنل جدید را وارد کنید:\n(مثال: mypanel - فقط حروف انگلیسی و اعداد و underscores)', Markup.inlineKeyboard([[b('لغو', 'admin_panels', 'back')]]));
});

bot.action(/^admin_panel_detail_(\d+)$/, async (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const panelId = Number(ctx.match[1]);
  const panel = db.prepare('SELECT * FROM panels WHERE id = ?').get(panelId);
  if (!panel) return safeEdit(ctx, '❌ پنل یافت نشد.');

  const status = panel.active ? '✅ فعال' : '❌ غیرفعال';
  const planCount = db.prepare("SELECT COUNT(*) as c FROM plans WHERE panel = ? AND active = 1").get(panel.name).c;
  const totalPlanCount = db.prepare("SELECT COUNT(*) as c FROM plans WHERE panel = ?").get(panel.name).c;
  const orderCount = db.prepare("SELECT COUNT(*) as c FROM orders WHERE panel = ?").get(panel.name).c;

  let text = '🔍 جزئیات پنل\n\n';
  text += `شناسه: #${panel.id}\n`;
  text += `نام: ${panel.name}\n`;
  text += `نام نمایشی: ${panel.display_name}\n`;
  text += `توضیحات: ${panel.description || '---'}\n`;
  text += `وضعیت: ${status}\n`;
  text += `پلن‌های فعال: ${planCount}\n`;
  text += `کل پلن‌ها: ${totalPlanCount}\n`;
  text += `سفارشات: ${orderCount}\n`;
  text += `تاریخ ایجاد: ${panel.created_at}\n`;

  const buttons = [
    [
      Markup.button.callback('📝 ویرایش نام نمایشی', `admin_edit_panel_display_${panel.id}`),
      Markup.button.callback('📝 ویرایش توضیحات', `admin_edit_panel_desc_${panel.id}`),
    ],
    [
      Markup.button.callback(`${panel.active ? '❌ غیرفعال' : '✅ فعال'} کردن`, `admin_toggle_panel_${panel.id}`),
      Markup.button.callback('🗑️ حذف', `admin_delete_panel_${panel.id}`),
    ],
    [b('بازگشت ◀️', 'admin_panels', 'back')],
  ];

  try {
    await ctx.editMessageText(text, Markup.inlineKeyboard(buttons));
  } catch (_) {
    await ctx.reply(text, Markup.inlineKeyboard(buttons));
  }
});

bot.action(/^admin_edit_panel_display_(\d+)$/, async (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const panelId = Number(ctx.match[1]);
  const panel = db.prepare('SELECT * FROM panels WHERE id = ?').get(panelId);
  if (!panel) return safeEdit(ctx, '❌ پنل یافت نشد.');
  adminState[ADMIN_ID] = { action: 'edit_panel_display', panelId };
  ctx.reply(`📝 نام نمایشی فعلی: ${panel.display_name}\n\nنام نمایشی جدید را وارد کنید:`, Markup.inlineKeyboard([[b('لغو', `admin_panel_detail_${panelId}`, 'back')]]));
});

bot.action(/^admin_edit_panel_desc_(\d+)$/, async (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const panelId = Number(ctx.match[1]);
  const panel = db.prepare('SELECT * FROM panels WHERE id = ?').get(panelId);
  if (!panel) return safeEdit(ctx, '❌ پنل یافت نشد.');
  adminState[ADMIN_ID] = { action: 'edit_panel_desc', panelId };
  ctx.reply(`📝 توضیحات فعلی: ${panel.description || '---'}\n\nتوضیحات جدید را وارد کنید:\n(یا "رد کردن" برای حذف توضیحات)`, Markup.inlineKeyboard([[b('لغو', `admin_panel_detail_${panelId}`, 'back')]]));
});

bot.action(/^admin_toggle_panel_(\d+)$/, async (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const panelId = Number(ctx.match[1]);
  const panel = db.prepare('SELECT * FROM panels WHERE id = ?').get(panelId);
  if (!panel) return safeEdit(ctx, '❌ پنل یافت نشد.');

  const newStatus = panel.active ? 0 : 1;
  db.prepare('UPDATE panels SET active = ? WHERE id = ?').run(newStatus, panelId);
  const statusText = newStatus ? 'فعال' : 'غیرفعال';
  ctx.reply(`✅ پنل ${panel.display_name} ${statusText} شد.`);
  // Re-show list
  const panels = getAllPanels();
  let text = '🖥 مدیریت پنل‌ها\n\n';
  panels.forEach((p) => {
    const status = p.active ? '✅ فعال' : '❌ غیرفعال';
    const planCount = db.prepare("SELECT COUNT(*) as c FROM plans WHERE panel = ? AND active = 1").get(p.name).c;
    text += `#${p.id} | ${p.display_name} (${p.name}) | ${status} | ${planCount} پلن\n`;
    if (p.description) text += `   ${p.description}\n`;
  });
  const buttons = [[Markup.button.callback('➕ افزودن پنل جدید', 'admin_add_panel')]];
  panels.forEach((p) => {
    buttons.push([
      Markup.button.callback(`🔍 جزئیات #${p.id}`, `admin_panel_detail_${p.id}`),
      Markup.button.callback(`${p.active ? '❌ غیرفعال' : '✅ فعال'} #${p.id}`, `admin_toggle_panel_${p.id}`),
      Markup.button.callback('🗑️ حذف', `admin_delete_panel_${p.id}`),
    ]);
  });
  buttons.push([b('بازگشت ◀️', 'back_to_menu', 'back')]);
  safeEdit(ctx, text, Markup.inlineKeyboard(buttons));
});

bot.action(/^admin_delete_panel_(\d+)$/, async (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const panelId = Number(ctx.match[1]);
  const panel = db.prepare('SELECT * FROM panels WHERE id = ?').get(panelId);
  if (!panel) return safeEdit(ctx, '❌ پنل یافت نشد.');

  const planCount = db.prepare("SELECT COUNT(*) as c FROM plans WHERE panel = ?").get(panelId).c;
  if (planCount > 0) {
    return safeEdit(ctx, `❌ این پنل دارای ${planCount} پلن است. ابتدا پلن‌ها را حذف یا غیرفعال کنید.`, Markup.inlineKeyboard([
      [b('بازگشت ◀️', 'admin_panels', 'back')],
    ]));
  }

  db.prepare('DELETE FROM panels WHERE id = ?').run(panelId);
  ctx.reply(`🗑️ پنل ${panel.display_name} حذف شد.`);
  // Re-show list
  const panels = getAllPanels();
  let text = '🖥 مدیریت پنل‌ها\n\n';
  if (panels.length === 0) {
    text += 'هیچ پنلی وجود ندارد.';
  } else {
    panels.forEach((p) => {
      const status = p.active ? '✅ فعال' : '❌ غیرفعال';
      const planCount2 = db.prepare("SELECT COUNT(*) as c FROM plans WHERE panel = ? AND active = 1").get(p.name).c;
      text += `#${p.id} | ${p.display_name} (${p.name}) | ${status} | ${planCount2} پلن\n`;
      if (p.description) text += `   ${p.description}\n`;
    });
  }
  const buttons = [[Markup.button.callback('➕ افزودن پنل جدید', 'admin_add_panel')]];
  panels.forEach((p) => {
    buttons.push([
      Markup.button.callback(`🔍 جزئیات #${p.id}`, `admin_panel_detail_${p.id}`),
      Markup.button.callback(`${p.active ? '❌ غیرفعال' : '✅ فعال'} #${p.id}`, `admin_toggle_panel_${p.id}`),
      Markup.button.callback('🗑️ حذف', `admin_delete_panel_${p.id}`),
    ]);
  });
  buttons.push([b('بازگشت ◀️', 'back_to_menu', 'back')]);
  safeEdit(ctx, text, Markup.inlineKeyboard(buttons));
});

bot.action('admin_plans', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const panels = getActivePanels();
  const buttons = panels.map(p => [Markup.button.callback(`🔹 ${p.display_name}`, `admin_plans_${p.name}`)]);
  buttons.push([Markup.button.callback('➕ افزودن پلن جدید', 'admin_plan_add')]);
  buttons.push([b('بازگشت ◀️', 'back_to_menu', 'back')]);
  safeEdit(ctx, '📦 مدیریت پلن‌ها\n\nپنل مورد نظر را انتخاب کنید:', Markup.inlineKeyboard(buttons));
});

bot.action(/^admin_plans_([\w]+)_(\d+)$/, (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const panel = ctx.match[1];
  const validity = Number(ctx.match[2]);
  const panelData = getPanelByName(panel);
  const panelText = panelData ? panelData.display_name : panel;
  const monthText = validity === 31 ? '۱ ماهه' : '۲ ماهه';

  const plans = db.prepare('SELECT * FROM plans WHERE active = 1 AND panel = ? AND validity = ? ORDER BY price ASC').all(panel, validity);

  let text = `📦 *پنل ${panelText} | ${monthText}*\n\n`;
  if (plans.length === 0) {
    text += 'هیچ پلنی وجود ندارد.';
  } else {
    plans.forEach((p) => {
      text += `▫️ *${escapeMarkdown(p.name)}* | ${p.gb}GB | ${formatNumber(p.price)} تومان\n`;
    });
  }

  const buttons = [];
  buttons.push([Markup.button.callback('➕ افزودن پلن جدید', `admin_plan_add_${panel}_${validity}`)]);

  plans.forEach((p) => {
    buttons.push([
      Markup.button.callback(`✏️ ${p.name}`, `admin_plan_edit_${p.id}`),
      Markup.button.callback(`🗑️`, `admin_plan_delete_${p.id}`),
    ]);
  });

  const backAction = `admin_plans_${panel}`;
  buttons.push([b('بازگشت ◀️', backAction, 'back')]);

  safeEdit(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^admin_plans_([\w]+)$/, (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const panel = ctx.match[1];
  const panelData = getPanelByName(panel);
  if (!panelData) return safeEdit(ctx, '❌ پنل یافت نشد.', adminMenu());

  // Show all plans directly (no duration selection)
  const plans = db.prepare('SELECT * FROM plans WHERE active = 1 AND panel = ? ORDER BY validity ASC, price ASC').all(panel);
  let text = `🔹 *${panelData.display_name}*\n\n${panelData.description || ''}\n\n`;
  if (plans.length === 0) {
    text += 'هیچ پلنی وجود ندارد.';
  } else {
    plans.forEach((p) => {
      text += `▫️ *${escapeMarkdown(p.name)}* | ${p.gb}GB | ${p.validity} روز | ${formatNumber(p.price)} تومان\n`;
    });
  }

  const buttons = [];
  buttons.push([Markup.button.callback('➕ افزودن پلن جدید', `admin_plan_add_${panel}`)]);
  plans.forEach((p) => {
    buttons.push([
      Markup.button.callback(`✏️ ${p.name}`, `admin_plan_edit_${p.id}`),
      Markup.button.callback(`🗑️`, `admin_plan_delete_${p.id}`),
    ]);
  });
  buttons.push([b('بازگشت ◀️', 'admin_plans', 'back')]);

  safeEdit(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^admin_plan_add_(pasarguard|economic|[\w]+)$/, (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const panel = ctx.match[1];
  adminState[ADMIN_ID] = { action: 'add_plan_name_gb', panel };
  safeEdit(ctx, '📦 نام و حجم پلن را وارد کنید:\n(مثال: 20GB)', Markup.inlineKeyboard([[b('لغو', `admin_plans_${panel}`, 'back')]]));
});

bot.action('admin_plan_add', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const panels = getActivePanels();
  const buttons = panels.map(p => [Markup.button.callback(`🔹 ${p.display_name}`, `admin_plan_add_${p.name}`)]);
  buttons.push([b('لغو', 'admin_plans', 'back')]);
  safeEdit(ctx, '📦 پنل مورد نظر را انتخاب کنید:', Markup.inlineKeyboard(buttons));
});

bot.action(/^admin_plan_duration_(\d+)$/, (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const validity = Number(ctx.match[1]);
  const state = adminState[ADMIN_ID];
  if (!state || state.action !== 'add_plan_duration') return;
  adminState[ADMIN_ID] = { action: 'add_plan_name_gb', panel: state.panel, validity };
  safeEdit(ctx, '📦 نام و حجم پلن را وارد کنید:\n(مثال: 20GB)', Markup.inlineKeyboard([[b('لغو', 'admin_plans', 'back')]]));
});

bot.action(/^admin_plan_edit_(\d+)$/, (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const planId = Number(ctx.match[1]);
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(planId);
  if (!plan) return safeEdit(ctx, '❌ پلن یافت نشد.', adminMenu());

  const text =
    `✏️ *ویرایش پلن*\n\n` +
    `🔹 نام: ${escapeMarkdown(plan.name)}\n` +
    `🔹 حجم: ${plan.gb} GB\n` +
    `🔹 مدت: ${plan.validity} روز\n` +
    `🔹 قیمت: ${formatNumber(plan.price)} تومان\n\n` +
    `کدام مورد را می‌خواهید تغییر دهید؟`;

  const buttons = [
    [Markup.button.callback('📝 نام', `admin_plan_set_name_${planId}`)],
    [Markup.button.callback('💾 حجم (GB)', `admin_plan_set_gb_${planId}`)],
    [Markup.button.callback('📅 مدت (روز)', `admin_plan_set_validity_${planId}`)],
    [Markup.button.callback('💰 قیمت (تومان)', `admin_plan_set_price_${planId}`)],
    [Markup.button.callback('🗑️ حذف پلن', `admin_plan_delete_${planId}`)],
    [b('بازگشت ◀️', 'admin_plans', 'back')],
  ];

  safeEdit(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action(/^admin_plan_set_name_(\d+)$/, (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const planId = Number(ctx.match[1]);
  adminState[ADMIN_ID] = { action: 'edit_plan_name', planId };
  ctx.reply('📝 نام جدید پلن را وارد کنید:');
});

bot.action(/^admin_plan_set_gb_(\d+)$/, (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const planId = Number(ctx.match[1]);
  adminState[ADMIN_ID] = { action: 'edit_plan_gb', planId };
  ctx.reply('💾 حجم جدید (GB) را وارد کنید:');
});

bot.action(/^admin_plan_set_validity_(\d+)$/, (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const planId = Number(ctx.match[1]);
  adminState[ADMIN_ID] = { action: 'edit_plan_validity', planId };
  ctx.reply('📅 مدت اعتبار جدید (روز) را وارد کنید:');
});

bot.action(/^admin_plan_set_price_(\d+)$/, (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const planId = Number(ctx.match[1]);
  adminState[ADMIN_ID] = { action: 'edit_plan_price', planId };
  ctx.reply('💰 قیمت جدید (تومان) را وارد کنید:');
});

bot.action(/^admin_plan_delete_(\d+)$/, (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const planId = Number(ctx.match[1]);
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(planId);
  if (!plan) return safeEdit(ctx, '❌ پلن یافت نشد.');

  db.prepare('DELETE FROM plans WHERE id = ?').run(planId);
  ctx.reply(`🗑️ پلن ${plan.name} حذف شد.`);
  showPlanList(ctx, plan.panel);
});

bot.action(/^admin_plan_toggle_(\d+)$/, (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const planId = Number(ctx.match[1]);
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(planId);
  if (!plan) return safeEdit(ctx, '❌ پلن یافت نشد.');

  const newStatus = plan.active ? 0 : 1;
  db.prepare('UPDATE plans SET active = ? WHERE id = ?').run(newStatus, planId);
  const statusText = newStatus ? 'فعال' : 'غیرفعال';
  ctx.reply(`✅ پلن ${plan.name} ${statusText} شد.`);
  showPlanList(ctx, plan.panel);
});

bot.action('admin_free_trials', async (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const trials = db.prepare('SELECT ft.*, u.username FROM free_trials ft LEFT JOIN users u ON ft.claimed_by = u.user_id ORDER BY ft.created_at DESC').all();

  let text = '🎁 مدیریت تست رایگان\n\n';
  if (trials.length === 0) {
    text += 'هیچ تست رایگانی وجود ندارد.';
  } else {
    trials.forEach((t) => {
      const status = t.claimed_by ? `📨 @${t.username || t.claimed_by}` : (t.active ? '✅ موجود' : '❌ غیرفعال');
      text += `#${t.id} | ${status}\n   🔗 \`${t.sub_link.substring(0, 35)}${t.sub_link.length > 35 ? '...' : ''}\`\n`;
    });
  }

  const buttons = [
    [Markup.button.callback('➕ افزودن تست جدید', 'admin_add_trial')],
  ];

  if (trials.length > 0) {
    trials.forEach((t) => {
      buttons.push([
        Markup.button.callback(`🔍 جزئیات #${t.id}`, `admin_trial_detail_${t.id}`),
        Markup.button.callback('🗑️ حذف', `admin_delete_trial_${t.id}`),
      ]);
    });
  }

  buttons.push([b('بازگشت ◀️', 'back_to_menu', 'back')]);
  try {
    await ctx.editMessageText(text, Markup.inlineKeyboard(buttons));
  } catch (_) {
    await ctx.reply(text, Markup.inlineKeyboard(buttons));
  }
});

bot.action('admin_add_trial', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  adminState[ADMIN_ID] = { action: 'add_trial_qr' };
  safeEdit(ctx,
    '🎁 *افزودن تست رایگان*\n\n' +
    'مرحله ۱: تصویر QR کد را ارسال کنید.\n' +
    '(اگر نمی‌خواهید QR بفرستید، متن "رد کردن" را ارسال کنید)',
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[b('لغو', 'admin_free_trials', 'back')]]) }
  );
});

bot.action(/^admin_toggle_trial_(\d+)$/, (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const trialId = Number(ctx.match[1]);
  const trial = db.prepare('SELECT * FROM free_trials WHERE id = ?').get(trialId);
  if (!trial) return safeEdit(ctx, '❌ تست یافت نشد.');

  const newStatus = trial.active ? 0 : 1;
  db.prepare('UPDATE free_trials SET active = ? WHERE id = ?').run(newStatus, trialId);
  const statusText = newStatus ? 'فعال' : 'غیرفعال';
  ctx.reply(`✅ تست #${trialId} ${statusText} شد.`);
  // Re-show the list
  const trials = db.prepare('SELECT ft.*, u.username FROM free_trials ft LEFT JOIN users u ON ft.claimed_by = u.user_id ORDER BY ft.created_at DESC').all();
  let text = '🎁 مدیریت تست رایگان\n\n';
  if (trials.length === 0) {
    text += 'هیچ تست رایگانی وجود ندارد.';
  } else {
    trials.forEach((t) => {
      const status = t.claimed_by ? `📨 @${t.username || t.claimed_by}` : (t.active ? '✅ موجود' : '❌ غیرفعال');
      text += `#${t.id} | ${status}\n   🔗 \`${t.sub_link.substring(0, 35)}${t.sub_link.length > 35 ? '...' : ''}\`\n`;
    });
  }
  const buttons = [[Markup.button.callback('➕ افزودن تست جدید', 'admin_add_trial')]];
  trials.forEach((t) => {
    buttons.push([
      Markup.button.callback('🗑️ حذف', `admin_delete_trial_${t.id}`),
    ]);
  });
  buttons.push([b('بازگشت ◀️', 'back_to_menu', 'back')]);
  safeEdit(ctx, text, Markup.inlineKeyboard(buttons));
});

bot.action(/^admin_delete_trial_(\d+)$/, (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const trialId = Number(ctx.match[1]);
  const trial = db.prepare('SELECT * FROM free_trials WHERE id = ?').get(trialId);
  if (!trial) return safeEdit(ctx, '❌ تست یافت نشد.');

  db.prepare('DELETE FROM free_trials WHERE id = ?').run(trialId);
  ctx.reply(`🗑️ تست #${trialId} حذف شد.`);
  // Re-show the list
  const trials = db.prepare('SELECT ft.*, u.username FROM free_trials ft LEFT JOIN users u ON ft.claimed_by = u.user_id ORDER BY ft.created_at DESC').all();
  let text = '🎁 مدیریت تست رایگان\n\n';
  if (trials.length === 0) {
    text += 'هیچ تست رایگانی وجود ندارد.';
  } else {
    trials.forEach((t) => {
      const status = t.claimed_by ? `📨 @${t.username || t.claimed_by}` : (t.active ? '✅ موجود' : '❌ غیرفعال');
      text += `#${t.id} | ${status}\n   🔗 \`${t.sub_link.substring(0, 35)}${t.sub_link.length > 35 ? '...' : ''}\`\n`;
    });
  }
  const buttons = [[Markup.button.callback('➕ افزودن تست جدید', 'admin_add_trial')]];
  trials.forEach((t) => {
    buttons.push([
      Markup.button.callback('🗑️ حذف', `admin_delete_trial_${t.id}`),
    ]);
  });
  buttons.push([b('بازگشت ◀️', 'back_to_menu', 'back')]);
  safeEdit(ctx, text, Markup.inlineKeyboard(buttons));
});

bot.action(/^admin_trial_detail_(\d+)$/, async (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const trialId = Number(ctx.match[1]);
  const trial = db.prepare('SELECT ft.*, u.username, u.first_name FROM free_trials ft LEFT JOIN users u ON ft.claimed_by = u.user_id WHERE ft.id = ?').get(trialId);
  if (!trial) return safeEdit(ctx, '❌ تست یافت نشد.');

  const status = trial.claimed_by ? `📨 ارسال شده` : (trial.active ? '✅ موجود' : '❌ غیرفعال');
  const claimedBy = trial.claimed_by ? `@${trial.username || 'ندارد'} (${trial.claimed_by})\n   نام: ${trial.first_name || 'ندارد'}` : '---';
  const hasQR = trial.qr_file_id ? '✅ دارد' : '❌ ندارد';

  let text = '🔍 جزئیات تست رایگان\n\n';
  text += `شناسه: #${trial.id}\n`;
  text += `وضعیت: ${status}\n`;
  text += `تاریخ ایجاد: ${trial.created_at}\n`;
  text += ` QR: ${hasQR}\n`;
  text += `ارسال شده به: ${claimedBy}\n\n`;
  text += `لینک اشتراک:\n${trial.sub_link}`;

  const buttons = [
    [Markup.button.callback('🗑️ حذف', `admin_delete_trial_${trial.id}`)],
    [b('بازگشت ◀️', 'admin_free_trials', 'back')],
  ];

  if (trial.qr_file_id && trial.claimed_by) {
    buttons.unshift([Markup.button.callback('📤 ارسال مجدد QR', `admin_resend_trial_${trial.id}`)]);
  }

  try {
    await ctx.editMessageText(text, Markup.inlineKeyboard(buttons));
  } catch (_) {
    await ctx.reply(text, Markup.inlineKeyboard(buttons));
  }
});

bot.action(/^admin_resend_trial_(\d+)$/, async (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  const trialId = Number(ctx.match[1]);
  const trial = db.prepare('SELECT * FROM free_trials WHERE id = ?').get(trialId);
  if (!trial || !trial.claimed_by || !trial.qr_file_id) return safeEdit(ctx, '❌ اطلاعات کافی وجود ندارد.');

  try {
    await bot.telegram.sendPhoto(trial.claimed_by, trial.qr_file_id, {
      caption: `🔄 QR کد تست رایگان شما مجدداً ارسال شد.\n\n🔗 لینک اشتراک:\n${trial.sub_link}`,
    });
    ctx.reply(`✅ QR کد مجدداً برای کاربر ${trial.claimed_by} ارسال شد.`);
  } catch (err) {
    ctx.reply(`❌ خطا در ارسال: ${err.message}`);
  }
});

function adminBotSettingsText() {
  const maskedPass = PANEL_PASSWORD ? '••••••••' : '---';
  const welcomeImgStatus = welcomeImage ? '✅ تنظیم شده' : '❌ تنظیم نشده';
  return `⚙️ *تنظیمات ربات*\n━━━━━━━━━━━━━━━━━━\n\n` +
    `💰 *مالی*\n` +
    `   📌 پاداش دعوت: ${formatNumber(referralReward)} تومان\n` +
    `   💳 شماره کارت: ${CARD_NUMBER || '---'}\n` +
    `   👤 نام صاحب کارت: ${CARD_OWNER || '---'}\n` +
    `   💰 حداقل شارژ: ${formatNumber(minCharge)} تومان\n` +
    `   💰 حداکثر شارژ: ${formatNumber(maxCharge)} تومان\n\n` +
    `🌐 *تنظیمات API پنل VPN*\n` +
    `   🔗 آدرس پنل: \`${PANEL_URL}\`\n` +
    `   👤 یوزرنیم: \`${PANEL_USERNAME}\`\n` +
    `   🔒 پسورد: \`${maskedPass}\`\n\n` +
    `📝 *پیام‌ها*\n` +
    `   👋 پیام خوش‌آمدگویی (${welcomeMessage.length} کاراکتر)\n` +
    `   🖼 تصویر خوش‌آمدگویی: ${welcomeImgStatus}\n` +
    `   📢 پیام عضویت اجباری (${channelMessage.length} کاراکتر)\n\n` +
    `🔗 *کانال و پشتیبانی*\n` +
    `   📢 نام کانال: @${CHANNEL_USERNAME}\n` +
    `   👤 پشتیبانی: @${ADMIN_USERNAME}\n\n` +
    `━━━━━━━━━━━━━━━━━━`;
}

function adminBotSettingsKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📌 پاداش دعوت', 'admin_edit_referral')],
    [Markup.button.callback('💳 شماره کارت', 'admin_edit_card_number'), Markup.button.callback('👤 نام صاحب کارت', 'admin_edit_card_owner')],
    [Markup.button.callback('💰 حداقل شارژ', 'admin_edit_min_charge'), Markup.button.callback('💰 حداکثر شارژ', 'admin_edit_max_charge')],
    [Markup.button.callback('👋 پیام خوش‌آمدگویی', 'admin_edit_welcome')],
    [Markup.button.callback('🖼 تصویر خوش‌آمدگویی', 'admin_edit_welcome_image')],
    [Markup.button.callback('📢 پیام عضویت', 'admin_edit_channel_msg')],
    [Markup.button.callback('📢 نام کانال', 'admin_edit_channel_name')],
    [Markup.button.callback('👤 پشتیبانی', 'admin_edit_support_username')],
    [b('بازگشت ◀️', 'back_to_menu', 'back')],
  ]);
}

bot.action('admin_bot_settings', async (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  try {
    await ctx.editMessageText(adminBotSettingsText(), { parse_mode: 'Markdown', ...adminBotSettingsKeyboard() });
  } catch (err) {
    console.error('admin_bot_settings error:', err.message);
    try {
      await ctx.editMessageText(adminBotSettingsText().replace(/[*_`]/g, ''), { ...adminBotSettingsKeyboard() });
    } catch (err2) {
      console.error('admin_bot_settings retry error:', err2.message);
      await ctx.reply('❌ خطا در باز کردن تنظیمات: ' + err2.message);
    }
  }
});

bot.action('admin_edit_referral', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  adminState[ADMIN_ID] = { action: 'edit_setting_referral' };
  safeEdit(ctx, `📌 پاداش دعوت فعلی: *${formatNumber(referralReward)}* تومان\n\nمبلغ جدید را ارسال کنید:`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[b('لغو', 'admin_bot_settings', 'back')]]),
  });
});

bot.action('admin_edit_card_number', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  adminState[ADMIN_ID] = { action: 'edit_setting_card_number' };
  safeEdit(ctx, `💳 شماره کارت فعلی: \`${CARD_NUMBER || '---'}\`\n\nشماره کارت جدید را ارسال کنید:`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[b('لغو', 'admin_bot_settings', 'back')]]),
  });
});

bot.action('admin_edit_card_owner', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  adminState[ADMIN_ID] = { action: 'edit_setting_card_owner' };
  safeEdit(ctx, `👤 نام صاحب کارت فعلی: ${CARD_OWNER || '---'}\n\nنام جدید را ارسال کنید:`, {
    ...Markup.inlineKeyboard([[b('لغو', 'admin_bot_settings', 'back')]]),
  });
});

bot.action('admin_edit_min_charge', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  adminState[ADMIN_ID] = { action: 'edit_setting_min_charge' };
  safeEdit(ctx, `💰 حداقل شارژ فعلی: *${formatNumber(minCharge)}* تومان\n\nمبلغ جدید را ارسال کنید:`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[b('لغو', 'admin_bot_settings', 'back')]]),
  });
});

bot.action('admin_edit_max_charge', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  adminState[ADMIN_ID] = { action: 'edit_setting_max_charge' };
  safeEdit(ctx, `💰 حداکثر شارژ فعلی: *${formatNumber(maxCharge)}* تومان\n\nمبلغ جدید را ارسال کنید:`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[b('لغو', 'admin_bot_settings', 'back')]]),
  });
});

bot.action('admin_edit_welcome', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  adminState[ADMIN_ID] = { action: 'edit_setting_welcome' };
  safeEdit(ctx, `👋 *پیام خوش‌آمدگویی فعلی:*\n\n${welcomeMessage}\n\n📝 متن جدید را ارسال کنید:`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[b('لغو', 'admin_bot_settings', 'back')]]),
  });
});

bot.action('admin_edit_channel_msg', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  adminState[ADMIN_ID] = { action: 'edit_setting_channel_msg' };
  safeEdit(ctx, `📢 *پیام عضویت اجباری فعلی:*\n\n${channelMessage.replace('{CHANNEL}', CHANNEL_USERNAME)}\n\n📝 متن جدید را ارسال کنید:\n(از @{CHANNEL} برای نام کانال استفاده کنید)`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[b('لغو', 'admin_bot_settings', 'back')]]),
  });
});

bot.action('admin_edit_channel_name', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  adminState[ADMIN_ID] = { action: 'edit_setting_channel_name' };
  safeEdit(ctx, `📢 نام کانال فعلی: @${CHANNEL_USERNAME}\n\nنام کانال جدید را ارسال کنید: (بدون @)`, {
    ...Markup.inlineKeyboard([[b('لغو', 'admin_bot_settings', 'back')]]),
  });
});

bot.action('admin_edit_support_username', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  adminState[ADMIN_ID] = { action: 'edit_setting_support' };
  safeEdit(ctx, `👤 نام کاربری پشتیبانی فعلی: @${ADMIN_USERNAME}\n\nنام کاربری جدید را ارسال کنید: (بدون @)`, {
    ...Markup.inlineKeyboard([[b('لغو', 'admin_bot_settings', 'back')]]),
  });
});

bot.action('admin_edit_welcome_image', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  adminState[ADMIN_ID] = { action: 'edit_setting_welcome_image' };
  const currentStatus = welcomeImage ? '✅ تصویر فعلی تنظیم شده' : '❌ تنظیم نشده';
  safeEdit(ctx, `🖼 *تصویر خوش‌آمدگویی*\n\n${currentStatus}\n\n📸 یک تصویر ارسال کنید:\n(یا "حذف" برای غیرفعال کردن)`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[b('لغو', 'admin_bot_settings', 'back')]]),
  });
});

bot.action('admin_edit_panel_url', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  adminState[ADMIN_ID] = { action: 'edit_setting_panel_url' };
  safeEdit(ctx, `🔗 *آدرس فعلی پنل:*\n\`${PANEL_URL}\`\n\n📝 آدرس جدید را ارسال کنید:\n(مثال: https://panel.example.com)`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[b('لغو', 'admin_bot_settings', 'back')]]),
  });
});

bot.action('admin_edit_panel_username', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  adminState[ADMIN_ID] = { action: 'edit_setting_panel_username' };
  safeEdit(ctx, `👤 یوزرنیم فعلی پنل:\n\`${PANEL_USERNAME}\`\n\n📝 یوزرنیم جدید را ارسال کنید:`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[b('لغو', 'admin_bot_settings', 'back')]]),
  });
});

bot.action('admin_edit_panel_password', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  adminState[ADMIN_ID] = { action: 'edit_setting_panel_password' };
  const maskedPass = PANEL_PASSWORD ? '••••••••' : '---';
  safeEdit(ctx, `🔒 پسورد فعلی پنل: ${maskedPass}\n\n📝 پسورد جدید را ارسال کنید:`, {
    ...Markup.inlineKeyboard([[b('لغو', 'admin_bot_settings', 'back')]]),
  });
});

bot.action('admin_backup', async (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;

  const fs = require('fs');
  const path = require('path');

  const dbPath = process.env.DB_PATH || '/data/bot.db';

  if (!fs.existsSync(dbPath)) {
    return ctx.reply('❌ فایل دیتابیس پیدا نشد');
  }

  const stats = fs.statSync(dbPath);
  const fileSizeKB = (stats.size / 1024).toFixed(2);
  const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

  // Send database file directly
  await ctx.replyWithDocument({
    source: dbPath,
    filename: 'bot.db'
  }, {
    caption: `✅ بکاپ دیتابیس\n\n📅 ${new Date().toLocaleString('fa-IR')}\n📁 فایل: bot.db\n📦 حجم: ${fileSizeKB} KB (${fileSizeMB} MB)\n\nبرای ریستور: این فایل رو به /data/bot.db کپی کنید`
  });
});

bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}:`, err.message);
  console.error(err.stack);
});

// Show ☰ menu button on left of input bar for all users
bot.telegram.setChatMenuButton({ menu_button: { type: 'commands' } }).catch(() => {});

bot.launch();
console.log('🤖 Bot is running...');

async function adminQuickPanel(ctx) {
  const text = `🔄 <b>تغییر پنل VPN</b>

🔗 <b>آدرس فعلی:</b> ${PANEL_URL}
👤 <b>یوزرنیم:</b> ${PANEL_USERNAME}
🔑 <b>رمز:</b> ${"*".repeat(PANEL_PASSWORD.length)}

📝 کدام را می‌خواهید تغییر دهید?`;
  await safeEdit(ctx, text, {
    parse_mode: 'html',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🔗 تغییر آدرس پنل', 'admin_quick_url')],
      [Markup.button.callback('👤 تغییر یوزرنیم', 'admin_quick_user')],
      [Markup.button.callback('🔑 تغییر رمز عبور', 'admin_quick_pass')],
      [Markup.button.callback('🧪 تست اتصال', 'admin_quick_test')],
      [b('◀️ بازگشت', 'back_to_menu', 'back')],
    ]),
  });
}

// Quick panel change handler
bot.action('admin_quick_panel', async (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;

  const text = `🔄 <b>تغییر پنل VPN</b>\n\n` +
    `🔗 <b>آدرس فعلی:</b> ${PANEL_URL}\n` +
    `👤 <b>یوزرنیم:</b> ${PANEL_USERNAME}\n` +
    `🔑 <b>رمز:</b> ${'*'.repeat(PANEL_PASSWORD.length)}\n\n` +
    `📝 کدام را می‌خواهید تغییر دهید؟`;

  await safeEdit(ctx, text, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🔗 تغییر آدرس پنل', 'admin_quick_url')],
      [Markup.button.callback('👤 تغییر یوزرنیم', 'admin_quick_user')],
      [Markup.button.callback('🔑 تغییر رمز', 'admin_quick_pass')],
      [Markup.button.callback('🧪 تست اتصال', 'admin_quick_test')],
      [b('◀️ بازگشت', 'back_to_menu', 'back')],
    ]),
  });
});
bot.action('admin_quick_url', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  adminState[ADMIN_ID] = { action: 'edit_setting_panel_url', from: 'admin_quick_panel' };
  safeEdit(ctx, `🔗 آدرس فعلی: <code>${PANEL_URL}</code>\n\n📝 آدرس جدید را ارسال کنید:`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([[b('لغو', 'admin_quick_panel', 'back')]]),
  });
});

bot.action('admin_quick_user', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  adminState[ADMIN_ID] = { action: 'edit_setting_panel_username', from: 'admin_quick_panel' };
  safeEdit(ctx, `👤 یوزرنیم فعلی: <code>${PANEL_USERNAME}</code>\n\n📝 یوزرنیم جدید را ارسال کنید:`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([[b('لغو', 'admin_quick_panel', 'back')]]),
  });
});

bot.action('admin_quick_pass', (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  adminState[ADMIN_ID] = { action: 'edit_setting_panel_password', from: 'admin_quick_panel' };
  safeEdit(ctx, `🔑 رمز فعلی: <code>${'*'.repeat(8)}</code>\n\n📝 رمز جدید را ارسال کنید:`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([[b('لغو', 'admin_quick_panel', 'back')]]),
  });
});

bot.action('admin_quick_test', async (ctx) => {
  safeAnswer(ctx);
  if (ctx.from.id !== ADMIN_ID) return;
  try {
    await ctx.editMessageText('🧪 در حال تست اتصال پنل...');

    // Clear cache and test fresh connection
    panelToken = null;
    panelTokenExpiry = 0;
    detectedApiPath = null;

    const token = await getPanelToken();
    const users = await panelApi('GET', '/user?limit=1');
    const userCount = users.total || (Array.isArray(users) ? users.length : '?');

    await ctx.reply(`✅ اتصال برقرار!\n\n🔗 ${PANEL_URL}\n👤 ${PANEL_USERNAME}\n📡 مسیر API: ${detectedApiPath}\n👥 کاربران: ${userCount}`);
  } catch (err) {
    await ctx.reply(`❌ خطا در اتصال:\n\n🔗 ${PANEL_URL}\n👤 ${PANEL_USERNAME}\n\nخطا: ${err.message}`);
  }
  adminQuickPanel(ctx);
});

