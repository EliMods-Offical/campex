const state = {
  user: null,
  loginUser: null,
  usingOfficial: false,
  servers: [],
  buddies: [],
  users: [],
  official: null,
  selectedServerId: null,
  selectedChannelId: null,
  selectedAdminUserId: null,
  mode: "buddies",
  refreshTimer: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function time(value) {
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function badgeHtml(user) {
  const badges = user?.badges || ["early_access"];
  return `<div class="badge-strip">
    ${badges.includes("early_access") ? `<span class="badge early" title="Early Access sign">Early Access</span>` : ""}
    ${badges.includes("staff") ? `<span class="badge staff" title="Campex Staff">Staff</span>` : ""}
    ${badges.includes("official") ? `<span class="badge official" title="Official Campex account">Official</span>` : ""}
    ${badges.includes("owner") ? `<span class="badge owner" title="Campex Owner">Crown</span>` : ""}
  </div>`;
}

function renderProfile(user) {
  $("#profileModal").innerHTML = `
    <div class="official-card">
      <div class="avatar ${user.isOfficial ? "official" : ""}">${escapeHtml(user.avatar)}</div>
      <div>
        <h3>
          ${escapeHtml(user.name)}
          ${user.isOwner ? `<span class="crown" title="Campex Owner">♛</span>` : ""}
        </h3>
        <p>${escapeHtml(user.username)}</p>
        ${user.bio ? `<p>${escapeHtml(user.bio)}</p>` : ""}
        ${badgeHtml(user)}
      </div>
    </div>
  `;
  $("#profileDialog").showModal();
}

function showAuth() {
  $("#authView").classList.remove("hidden");
  $("#appView").classList.add("hidden");
  clearInterval(state.refreshTimer);
}

function showApp() {
  $("#authView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
}

function setMode(mode) {
  state.mode = mode;
  ["buddyView", "officialView", "adminView", "chatView"].forEach((id) => $(`#${id}`).classList.add("hidden"));
  $$(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.view === mode));
  $("#homeButton").classList.toggle("active", mode !== "chat");
  $("#channelTools").classList.toggle("hidden", mode !== "chat");
  $("#homeTools").classList.toggle("hidden", mode === "chat");
  if (mode === "buddies") {
    $("#buddyView").classList.remove("hidden");
    $("#sectionLabel").textContent = "Add buddys";
    $("#sectionTitle").textContent = "Find friends by username";
  }
  if (mode === "official") {
    $("#officialView").classList.remove("hidden");
    $("#sectionLabel").textContent = "Campex Team";
    $("#sectionTitle").textContent = "Official command messages";
    loadOfficialMessages();
  }
  if (mode === "admin") {
    $("#adminView").classList.remove("hidden");
    $("#sectionLabel").textContent = "Admin panel";
    $("#sectionTitle").textContent = state.loginUser?.isOwner ? "Grant badges and send warnings" : "Owner only";
    renderAdmin();
  }
  if (mode === "chat") {
    $("#chatView").classList.remove("hidden");
    const channel = selectedChannel();
    $("#sectionLabel").textContent = channel ? `# ${channel.name}` : "Text channel";
    $("#sectionTitle").textContent = channel?.topic || "Server chat";
  }
}

async function loadBootstrap() {
  const me = await api("/api/me");
  if (!me.user) return showAuth();
  const data = await api("/api/bootstrap");
  Object.assign(state, {
    user: data.user,
    loginUser: data.loginUser,
    usingOfficial: data.usingOfficial,
    servers: data.servers,
    buddies: data.buddies,
    users: data.users,
    official: data.official
  });
  state.selectedServerId ||= state.servers[0]?.id || null;
  showApp();
  renderShell();
  await loadChannels();
  setMode(state.mode);
  clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(() => {
    if (state.mode === "chat" && state.selectedChannelId) loadMessages();
    if (state.mode === "official") loadOfficialMessages();
  }, 2500);
}

function renderShell() {
  $("#profileName").textContent = state.user.name;
  $("#profileUsername").textContent = state.usingOfficial ? "using official account" : state.user.username;
  $("#selfProfileButton").textContent = state.user.avatar;
  $("#switchOfficialButton").classList.toggle("hidden", !state.loginUser?.isOwner);
  $("#switchOfficialButton").textContent = state.usingOfficial ? "Switch back to Owner" : "Switch to Campex Team";
  renderServers();
  renderBuddies();
}

function renderServers() {
  $("#serverRail").innerHTML = state.servers.map((server) => `
    <button class="server-button ${server.id === state.selectedServerId && state.mode === "chat" ? "active" : ""}"
      data-server-id="${server.id}" style="background:${server.color}" title="${escapeHtml(server.name)}">
      ${escapeHtml(server.icon)}
    </button>
  `).join("");
}

function selectedServer() {
  return state.servers.find((server) => server.id === state.selectedServerId);
}

function selectedChannel() {
  return selectedServer()?.channels?.find((channel) => channel.id === state.selectedChannelId);
}

async function loadChannels(preferredChannelId) {
  const server = selectedServer();
  if (!server) return;
  const { channels } = await api(`/api/channels?serverId=${encodeURIComponent(server.id)}`);
  server.channels = channels;
  state.selectedChannelId = preferredChannelId || state.selectedChannelId || channels[0]?.id || null;
  if (!channels.some((channel) => channel.id === state.selectedChannelId)) state.selectedChannelId = channels[0]?.id || null;
  $("#serverName").textContent = server.name;
  renderChannels();
  renderMembers();
  renderRoles();
  if (state.selectedChannelId) await loadMessages();
}

function renderChannels() {
  const server = selectedServer();
  $("#channelList").innerHTML = (server?.channels || []).map((channel) => `
    <button class="channel-button ${channel.id === state.selectedChannelId ? "active" : ""}" data-channel-id="${channel.id}">
      ${escapeHtml(channel.name)}
    </button>
  `).join("");
  $("#messageInput").placeholder = `Message #${selectedChannel()?.name || "general"}`;
}

function renderRoles() {
  const server = selectedServer();
  $("#roleList").innerHTML = (server?.roles || []).map((role) => `
    <div class="role-row"><span>${escapeHtml(role.name)}</span><i class="role-dot" style="background:${role.color}"></i></div>
  `).join("");
}

function renderMembers() {
  const members = selectedServer()?.members || [];
  $("#memberList").innerHTML = members.map((member) => `
    <div class="member-row" data-user-id="${member.id}">
      <div class="avatar ${member.isOfficial ? "official" : ""}">${escapeHtml(member.avatar)}</div>
      <div><strong>${escapeHtml(member.name)} ${member.isOwner ? `<span class="crown" title="Campex Owner">♛</span>` : ""}</strong><span>${escapeHtml(member.username)}</span></div>
    </div>
  `).join("");
}

function renderBuddies() {
  $("#buddyList").innerHTML = state.buddies.length
    ? state.buddies.map((buddy) => `
      <div class="buddy-row" data-user-id="${buddy.id}">
        <div class="avatar">${escapeHtml(buddy.avatar)}</div>
        <div><strong>${escapeHtml(buddy.name)}</strong><span>${escapeHtml(buddy.username)}</span></div>
      </div>
    `).join("")
    : `<p class="demo-note">No buddys yet. Try EarlyCamper#1024.</p>`;
}

async function loadMessages() {
  if (!state.selectedChannelId) return;
  const { messages } = await api(`/api/messages?channelId=${encodeURIComponent(state.selectedChannelId)}`);
  const area = $("#messages");
  const nearBottom = area.scrollTop + area.clientHeight >= area.scrollHeight - 120;
  area.innerHTML = messages.map((message) => `
    <article class="message">
      <div class="avatar ${message.user?.isOfficial ? "official" : ""}">${escapeHtml(message.user?.avatar || "?")}</div>
      <div>
        <div class="message-meta">
          <strong class="profile-link" data-user-id="${message.user?.id}">${escapeHtml(message.user?.name || "Unknown")}</strong>
          <time>${time(message.createdAt)}</time>
        </div>
        <p class="message-text">${escapeHtml(message.text)}</p>
      </div>
    </article>
  `).join("");
  if (nearBottom) area.scrollTop = area.scrollHeight;
}

async function loadOfficialMessages() {
  const { messages } = await api(`/api/direct?userId=${encodeURIComponent(state.official.id)}`);
  const area = $("#officialMessages");
  area.innerHTML = messages.map((message) => `
    <article class="dm-message">
      <div class="avatar ${message.from?.isOfficial ? "official" : ""}">${escapeHtml(message.from?.avatar || "?")}</div>
      <div>
        <div class="message-meta"><strong>${escapeHtml(message.from?.name || "Unknown")}</strong><time>${time(message.createdAt)}</time></div>
        <p class="message-text">${escapeHtml(message.text)}</p>
      </div>
    </article>
  `).join("");
  area.scrollTop = area.scrollHeight;
}

function renderAdmin() {
  const panel = $("#adminPanel");
  if (!state.loginUser?.isOwner) {
    panel.innerHTML = `<p>Only the Campex Owner can use the admin panel.</p>`;
    return;
  }
  const selected = state.users.find((user) => user.id === state.selectedAdminUserId) || state.users.find((user) => !user.isOfficial);
  state.selectedAdminUserId = selected?.id;
  panel.innerHTML = `
    <div class="admin-grid">
      <div class="admin-users">
        ${state.users.map((user) => `
          <button class="admin-user ${user.id === state.selectedAdminUserId ? "active" : ""}" data-admin-user="${user.id}">
            ${escapeHtml(user.name)} · ${escapeHtml(user.username)}
          </button>
        `).join("")}
      </div>
      <div class="admin-actions">
        <p>Selected: <strong>${escapeHtml(selected?.username || "none")}</strong></p>
        <button id="grantStaffButton" class="primary-action">Grant user Campex Staff</button>
        <textarea id="warningText" placeholder="Warning message from Campex Team"></textarea>
        <button id="sendWarningButton" class="primary-action">Send warning as Campex Team</button>
        <p>You can send official messages, but you cannot send messages as another user.</p>
      </div>
    </div>
  `;
}

$("#loginTab").addEventListener("click", () => {
  $("#loginTab").classList.add("active");
  $("#registerTab").classList.remove("active");
  $("#loginForm").classList.remove("hidden");
  $("#registerForm").classList.add("hidden");
});

$("#registerTab").addEventListener("click", () => {
  $("#registerTab").classList.add("active");
  $("#loginTab").classList.remove("active");
  $("#registerForm").classList.remove("hidden");
  $("#loginForm").classList.add("hidden");
});

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#authError").textContent = "";
  try {
    await api("/api/auth/login", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    await loadBootstrap();
  } catch (error) {
    $("#authError").textContent = error.message;
  }
});

$("#registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#authError").textContent = "";
  try {
    await api("/api/auth/register", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    await loadBootstrap();
  } catch (error) {
    $("#authError").textContent = error.message;
  }
});

$("#logoutButton").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST", body: "{}" });
  showAuth();
});

$("#homeButton").addEventListener("click", () => setMode("buddies"));
$("#newServerButton").addEventListener("click", () => $("#serverDialog").showModal());
$("#newChannelButton").addEventListener("click", () => {
  if (state.mode === "chat") $("#channelDialog").showModal();
});

$$("#homeTools .nav-button").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.view)));

$("#serverRail").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-server-id]");
  if (!button) return;
  state.selectedServerId = button.dataset.serverId;
  state.selectedChannelId = null;
  setMode("chat");
  renderServers();
  await loadChannels();
});

$("#channelList").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-channel-id]");
  if (!button) return;
  state.selectedChannelId = button.dataset.channelId;
  setMode("chat");
  renderChannels();
  await loadMessages();
});

$("#messageForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#messageInput");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  await api("/api/messages", { method: "POST", body: JSON.stringify({ channelId: state.selectedChannelId, text }) });
  await loadMessages();
});

$("#buddyForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const { buddies } = await api("/api/buddies", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
  state.buddies = buddies;
  form.reset();
  renderBuddies();
});

$("#officialForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const text = new FormData(form).get("text");
  if (!text.trim()) return;
  await api("/api/direct", { method: "POST", body: JSON.stringify({ toId: state.official.id, text }) });
  form.reset();
  await loadOfficialMessages();
});

$("#serverForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const { server, channel } = await api("/api/servers", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
  state.servers.push({ ...server, channels: [channel], members: [state.user] });
  state.selectedServerId = server.id;
  state.selectedChannelId = channel.id;
  form.reset();
  $("#serverDialog").close();
  renderShell();
  setMode("chat");
  await loadChannels(channel.id);
});

$("#channelForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const body = { ...Object.fromEntries(new FormData(form)), serverId: state.selectedServerId };
  const { channel } = await api("/api/channels", { method: "POST", body: JSON.stringify(body) });
  form.reset();
  $("#channelDialog").close();
  await loadChannels(channel.id);
});

$("#roleForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const body = { ...Object.fromEntries(new FormData(form)), serverId: state.selectedServerId };
  if (!body.name.trim()) return;
  await api("/api/roles", { method: "POST", body: JSON.stringify(body) });
  form.reset();
  await loadBootstrap();
  setMode("chat");
});

$("#switchOfficialButton").addEventListener("click", async () => {
  const data = await api("/api/switch-official", { method: "POST", body: "{}" });
  state.user = data.user;
  state.loginUser = data.loginUser;
  state.usingOfficial = data.usingOfficial;
  await loadBootstrap();
});

$("#adminPanel").addEventListener("click", async (event) => {
  const userButton = event.target.closest("[data-admin-user]");
  if (userButton) {
    state.selectedAdminUserId = userButton.dataset.adminUser;
    renderAdmin();
    return;
  }
  if (event.target.id === "grantStaffButton") {
    const data = await api("/api/admin/grant-staff", { method: "POST", body: JSON.stringify({ userId: state.selectedAdminUserId }) });
    state.users = data.users;
    renderAdmin();
  }
  if (event.target.id === "sendWarningButton") {
    const text = $("#warningText").value.trim();
    if (!text) return;
    await api("/api/admin/warn", { method: "POST", body: JSON.stringify({ userId: state.selectedAdminUserId, text }) });
    $("#warningText").value = "";
  }
});

document.body.addEventListener("click", (event) => {
  const profile = event.target.closest("[data-user-id]");
  if (profile) {
    const user = state.users.find((item) => item.id === profile.dataset.userId);
    if (user) renderProfile(user);
  }
});

$("#selfProfileButton").addEventListener("click", () => renderProfile(state.user));
$$(".close-dialog").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));

loadBootstrap();
