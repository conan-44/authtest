// Core chat state, history, realtime updates, and initialization.
let realtimeChannel = null;
let currentChatUserId = null;
let chatHistoryRequestId = 0;
let censoring = true;
let blankMessageCleanupInterval = null;
let chatPresenceChannel = null;
let chatPresenceHeartbeat = null;
let chatPresenceGeneration = 0;
let lastPresenceActivityAt = Date.now();
let lastPresenceTrackAt = 0;
let lastPresenceStatus = null;
let presenceUsername = "Player";
let presenceAvatar = null;
const presenceAvatarCache = new Map();
const presenceAvatarRequests = new Set();
const profileRankCache = new Map();
const profileRankRequests = new Set();
const PROFILE_RANKS = ["BANANA", "TOAST", "MUFFIN", "COOKIE", "ADMIN"];
const messageRecords = new Map();
const seenChatJoinNotices = new Set();
window.addEventListener('censoring-setting-changed', () => {
  censoring = window.getAppSetting ? window.getAppSetting('chat', 'censoring', true) : true;
  updateExistingMessagesCensoring();
});

window.addEventListener('chat-gifs-setting-changed', updateExistingMessagesCensoring);

function updateExistingMessagesCensoring() {
  const messageElements = document.querySelectorAll('#chatMessages .chat-msg');
  messageElements.forEach(div => {
    const contentDiv = div.querySelector('.chat-body');
    if (!contentDiv) return;

    const rawContent = contentDiv.getAttribute('data-raw');
    if (rawContent !== null) {
      renderChatMessageBody(contentDiv, rawContent, div.dataset.username || "Player");
    }
  });
}

function isMissingChannelColumn(error) {
  return error?.code === "42703"
    || (error?.code === "PGRST204" && error.message?.includes("channel_id"))
    || (error?.message?.includes("messages.channel_id") && error.message?.includes("does not exist"));
}

// 1. CHAT HISTORY
async function fetchChatHistory(channelId = activeChatChannelId) {
  const requestId = ++chatHistoryRequestId;
  const container = document.getElementById('chatMessages');
  container.innerHTML = '';
  messageRecords.clear();
  const loadMessages = async includeChannelId => {
    let query = _supabase
      .from('messages')
      .select(`id, content, created_at, user_id${includeChannelId ? ", channel_id" : ""}, profiles(username, flair, avatar)`)
      .order('created_at', { ascending: false })
      .limit(50);
    if (includeChannelId) {
      query = channelId ? query.eq("channel_id", channelId) : query.is("channel_id", null);
    }
    return query;
  };
  let { data, error } = await loadMessages(true);
  if (!channelId && error && isMissingChannelColumn(error)) {
    ({ data, error } = await loadMessages(false));
  }

  if (requestId !== chatHistoryRequestId) return;
  if (error) {
    console.error("Error loading chat:", error.message);
    return;
  }

  await loadMissingProfileRanks([...new Set((data || []).map(message => message.user_id).filter(Boolean))]);
  (data || []).reverse().forEach(msg => {
    messageRecords.set(String(msg.id), msg);
    appendMessageUI(msg);
  });
  scrollToBottom();
}

// 2. REALTIME LISTENER
function initRealtimeChat() {
  realtimeChannel = _supabase
    .channel('public:messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_room_first_joins' }, (payload) => {
      if (payload.new.room_key !== (activeChatChannelId || "global")) return;
      appendChatJoinNotice(payload.new);
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
      if (!payload.new.content || (payload.new.channel_id || null) !== activeChatChannelId) return;
      const { data: profile } = await _supabase
        .from('profiles')
        .select('username, flair, avatar')
        .eq('id', payload.new.user_id)
        .single();

      const message = { ...payload.new, profiles: profile };
      messageRecords.set(String(message.id), message);
      appendMessageUI(message);
      if (message.user_id) loadMissingProfileRanks([message.user_id]);
      scrollToBottom();

      if (!payload.new.channel_id && chatPanel.classList.contains('is-hidden') && typeof showPopup === "function") {
        if (!window.getAppSetting || window.getAppSetting('popups', 'chat popups', true)) {
          showPopup(`${profile?.username || 'Player'}: ${getChatMessagePreview(payload.new.content)}`, 'chat');
        }
      }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload) => {
      if ((payload.new.channel_id || null) !== activeChatChannelId) return;
      updateMessageUI(payload.new);
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (payload) => {
      const previous = messageRecords.get(String(payload.old.id));
      if (!previous || (previous.channel_id || null) !== activeChatChannelId) return;
      removeMessageUI(payload.old.id);
    })
    .subscribe();
}

function renderChatPresence(state = {}) {
  const list = document.getElementById("chatPresenceList");
  const count = document.getElementById("chatPresenceCount");
  const status = document.getElementById("chatPresenceStatus");
  if (!list || !count || !status) return;

  const members = new Map();
  Object.values(state).flat().forEach(presence => {
    const userId = presence?.user_id;
    if (!userId) return;
    if (presence.avatar) presenceAvatarCache.set(userId, presence.avatar);
    const existing = members.get(userId);
    if (!existing || presence.status === "active") {
      members.set(userId, {
        username: typeof presence.username === "string" && presence.username.trim()
          ? presence.username.trim()
          : "Player",
        avatar: presence.avatar || presenceAvatarCache.get(userId) || null,
        rank: profileRankCache.get(userId) || "BANANA",
        status: presence.status === "active" ? "active" : "idle"
      });
    }
  });

  const sortedMembers = [...members.entries()].sort((a, b) => {
    if (a[1].status !== b[1].status) return a[1].status === "active" ? -1 : 1;
    return a[1].username.localeCompare(b[1].username);
  });
  list.replaceChildren(...sortedMembers.map(([, member]) => {
    const item = document.createElement("li");
    item.className = "chat-presence-member";
    const avatar = makeChatAvatar(member.avatar, "chat-presence-avatar", member.username);
    avatar.classList.add(`is-${member.status}`);
    const styleRank = member.rank === "ADMIN" ? "COOKIE" : member.rank;
    if (["TOAST", "MUFFIN", "COOKIE"].includes(styleRank)) {
      avatar.classList.add("profile-rank-aura", `rank-${styleRank.toLowerCase()}`);
    }
    avatar.title = member.status === "active" ? "Active" : "Idle";
    const name = document.createElement("span");
    name.className = "chat-presence-name";
    name.textContent = member.username;
    applyChatRank(name, member.rank, { nameOnly: true });
    const adminBadge = ["COOKIE", "ADMIN"].includes(member.rank) ? makeChatRankBadge(member.rank) : null;
    const label = document.createElement("span");
    label.className = "chat-presence-member-status";
    label.textContent = member.status;
    item.append(avatar);
    item.appendChild(name);
    if (adminBadge) item.appendChild(adminBadge);
    item.appendChild(label);
    return item;
  }));
  count.textContent = String(sortedMembers.length);
  if (sortedMembers.length) {
    status.textContent = "";
  } else if (chatPresenceChannel) {
    status.textContent = "No members are online yet.";
  }
  loadMissingPresenceAvatars([...members.keys()]);
  loadMissingProfileRanks([...members.keys()]);
}

async function loadMissingPresenceAvatars(userIds) {
  const missingIds = userIds.filter(userId => (
    !presenceAvatarCache.has(userId) && !presenceAvatarRequests.has(userId)
  ));
  if (!missingIds.length) return;
  missingIds.forEach(userId => presenceAvatarRequests.add(userId));

  try {
    const { data, error } = await _supabase
      .from("public_profiles")
      .select("id, avatar")
      .in("id", missingIds);
    if (error) throw error;
    (data || []).forEach(profile => {
      presenceAvatarCache.set(profile.id, profile.avatar || null);
    });
    missingIds.forEach(userId => {
      if (!presenceAvatarCache.has(userId)) presenceAvatarCache.set(userId, null);
    });
    if (chatPresenceChannel) renderChatPresence(chatPresenceChannel.presenceState());
  } catch (error) {
    console.error("Could not load chat member profile pictures.", error);
  } finally {
    missingIds.forEach(userId => presenceAvatarRequests.delete(userId));
  }
}

async function loadMissingProfileRanks(userIds) {
  const missingIds = userIds.filter(userId => (
    !profileRankCache.has(userId) && !profileRankRequests.has(userId)
  ));
  if (!missingIds.length) return;
  missingIds.forEach(userId => profileRankRequests.add(userId));

  try {
    const { data, error } = await _supabase.rpc("get_public_profile_ranks", {
      p_user_ids: missingIds
    });
    if (error) throw error;
    (data || []).forEach(profile => {
      if (PROFILE_RANKS.includes(profile.rank)) profileRankCache.set(profile.user_id, profile.rank);
    });
    missingIds.forEach(userId => {
      if (!profileRankCache.has(userId)) profileRankCache.set(userId, "BANANA");
    });
    missingIds.forEach(refreshChatProfileDecorations);
    if (chatPresenceChannel) renderChatPresence(chatPresenceChannel.presenceState());
  } catch (error) {
    console.error("Could not load chat member ranks.", error);
  } finally {
    missingIds.forEach(userId => profileRankRequests.delete(userId));
  }
}

function makeChatRankBadge(rank) {
  const isAdmin = rank === "ADMIN";
  const badge = document.createElement("span");
  badge.className = `profile-admin-badge chat-admin-badge ${isAdmin ? "rank-admin" : "rank-cookie"}`;
  badge.setAttribute("aria-label", isAdmin ? "Admin" : "Cookie rank");
  const icon = document.createElement(isAdmin ? "img" : "span");
  if (isAdmin) {
    icon.src = "./assets/admin.png";
    icon.alt = "";
  } else {
    icon.className = "profile-rank-icon rank-cookie";
  }
  icon.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.textContent = rank;
  badge.append(icon, label);
  return badge;
}

function applyChatRank(element, rank, { nameOnly = false } = {}) {
  const styleRank = rank === "ADMIN" ? "COOKIE" : rank;
  element.classList.remove(
    "rank-banana",
    "rank-toast",
    "rank-muffin",
    "rank-cookie",
    "rank-flair-enhanced"
  );
  if (PROFILE_RANKS.includes(rank)) element.classList.add(`rank-${styleRank.toLowerCase()}`);
  if (!nameOnly && (styleRank === "MUFFIN" || styleRank === "COOKIE")) {
    element.classList.add("rank-flair-enhanced");
  }
  if (styleRank === "COOKIE") element.dataset.text = element.textContent;
  else delete element.dataset.text;
}

function refreshChatProfileDecorations(userId) {
  if (typeof userId !== "string" || !userId) return;
  const rank = profileRankCache.get(userId) || "BANANA";
  document.querySelectorAll(`#chatMessages .chat-msg[data-user-id="${CSS.escape(userId)}"]`).forEach(message => {
    const avatar = message.querySelector(".chat-name-avatar");
    const profileLink = message.querySelector(".chat-profile-link");
    const username = message.querySelector(".chat-profile-username");
    const flair = message.querySelector(".chat-flair");
    const styleRank = rank === "ADMIN" ? "COOKIE" : rank;
    if (avatar && ["TOAST", "MUFFIN", "COOKIE"].includes(styleRank)) {
      avatar.classList.add("profile-rank-aura", `rank-${styleRank.toLowerCase()}`);
    }
    if (profileLink) {
      profileLink.querySelector(".chat-admin-badge")?.remove();
      if (rank === "COOKIE" || rank === "ADMIN") profileLink.appendChild(makeChatRankBadge(rank));
    }
    if (username) applyChatRank(username, rank, { nameOnly: true });
    if (flair) applyChatRank(flair, rank);
  });
}

function stopChatPresence() {
  chatPresenceGeneration++;
  if (chatPresenceHeartbeat) {
    window.clearInterval(chatPresenceHeartbeat);
    chatPresenceHeartbeat = null;
  }
  if (chatPresenceChannel) {
    const previous = chatPresenceChannel;
    chatPresenceChannel = null;
    _supabase.removeChannel(previous);
  }
  lastPresenceStatus = null;
  lastPresenceTrackAt = 0;
  presenceAvatar = null;
  renderChatPresence();
}

function getChatPresenceStatus() {
  return document.visibilityState === "visible"
    && Date.now() - lastPresenceActivityAt < 5 * 60 * 1000
    ? "active"
    : "idle";
}

async function trackChatPresence(force = false) {
  const channel = chatPresenceChannel;
  if (!channel || !currentChatUserId) return;
  const now = Date.now();
  const status = getChatPresenceStatus();
  if (!force && status === lastPresenceStatus && now - lastPresenceTrackAt < 60 * 1000) return;

  lastPresenceStatus = status;
  lastPresenceTrackAt = now;
  try {
    const result = await channel.track({
      user_id: currentChatUserId,
      username: presenceUsername,
      avatar: presenceAvatar,
      status,
      last_active_at: new Date(now).toISOString()
    });
    if (result !== "ok") console.error("Chat presence update was not acknowledged.", result);
  } catch (error) {
    console.error("Could not update chat presence.", error);
  }
}

window.setChatPresenceRoom = async function setChatPresenceRoom(channelId) {
  stopChatPresence();
  const generation = chatPresenceGeneration;
  const title = document.getElementById("chatPresenceTitle");
  const status = document.getElementById("chatPresenceStatus");
  const list = document.getElementById("chatPresenceList");
  const count = document.getElementById("chatPresenceCount");
  const roomName = channelId
    ? joinedChatChannels.find(channel => channel.id === channelId)?.name || "Channel"
    : "Global Chat";
  if (title) title.textContent = `${roomName} members`;
  if (list) list.replaceChildren();
  if (count) count.textContent = "0";
  if (!currentChatUserId) {
    if (status) status.textContent = "Sign in to see who's here.";
    return;
  }

  lastPresenceActivityAt = Date.now();
  if (status) status.textContent = "Connecting to presence…";
  const { data: profile, error: profileError } = await _supabase
    .from("profiles")
    .select("username, avatar")
    .eq("id", currentChatUserId)
    .maybeSingle();
  if (profileError) console.error("Could not load the chat presence profile.", profileError.message);
  if (generation !== chatPresenceGeneration || !currentChatUserId) return;
  presenceUsername = profile?.username || "Player";
  presenceAvatar = profile?.avatar || null;

  const topic = channelId ? `chat-presence:channel:${channelId}` : "chat-presence:global";
  const channel = _supabase.channel(topic, {
    config: { private: true, presence: { key: currentChatUserId } }
  });
  chatPresenceChannel = channel;
  channel
    .on("presence", { event: "sync" }, () => {
      if (chatPresenceChannel === channel) renderChatPresence(channel.presenceState());
    })
    .subscribe(async subscriptionStatus => {
      if (chatPresenceChannel !== channel) return;
      if (subscriptionStatus === "SUBSCRIBED") {
        await trackChatPresence(true);
        renderChatPresence(channel.presenceState());
      } else if (subscriptionStatus === "CHANNEL_ERROR" || subscriptionStatus === "TIMED_OUT") {
        console.error(`Chat presence subscription failed (${subscriptionStatus}).`);
        if (status) status.textContent = "Presence unavailable. Apply supabase/chat_presence.sql in Supabase.";
      }
    });
  chatPresenceHeartbeat = window.setInterval(() => trackChatPresence(), 15 * 1000);
};

function recordChatPresenceActivity() {
  lastPresenceActivityAt = Date.now();
  if (lastPresenceStatus !== "active") trackChatPresence(true);
}

["pointerdown", "pointermove", "keydown", "touchstart", "scroll"].forEach(eventName => {
  document.addEventListener(eventName, recordChatPresenceActivity, { passive: true });
});
document.addEventListener("visibilitychange", () => trackChatPresence(true));

function appendChatJoinNotice(join) {
  if (!join?.user_id || !join?.room_key || join.room_key !== (activeChatChannelId || "global")) return;
  const noticeKey = `${join.room_key}:${join.user_id}`;
  if (seenChatJoinNotices.has(noticeKey)) return;
  seenChatJoinNotices.add(noticeKey);

  const notice = document.createElement("div");
  notice.className = "chat-join-notice";
  notice.dataset.joinNoticeId = noticeKey;
  notice.textContent = `---- ${join.username || "Player"} joined the chat ----`;
  document.getElementById("chatMessages").appendChild(notice);
  scrollToBottom();
}

async function recordChatRoomFirstJoin(channelId = activeChatChannelId) {
  if (!currentChatUserId) return;
  const { data, error } = await _supabase.rpc("record_chat_room_first_join", {
    p_channel_id: channelId || null
  });
  if (error) {
    console.error("Could not record first chat-room join.", error.message);
    if (typeof showPopup === "function") showPopup(`Could not record chat-room join: ${error.message}`, "error");
    return;
  }

  const joined = Array.isArray(data) ? data[0] : data;
  if (joined?.user_id) appendChatJoinNotice(joined);
}

// 3. SEND MESSAGE
function recordChatAchievement(eventName) {
  const recorder = window.achievements?.recordGameEvent;
  if (typeof recorder !== "function") {
    console.error("Achievement tracker is unavailable for chat activity.");
    return;
  }
  recorder("main", eventName).catch(error => {
    console.error("Could not record chat activity achievement.", error);
  });
}

async function sendMessage() {
  const input = document.getElementById('chatInput');
  const content = input.value.trim();
  if (!content) return;
  const channelId = activeChatChannelId;

  playSendIconAnimation();

  const { data: { user } } = await _supabase.auth.getUser();
  if (!user) return;

  input.value = '';
  const message = { user_id: user.id, content: encodeReplyContent(content) };
  if (channelId) message.channel_id = channelId;
  const { error } = await _supabase.from('messages').insert([message]);
  if (error) {
    console.error("Error sending message:", error.message);
    return;
  }
  recordChatAchievement("message-sent");
  clearReplyTarget();
}

window.shareGameToChat = async function shareGameToChat(game, data) {
  if (game !== "chess" && game !== "number-pillars") {
    throw new Error("This game cannot be shared in chat.");
  }
  if (!data || typeof data !== "object") {
    throw new Error("The shared game data is invalid.");
  }
  if (game === "chess") {
    if (typeof data.pgn !== "string" || !data.pgn.trim() || data.pgn.length > 16_000) {
      throw new Error("The shared Chess game is invalid.");
    }
    if (data.evaluations !== undefined && data.evaluations !== null &&
      (!Array.isArray(data.evaluations) || data.evaluations.length > 200)) {
      throw new Error("The shared Chess analysis is invalid.");
    }
  } else if (
    !Array.isArray(data.numbers) ||
    data.numbers.length === 0 ||
    data.numbers.length > 40 ||
    !data.numbers.every(number => Number.isFinite(number) && Math.abs(number) <= 1_000_000) ||
    !Number.isFinite(data.answer) ||
    Math.abs(data.answer) > 1_000_000 ||
    (data.name !== undefined && (typeof data.name !== "string" || data.name.length > 60))
  ) {
    throw new Error("The shared Number Pillars level is invalid.");
  }

  const payload = { ...data, game };
  const content = `game:v1:${JSON.stringify(payload)}`;
  if (content.length > 40_000) {
    throw new Error("This game is too large to share in chat.");
  }

  const { data: authData, error: authError } = await _supabase.auth.getUser();
  if (authError) throw new Error(`Could not verify your sign-in: ${authError.message}`);
  if (!authData.user) throw new Error("Sign in to share a game in chat.");

  const message = {
    user_id: authData.user.id,
    content: encodeReplyContent(content)
  };
  if (activeChatChannelId) message.channel_id = activeChatChannelId;

  const { error } = await _supabase.from("messages").insert([message]);
  if (error) throw new Error(`Could not share the game: ${error.message}`);

  recordChatAchievement("message-sent");
  clearReplyTarget();
  playSendIconAnimation();
};

window.shareGameInviteToChat = async function shareGameInviteToChat(game, inviteCode) {
  if (!["chess", "doudizhu"].includes(game) || !/^[A-Z0-9]{8}$/.test(inviteCode)) {
    throw new Error("This game invite is invalid.");
  }
  const { data: authData, error: authError } = await _supabase.auth.getUser();
  if (authError) throw new Error(`Could not verify your sign-in: ${authError.message}`);
  if (!authData.user) throw new Error("Sign in to share a game invite in chat.");

  const message = {
    user_id: authData.user.id,
    content: encodeReplyContent(`game-invite:v1:${JSON.stringify({ game, invite_code: inviteCode })}`)
  };
  if (activeChatChannelId) message.channel_id = activeChatChannelId;

  const { error } = await _supabase.from("messages").insert([message]);
  if (error) throw new Error(`Could not share the game invite: ${error.message}`);
  recordChatAchievement("message-sent");
  clearReplyTarget();
  playSendIconAnimation();
};

function playSendIconAnimation() {
  const icon = document.querySelector('#sendChatBtn .icon-send');
  if (!icon) return;
  icon.classList.remove('is-sending');
  void icon.offsetWidth; // restart the animation from scratch
  icon.classList.add('is-sending');
}

// 4. UI HELPERS
function appendMessageUI(msg) {
  if (!msg.id || typeof msg.content !== "string" || !msg.content.trim()) return;

  const container = document.getElementById('chatMessages');
  const existing = container.querySelector(`[data-message-id="${CSS.escape(String(msg.id))}"]`);
  if (existing) {
    updateMessageUI(msg);
    return;
  }
  const div = document.createElement('div');

  censoring = window.getAppSetting ? window.getAppSetting('chat', 'censoring', censoring) : censoring;

  const rawContent = typeof msg.content === "string" ? msg.content : "";
  messageRecords.set(String(msg.id), msg);

  const isOwn = msg.user_id && msg.user_id === currentChatUserId;
  div.className = `chat-msg ${isOwn ? 'chat-msg-own' : 'chat-msg-other'}`;
  div.dataset.messageId = String(msg.id);
  div.dataset.userId = String(msg.user_id || "");
  div.dataset.username = msg.profiles?.username || "Player";

  const username = msg.profiles?.username || 'Player';
  const flair = msg.profiles?.flair ? `<span class="chat-flair">${escapeHTML(msg.profiles.flair)}</span>` : '';
  const timestamp = msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const profileUserId = escapeHTML(String(msg.user_id || ""));

  // Use a dedicated .chat-body wrapper with data-raw storing unescaped/uncensored raw text
  div.innerHTML = `<div class="chat-header"><button type="button" class="chat-profile-link" data-chat-profile-user data-user-id="${profileUserId}"></button>${flair}<span class="chat-timestamp">${timestamp}</span><button type="button" class="chat-reply-button" data-message-action="reply" aria-label="Reply"><span class="btn-icon icon-reply" aria-hidden="true"></span></button></div><div class="chat-reply-preview is-hidden"></div><div class="chat-body">${escapeHTML(rawContent)}</div>`;

  const profileLink = div.querySelector(".chat-profile-link");
  profileLink.setAttribute("aria-label", `View ${username}'s profile`);
  const usernameText = document.createElement("span");
  usernameText.className = "chat-profile-username";
  usernameText.textContent = username;
  profileLink.append(makeChatAvatar(msg.profiles?.avatar, "chat-name-avatar", username), usernameText);
  refreshChatProfileDecorations(msg.user_id);
  const bodyDiv = div.querySelector('.chat-body');
  bodyDiv.setAttribute('data-raw', rawContent);
  renderReplyPreview(div, rawContent);
  renderChatMessageBody(bodyDiv, rawContent, div.dataset.username);
  div.querySelector(".chat-reply-button").addEventListener("click", () => setReplyTarget(div));

  if (isOwn) {
    const actions = document.createElement("div");
    actions.className = "chat-message-actions";
    actions.innerHTML = `
      <button type="button" data-message-action="edit" aria-label="Edit"><span class="btn-icon icon-edit" aria-hidden="true"></span></button>
      <button type="button" data-message-action="delete" aria-label="Delete"><span class="btn-icon icon-trash" aria-hidden="true"></span></button>
    `;
    div.appendChild(actions);
  }

  container.appendChild(div);
}

function makeChatAvatar(avatar, className, username) {
  if (avatar && window.ProfileAvatars && !window.ProfileAvatars.isDefault(avatar)) {
    const canvas = document.createElement("canvas");
    canvas.className = className;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${username || "Player"}'s profile picture`);
    if (window.ProfileAvatars.draw(canvas, avatar)) return canvas;
    console.warn("A chat profile picture has an invalid format.", avatar);
  }
  const image = document.createElement("img");
  image.className = className;
  image.src = "./assets/profile.png";
  image.alt = "";
  image.setAttribute("aria-hidden", "true");
  return image;
}

function updateMessageUI(msg) {
  const messageEl = document.querySelector(`#chatMessages [data-message-id="${CSS.escape(String(msg.id))}"]`);
  if (!messageEl) {
    appendMessageUI(msg);
    return;
  }
  if (typeof msg.content !== "string" || !msg.content.trim()) {
    messageRecords.delete(String(msg.id));
    messageEl.remove();
    return;
  }
  const previous = messageRecords.get(String(msg.id)) || {};
  messageRecords.set(String(msg.id), { ...previous, ...msg });
  const body = messageEl.querySelector(".chat-body");
  body.setAttribute("data-raw", msg.content);
  renderReplyPreview(messageEl, msg.content);
  renderChatMessageBody(body, msg.content, messageEl.dataset.username || "Player");
}

function removeMessageUI(id) {
  if (id === undefined || id === null) return;
  messageRecords.delete(String(id));
  document.querySelector(`#chatMessages [data-message-id="${CSS.escape(String(id))}"]`)?.remove();
}


function scrollToBottom() {
  const container = document.getElementById('chatMessages');
  container.scrollTop = container.scrollHeight;
}

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}

function censorSwearWords(str) {
  const badWords = [
    "fuck", "shit", "bitch", "asshole", "dick",
    "pussy", "cunt", "cock", "suck", "nigga", "nigger", "fag",
    "andrew chiu", "andrewchiu", "chiu, andrew", "a. chiu"
  ];

  const charMap = {
    'a': '[aA@4$!@#$%^&*()x]',
    'b': '[bB8!@#$%^&*()x]',
    'c': '[cC(<{!@#$%^&*()x]',
    'd': '[dD!@#$%^&*()x]',
    'e': '[eE3!@#$%^&*()x]',
    'f': '[fF!@#$%^&*()x]',
    'g': '[gG69!@#$%^&*()x]',
    'h': '[hH!@#$%^&*()x]',
    'i': '[iI1!|!@#$%^&*()x]',
    'k': '[kK!@#$%^&*()x]',
    'l': '[lL1!|!@#$%^&*()x]',
    'n': '[nN!@#$%^&*()x]',
    'o': '[oO0!@#$%^&*()x]',
    'p': '[pP!@#$%^&*()x]',
    'r': '[rR!@#$%^&*()x]',
    's': '[sS5$!@#$%^&*()x]',
    't': '[tT7+!@#$%^&*()x]',
    'u': '[uUvV!@#$%^&*()x]',
    'y': '[yY!@#$%^&*()x]'
  };

  const vowels = new Set(['a', 'e', 'i', 'o', 'u']);

  const wordPatterns = badWords.map(word => {
    const chars = word.split('');
    const corePattern = chars
      .map((char, index) => {
        const lowerChar = char.toLowerCase();
        const mapped = charMap[lowerChar] || lowerChar;
        const isVowel = vowels.has(lowerChar);
        const isLast = index === chars.length - 1;
        const charPattern = isVowel ? `${mapped}*` : `${mapped}+`;
        const delimiter = `[\\s*#x!_\\-$%^&]*`;

        return isLast ? charPattern : `${charPattern}${delimiter}`;
      })
      .join('');
    return corePattern;
  });
  const pattern = new RegExp(`(?<=[\\s^>]|^)(${wordPatterns.join('|')})(?=[\\s$.!?]|$)`, 'gi');

  return str.replace(pattern, (match) => {
    return match[0] + 'x'.repeat(match.length - 1);
  });
}

// 5. LAZY INIT
let chatInitialized = false;
const chatPanel = document.getElementById('chatPanel');

window.initChatTab = async function initChatTab() {
  if (chatInitialized) return;
  chatInitialized = true;
  const { data: { user } } = await _supabase.auth.getUser();
  currentChatUserId = user?.id || null;
  await cleanupBlankMessages(currentChatUserId);
  if (currentChatUserId && !blankMessageCleanupInterval) {
    blankMessageCleanupInterval = window.setInterval(cleanupBlankMessages, 5 * 60 * 1000);
  }
  await loadJoinedChatChannels();
  initRealtimeChat();
  await window.setChatPresenceRoom(activeChatChannelId);
  await recordChatRoomFirstJoin();
};

async function handleChatAuthChange(userId) {
  if (currentChatUserId === userId) return;
  stopChatPresence();
  currentChatUserId = userId;
  if (!currentChatUserId && blankMessageCleanupInterval) {
    window.clearInterval(blankMessageCleanupInterval);
    blankMessageCleanupInterval = null;
  } else if (currentChatUserId && !blankMessageCleanupInterval) {
    await cleanupBlankMessages(currentChatUserId);
    blankMessageCleanupInterval = window.setInterval(cleanupBlankMessages, 5 * 60 * 1000);
  }
  if (!realtimeChannel && currentChatUserId) initRealtimeChat();
  await loadJoinedChatChannels();
  await window.setChatPresenceRoom(activeChatChannelId);
  await recordChatRoomFirstJoin();
}

window.addEventListener("app-auth-state-changed", event => {
  if (chatInitialized) handleChatAuthChange(event.detail?.userId || null);
});

document.getElementById('sendChatBtn').addEventListener('click', sendMessage);
document.getElementById('chatInput').addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });
