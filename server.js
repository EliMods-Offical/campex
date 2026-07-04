const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DB_PATH = path.join(ROOT, "data", "db.json");
const USE_POSTGRES = Boolean(process.env.DATABASE_URL);

const OFFICIAL_USER_ID = "usr_campex_team";
const OWNER_USER_ID = "usr_owner";
let pgPool = null;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const check = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(check, "hex"));
}

function defaultDb() {
  const createdAt = now();
  const serverId = "srv_campex";
  const generalId = "chn_general";
  const updatesId = "chn_updates";
  const ownerPassword = hashPassword("campexowner");
  const demoPassword = hashPassword("campex123");
  return {
    users: [
      {
        id: OWNER_USER_ID,
        name: "Campex Owner",
        username: "Owner#0001",
        email: "owner@campex.local",
        provider: "email",
        passwordHash: ownerPassword,
        isOwner: true,
        isOfficial: false,
        badges: ["early_access", "owner"],
        createdAt
      },
      {
        id: OFFICIAL_USER_ID,
        name: "Campex Team",
        username: "Campex Team#Offical",
        email: "team@campex.local",
        provider: "official",
        passwordHash: null,
        isOwner: false,
        isOfficial: true,
        badges: ["early_access", "official"],
        bio: "This is the offical Campex account. The Campex team will never ask for passwords or personal information.",
        createdAt
      },
      {
        id: "usr_demo",
        name: "Early Camper",
        username: "EarlyCamper#1024",
        email: "camper@campex.local",
        provider: "email",
        passwordHash: demoPassword,
        isOwner: false,
        isOfficial: false,
        badges: ["early_access"],
        createdAt
      }
    ],
    sessions: {},
    activeOfficialSessions: {},
    buddies: [],
    servers: [
      {
        id: serverId,
        name: "Campex HQ",
        icon: "HQ",
        color: "#2f7d5c",
        ownerId: OWNER_USER_ID,
        createdAt,
        memberIds: [OWNER_USER_ID, OFFICIAL_USER_ID, "usr_demo"],
        roles: [
          { id: "role_everyone", name: "Everyone", color: "#9ba1aa", memberIds: [OWNER_USER_ID, OFFICIAL_USER_ID, "usr_demo"] },
          { id: "role_staff", name: "Campex Staff", color: "#58c08a", memberIds: [OWNER_USER_ID, OFFICIAL_USER_ID] }
        ]
      }
    ],
    channels: [
      { id: generalId, serverId, name: "general", topic: "Welcome to the full release of Campex.", createdAt },
      { id: updatesId, serverId, name: "announcements", topic: "Official Campex notices live here.", createdAt }
    ],
    messages: [
      {
        id: id("msg"),
        channelId: generalId,
        userId: OFFICIAL_USER_ID,
        text: "Campex is now in FULL RELEASE. Be kind, create servers, add buddies, and never share your password.",
        createdAt
      }
    ],
    directMessages: [],
    warnings: []
  };
}

function normalizeDb(db) {
  let changed = false;
  if (!db.users?.some((user) => user.id === OWNER_USER_ID) || !db.users?.some((user) => user.id === OFFICIAL_USER_ID)) {
    return { db: defaultDb(), changed: true };
  }
  db.users.forEach((user) => {
    if (!Array.isArray(user.badges)) {
      user.badges = ["early_access"];
      changed = true;
    }
    if (!user.badges.includes("early_access")) {
      user.badges.push("early_access");
      changed = true;
    }
  });
  db.buddies ||= [];
  db.directMessages ||= [];
  db.warnings ||= [];
  db.activeOfficialSessions ||= {};
  return { db, changed };
}

function ensureFileDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    writeFileDb(defaultDb());
    return;
  }
  const result = normalizeDb(readDbRaw());
  if (result.changed) writeFileDb(result.db);
}

function readDbRaw() {
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function writeFileDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

async function initDb() {
  if (!USE_POSTGRES) {
    ensureFileDb();
    return;
  }

  const { Pool } = require("pg");
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false }
  });
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS campex_state (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const existing = await pgPool.query("SELECT data FROM campex_state WHERE id = $1", ["main"]);
  if (existing.rowCount === 0) {
    await writeDb(defaultDb());
  } else {
    const result = normalizeDb(existing.rows[0].data);
    if (result.changed) await writeDb(result.db);
  }
}

async function readDb() {
  if (!USE_POSTGRES) {
    ensureFileDb();
    return readDbRaw();
  }
  const existing = await pgPool.query("SELECT data FROM campex_state WHERE id = $1", ["main"]);
  if (existing.rowCount === 0) {
    const db = defaultDb();
    await writeDb(db);
    return db;
  }
  const result = normalizeDb(existing.rows[0].data);
  if (result.changed) await writeDb(result.db);
  return result.db;
}

async function writeDb(db) {
  if (!USE_POSTGRES) {
    writeFileDb(db);
    return;
  }
  await pgPool.query(
    `INSERT INTO campex_state (id, data, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    ["main", db]
  );
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf("=");
        return [decodeURIComponent(item.slice(0, index)), decodeURIComponent(item.slice(index + 1))];
      })
  );
}

function json(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...extraHeaders });
  res.end(JSON.stringify(payload));
}

function notFound(res) {
  json(res, 404, { error: "Not found" });
}

function getBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function avatar(user) {
  return user.name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    avatar: avatar(user),
    isOwner: Boolean(user.isOwner),
    isOfficial: Boolean(user.isOfficial),
    badges: user.badges || ["early_access"],
    bio: user.bio || ""
  };
}

function effectiveUser(req, db) {
  const sessionId = parseCookies(req).campex_session;
  const session = sessionId ? db.sessions[sessionId] : null;
  if (!session) return { sessionId: null, loginUser: null, user: null };
  const loginUser = db.users.find((user) => user.id === session.userId) || null;
  if (!loginUser) return { sessionId: null, loginUser: null, user: null };
  const usingOfficial = db.activeOfficialSessions[sessionId] && loginUser.isOwner;
  const user = usingOfficial ? db.users.find((item) => item.id === OFFICIAL_USER_ID) : loginUser;
  return { sessionId, loginUser, user };
}

function requireUser(req, res, db) {
  const context = effectiveUser(req, db);
  if (!context.user) {
    json(res, 401, { error: "Please sign in first." });
    return null;
  }
  return context;
}

function setCookie(sessionId) {
  return `campex_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/`;
}

function usernameTag(name, db) {
  const base = String(name || "Camper").replace(/[^a-zA-Z0-9]/g, "").slice(0, 14) || "Camper";
  let tag;
  do {
    tag = `${base}#${Math.floor(1000 + Math.random() * 9000)}`;
  } while (db.users.some((user) => user.username.toLowerCase() === tag.toLowerCase()));
  return tag;
}

function usersById(db) {
  return Object.fromEntries(db.users.map((user) => [user.id, publicUser(user)]));
}

function addBadge(user, badge) {
  user.badges ||= ["early_access"];
  if (!user.badges.includes(badge)) user.badges.push(badge);
}

function serverPayload(db, userId) {
  const map = usersById(db);
  return db.servers
    .filter((server) => server.memberIds.includes(userId))
    .map((server) => ({
      ...server,
      members: server.memberIds.map((memberId) => map[memberId]).filter(Boolean)
    }));
}

function buddyPayload(db, userId) {
  const buddyIds = db.buddies
    .filter((buddy) => buddy.status === "accepted" && (buddy.fromId === userId || buddy.toId === userId))
    .map((buddy) => (buddy.fromId === userId ? buddy.toId : buddy.fromId));
  return buddyIds.map((id) => publicUser(db.users.find((user) => user.id === id))).filter(Boolean);
}

async function handleApi(req, res) {
  const db = await readDb();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = `${req.method} ${url.pathname}`;

  try {
    if (route === "GET /api/health") {
      return json(res, 200, { ok: true, app: "Campex", storage: USE_POSTGRES ? "postgres" : "file" });
    }

    if (route === "POST /api/auth/register") {
      const body = await getBody(req);
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (name.length < 2 || !email.includes("@") || password.length < 6) {
        return json(res, 400, { error: "Use a name, valid email, and password with at least 6 characters." });
      }
      if (db.users.some((user) => user.email === email)) return json(res, 409, { error: "That email already exists." });
      const user = {
        id: id("usr"),
        name,
        username: usernameTag(name, db),
        email,
        provider: "email",
        passwordHash: hashPassword(password),
        isOwner: false,
        isOfficial: false,
        badges: ["early_access"],
        createdAt: now()
      };
      db.users.push(user);
      const sessionId = id("ses");
      db.sessions[sessionId] = { userId: user.id, createdAt: now() };
      await writeDb(db);
      return json(res, 201, { user: publicUser(user), loginUser: publicUser(user), usingOfficial: false }, { "Set-Cookie": setCookie(sessionId) });
    }

    if (route === "POST /api/auth/login") {
      const body = await getBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const user = db.users.find((item) => item.email === email && item.provider === "email");
      if (!user || !verifyPassword(password, user.passwordHash)) return json(res, 401, { error: "Email or password is incorrect." });
      const sessionId = id("ses");
      db.sessions[sessionId] = { userId: user.id, createdAt: now() };
      await writeDb(db);
      return json(res, 200, { user: publicUser(user), loginUser: publicUser(user), usingOfficial: false }, { "Set-Cookie": setCookie(sessionId) });
    }

    if (route === "POST /api/auth/logout") {
      const sessionId = parseCookies(req).campex_session;
      delete db.sessions[sessionId];
      delete db.activeOfficialSessions[sessionId];
      await writeDb(db);
      return json(res, 200, { ok: true }, { "Set-Cookie": "campex_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" });
    }

    if (route === "GET /api/me") {
      const context = effectiveUser(req, db);
      return json(res, 200, {
        user: publicUser(context.user),
        loginUser: publicUser(context.loginUser),
        usingOfficial: Boolean(context.sessionId && db.activeOfficialSessions[context.sessionId])
      });
    }

    const context = requireUser(req, res, db);
    if (!context) return;
    const { user, loginUser, sessionId } = context;

    if (route === "GET /api/bootstrap") {
      return json(res, 200, {
        user: publicUser(user),
        loginUser: publicUser(loginUser),
        usingOfficial: Boolean(db.activeOfficialSessions[sessionId]),
        servers: serverPayload(db, user.id),
        buddies: buddyPayload(db, loginUser.id),
        users: db.users.map(publicUser),
        official: publicUser(db.users.find((item) => item.id === OFFICIAL_USER_ID)),
        warnings: db.warnings.filter((warning) => warning.toId === loginUser.id).slice(-10)
      });
    }

    if (route === "POST /api/switch-official") {
      if (!loginUser.isOwner) return json(res, 403, { error: "Only the Campex Owner can switch into the official account." });
      db.activeOfficialSessions[sessionId] = !db.activeOfficialSessions[sessionId];
      await writeDb(db);
      const next = effectiveUser(req, db);
      return json(res, 200, {
        user: publicUser(next.user),
        loginUser: publicUser(next.loginUser),
        usingOfficial: Boolean(db.activeOfficialSessions[sessionId])
      });
    }

    if (route === "GET /api/servers") {
      return json(res, 200, { servers: serverPayload(db, user.id) });
    }

    if (route === "POST /api/servers") {
      const body = await getBody(req);
      const name = String(body.name || "").trim().slice(0, 40);
      if (name.length < 2) return json(res, 400, { error: "Server name needs at least 2 characters." });
      const colors = ["#2f7d5c", "#b35035", "#5b6bc0", "#b89028", "#3e8196", "#7a568c"];
      const server = {
        id: id("srv"),
        name,
        icon: name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
        color: colors[Math.floor(Math.random() * colors.length)],
        ownerId: user.id,
        createdAt: now(),
        memberIds: [user.id],
        roles: [{ id: id("role"), name: "Everyone", color: "#9ba1aa", memberIds: [user.id] }]
      };
      const channel = { id: id("chn"), serverId: server.id, name: "general", topic: `Welcome to ${name}.`, createdAt: now() };
      db.servers.push(server);
      db.channels.push(channel);
      await writeDb(db);
      return json(res, 201, { server, channel });
    }

    if (route === "GET /api/channels") {
      const serverId = url.searchParams.get("serverId");
      const server = db.servers.find((item) => item.id === serverId && item.memberIds.includes(user.id));
      if (!server) return json(res, 404, { error: "Server not found." });
      return json(res, 200, { channels: db.channels.filter((channel) => channel.serverId === server.id) });
    }

    if (route === "POST /api/channels") {
      const body = await getBody(req);
      const server = db.servers.find((item) => item.id === body.serverId && item.memberIds.includes(user.id));
      const name = String(body.name || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 28);
      if (!server) return json(res, 404, { error: "Server not found." });
      if (name.length < 2) return json(res, 400, { error: "Channel name needs at least 2 characters." });
      const channel = { id: id("chn"), serverId: server.id, name, topic: "", createdAt: now() };
      db.channels.push(channel);
      await writeDb(db);
      return json(res, 201, { channel });
    }

    if (route === "POST /api/roles") {
      const body = await getBody(req);
      const server = db.servers.find((item) => item.id === body.serverId && item.memberIds.includes(user.id));
      const name = String(body.name || "").trim().slice(0, 28);
      if (!server) return json(res, 404, { error: "Server not found." });
      if (name.length < 2) return json(res, 400, { error: "Role name needs at least 2 characters." });
      const role = { id: id("role"), name, color: body.color || "#58c08a", memberIds: [] };
      server.roles.push(role);
      await writeDb(db);
      return json(res, 201, { role, server });
    }

    if (route === "GET /api/messages") {
      const channelId = url.searchParams.get("channelId");
      const channel = db.channels.find((item) => item.id === channelId);
      const server = channel ? db.servers.find((item) => item.id === channel.serverId && item.memberIds.includes(user.id)) : null;
      if (!channel || !server) return json(res, 404, { error: "Channel not found." });
      const map = usersById(db);
      const messages = db.messages
        .filter((message) => message.channelId === channel.id)
        .slice(-80)
        .map((message) => ({ ...message, user: map[message.userId] }));
      return json(res, 200, { messages });
    }

    if (route === "POST /api/messages") {
      const body = await getBody(req);
      const channel = db.channels.find((item) => item.id === body.channelId);
      const server = channel ? db.servers.find((item) => item.id === channel.serverId && item.memberIds.includes(user.id)) : null;
      const text = String(body.text || "").trim().slice(0, 1000);
      if (!channel || !server) return json(res, 404, { error: "Channel not found." });
      if (!text) return json(res, 400, { error: "Message cannot be empty." });
      const message = { id: id("msg"), channelId: channel.id, userId: user.id, text, createdAt: now() };
      db.messages.push(message);
      await writeDb(db);
      return json(res, 201, { message: { ...message, user: publicUser(user) } });
    }

    if (route === "POST /api/buddies") {
      const body = await getBody(req);
      const username = String(body.username || "").trim();
      const target = db.users.find((item) => item.username.toLowerCase() === username.toLowerCase());
      if (!target) return json(res, 404, { error: "No user found with that username." });
      if (target.id === loginUser.id) return json(res, 400, { error: "That is your own username." });
      const existing = db.buddies.find((buddy) =>
        [buddy.fromId, buddy.toId].includes(loginUser.id) && [buddy.fromId, buddy.toId].includes(target.id)
      );
      if (!existing) db.buddies.push({ id: id("bud"), fromId: loginUser.id, toId: target.id, status: "accepted", createdAt: now() });
      await writeDb(db);
      return json(res, 201, { buddies: buddyPayload(db, loginUser.id) });
    }

    if (route === "GET /api/direct") {
      const otherId = url.searchParams.get("userId");
      if (otherId === OFFICIAL_USER_ID || buddyPayload(db, loginUser.id).some((buddy) => buddy.id === otherId)) {
        const map = usersById(db);
        const messages = db.directMessages
          .filter((message) => [message.fromId, message.toId].includes(loginUser.id) && [message.fromId, message.toId].includes(otherId))
          .slice(-80)
          .map((message) => ({ ...message, from: map[message.fromId], to: map[message.toId] }));
        return json(res, 200, { messages });
      }
      return json(res, 403, { error: "Add that user as a buddy first." });
    }

    if (route === "POST /api/direct") {
      const body = await getBody(req);
      const toId = String(body.toId || "");
      const text = String(body.text || "").trim().slice(0, 1000);
      if (!text) return json(res, 400, { error: "Message cannot be empty." });
      if (toId === OFFICIAL_USER_ID && !text.startsWith("/")) {
        return json(res, 400, { error: "You can only message Campex Team with commands. Try /help." });
      }
      const allowed = toId === OFFICIAL_USER_ID || buddyPayload(db, loginUser.id).some((buddy) => buddy.id === toId);
      if (!allowed) return json(res, 403, { error: "Add that user as a buddy first." });
      const message = { id: id("dm"), fromId: loginUser.id, toId, text, createdAt: now() };
      db.directMessages.push(message);
      if (toId === OFFICIAL_USER_ID) {
        const replyText = text === "/help"
          ? "Commands: /help, /rules, /safety"
          : text === "/rules"
            ? "Rules: be respectful, protect your account, and report suspicious messages."
            : text === "/safety"
              ? "Safety: The Campex team will never ask for passwords or personal information."
              : "Command received. Try /help for available commands.";
        db.directMessages.push({ id: id("dm"), fromId: OFFICIAL_USER_ID, toId: loginUser.id, text: replyText, createdAt: now() });
      }
      await writeDb(db);
      return json(res, 201, { ok: true });
    }

    if (route === "POST /api/admin/grant-staff") {
      const body = await getBody(req);
      if (!loginUser.isOwner) return json(res, 403, { error: "Only the owner can grant staff." });
      const target = db.users.find((item) => item.id === body.userId);
      if (!target) return json(res, 404, { error: "User not found." });
      addBadge(target, "staff");
      for (const server of db.servers) {
        const staffRole = server.roles.find((role) => role.name === "Campex Staff");
        if (staffRole && server.memberIds.includes(target.id) && !staffRole.memberIds.includes(target.id)) staffRole.memberIds.push(target.id);
      }
      await writeDb(db);
      return json(res, 200, { user: publicUser(target), users: db.users.map(publicUser) });
    }

    if (route === "POST /api/admin/warn") {
      const body = await getBody(req);
      if (!loginUser.isOwner) return json(res, 403, { error: "Only the owner can send warnings." });
      const target = db.users.find((item) => item.id === body.userId);
      const text = String(body.text || "").trim().slice(0, 500);
      if (!target) return json(res, 404, { error: "User not found." });
      if (!text) return json(res, 400, { error: "Warning cannot be empty." });
      const warning = { id: id("warn"), toId: target.id, fromId: OFFICIAL_USER_ID, text, createdAt: now() };
      db.warnings.push(warning);
      db.directMessages.push({ id: id("dm"), fromId: OFFICIAL_USER_ID, toId: target.id, text: `Warning from Campex Team: ${text}`, createdAt: now() });
      await writeDb(db);
      return json(res, 201, { warning });
    }

    notFound(res);
  } catch (error) {
    json(res, 500, { error: error.message || "Something went wrong." });
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) return notFound(res);
  fs.readFile(filePath, (error, data) => {
    if (error) return notFound(res);
    res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

async function main() {
  await initDb();
  http
    .createServer((req, res) => {
      if (req.url.startsWith("/api/")) return handleApi(req, res);
      serveStatic(req, res);
    })
    .listen(PORT, "0.0.0.0", () => {
      const storage = USE_POSTGRES ? "PostgreSQL" : "local file storage";
      console.log(`Campex full release is running on port ${PORT} using ${storage}`);
    });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
