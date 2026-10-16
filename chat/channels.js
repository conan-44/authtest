// Channel state, membership, invite flows, and channel tab controls.
let activeChatChannelId = null;
let joinedChatChannels = [];
let openChatChannelIds = new Set();
const chatChannelTabs = document.getElementById("chatChannelTabs");
const openChatChannelSelect = document.getElementById("openChatChannelSelect");
const createChatChannelBtn = document.getElementById("createChatChannelBtn");
const joinChatChannelBtn = document.getElementById("joinChatChannelBtn");
const inviteChatChannelBtn = document.getElementById("inviteChatChannelBtn");
let chatInviteWordsPromise = null;

async function createRandomChatInviteCode() {
  try {
    chatInviteWordsPromise ??= fetch("./data/chat/list.txt")
      .then(response => {
        if (!response.ok) throw new Error(`Could not load invite words (${response.status}).`);
        return response.text();
      })
      .then(text => text
        .split(/\r?\n/)
        .map(word => word.trim())
        .filter(word => /^[a-z]+$/.test(word)));

    const words = await chatInviteWordsPromise;
    if (words.length < 3) throw new Error("The invite word list must contain at least three single words.");
    if (!globalThis.crypto?.getRandomValues) throw new Error("Secure random generation is unavailable in this browser.");

    const range = 0x100000000;
    const limit = Math.floor(range / words.length) * words.length;
    const randomValue = new Uint32Array(1);
    const codeWords = [];
    while (codeWords.length < 3) {
      globalThis.crypto.getRandomValues(randomValue);
      if (randomValue[0] < limit) codeWords.push(words[randomValue[0] % words.length]);
    }

    const numberRange = 99999;
    const numberLimit = Math.floor(range / numberRange) * numberRange;
    let codeNumber;
    do {
      globalThis.crypto.getRandomValues(randomValue);
    } while (randomValue[0] >= numberLimit);
    codeNumber = (randomValue[0] % numberRange) + 1;

    return `${codeWords.join("-")}-${String(codeNumber).padStart(5, "0")}`;
  } catch (error) {
    chatInviteWordsPromise = null;
    throw error;
  }
}

async function storeChatInviteCode(channelId, code, replacedCode = null) {
  return runChatChannelRpc("store_chat_channel_invite_code", {
    p_channel_id: channelId,
    p_code: code,
    p_replaced_code: replacedCode
  });
}

function chatChannelStorageKey(kind) {
  return `chat-${kind}-${currentChatUserId || "guest"}`;
}

function saveOpenChatChannels() {
  if (!currentChatUserId) return;
  localStorage.setItem(chatChannelStorageKey("open-channels"), JSON.stringify([...openChatChannelIds]));
  localStorage.setItem(chatChannelStorageKey("active-channel"), activeChatChannelId || "");
}

function renderChatChannelTabs() {
  const globalTab = document.createElement("button");
  globalTab.type = "button";
  globalTab.className = `chat-channel-tab-button${activeChatChannelId === null ? " is-active" : ""}`;
  globalTab.dataset.channelId = "";
  globalTab.setAttribute("role", "tab");
  globalTab.textContent = "Global Chat";
  globalTab.setAttribute("aria-selected", String(activeChatChannelId === null));
  globalTab.setAttribute("aria-controls", "chatMessages");
  chatChannelTabs.replaceChildren(globalTab);

  joinedChatChannels.forEach(channel => {
    if (!openChatChannelIds.has(channel.id)) return;
    const tab = document.createElement("span");
    tab.className = `chat-channel-tab${activeChatChannelId === channel.id ? " is-active" : ""}`;

    const selectButton = document.createElement("button");
    selectButton.type = "button";
    selectButton.className = `chat-channel-tab-button${activeChatChannelId === channel.id ? " is-active" : ""}`;
    selectButton.dataset.channelId = channel.id;
    selectButton.setAttribute("role", "tab");
    selectButton.textContent = channel.name;
    selectButton.setAttribute("aria-selected", String(activeChatChannelId === channel.id));
    selectButton.setAttribute("aria-controls", "chatMessages");

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "chat-channel-close";
    closeButton.dataset.closeChannelId = channel.id;
    closeButton.textContent = "×";
    closeButton.setAttribute("aria-label", `Close ${channel.name} tab`);

    tab.append(selectButton, closeButton);
    chatChannelTabs.appendChild(tab);
  });

  const openChannels = joinedChatChannels.filter(channel => !openChatChannelIds.has(channel.id));
  openChatChannelSelect.replaceChildren(new Option("Open channel...", ""));
  openChannels.forEach(channel => openChatChannelSelect.add(new Option(channel.name, channel.id)));
  openChatChannelSelect.hidden = openChannels.length === 0 || !currentChatUserId;
  createChatChannelBtn.disabled = !currentChatUserId;
  joinChatChannelBtn.disabled = !currentChatUserId;

  inviteChatChannelBtn.hidden = !joinedChatChannels.some(channel => channel.id === activeChatChannelId);
}

async function activateChatChannel(channelId) {
  if (channelId && !joinedChatChannels.some(channel => channel.id === channelId)) return;
  activeChatChannelId = channelId || null;
  if (activeChatChannelId) openChatChannelIds.add(activeChatChannelId);
  saveOpenChatChannels();
  renderChatChannelTabs();
  clearReplyTarget();
  await fetchChatHistory(activeChatChannelId);
}

async function loadJoinedChatChannels() {
  joinedChatChannels = [];
  openChatChannelIds.clear();
  activeChatChannelId = null;
  if (!currentChatUserId) {
    renderChatChannelTabs();
    await fetchChatHistory(null);
    return;
  }

  const { data, error } = await _supabase
    .from("chat_channel_members")
    .select("channel_id, chat_channels!inner(id, name)")
    .eq("user_id", currentChatUserId);
  if (error) {
    console.error("Could not load joined chat channels.", error.message);
    if (typeof showPopup === "function") {
      showPopup(`Could not load channels. Apply supabase/chat_channels.sql first: ${error.message}`, "error");
    }
    renderChatChannelTabs();
    await fetchChatHistory(null);
    return;
  }

  joinedChatChannels = (data || [])
    .map(row => {
      const channel = Array.isArray(row.chat_channels) ? row.chat_channels[0] : row.chat_channels;
      return channel && typeof channel.id === "string" && typeof channel.name === "string"
        ? { id: channel.id, name: channel.name }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));

  let savedIds = joinedChatChannels.map(channel => channel.id);
  try {
    const savedOpen = localStorage.getItem(chatChannelStorageKey("open-channels"));
    if (savedOpen) savedIds = JSON.parse(savedOpen);
  } catch (error) {
    console.warn("Could not restore open chat channel tabs.", error);
  }
  if (!Array.isArray(savedIds)) savedIds = joinedChatChannels.map(channel => channel.id);
  openChatChannelIds = new Set(savedIds.filter(id => joinedChatChannels.some(channel => channel.id === id)));
  const savedActive = localStorage.getItem(chatChannelStorageKey("active-channel"));
  activeChatChannelId = openChatChannelIds.has(savedActive) ? savedActive : null;

  renderChatChannelTabs();
  await fetchChatHistory(activeChatChannelId);
}

async function runChatChannelRpc(name, params) {
  const { data, error } = await _supabase.rpc(name, params);
  if (error) {
    console.error(`Chat channel operation "${name}" failed.`, error.message);
    if (typeof showPopup === "function") showPopup(error.message, "error");
    return null;
  }
  return data;
}

function getRpcResultRow(data) {
  return Array.isArray(data) ? data[0] : data;
}

async function createChatChannel() {
  const name = window.prompt("enter channel name:")?.trim();
  if (!name) return;
  if (name.length > 40) {
    if (typeof showPopup === "function") showPopup("Channel names must be 40 characters or fewer.", "error");
    return;
  }
  let inviteCode;
  try {
    inviteCode = await createRandomChatInviteCode();
  } catch (error) {
    console.error("Could not generate a channel invite code.", error);
    if (typeof showPopup === "function") showPopup(`Could not generate an invite code: ${error.message}`, "error");
    return;
  }

  const data = await runChatChannelRpc("create_chat_channel", { p_name: name });
  const created = getRpcResultRow(data);
  if (!created?.channel_id || !created?.invite_code) return;

  const storedCode = await storeChatInviteCode(created.channel_id, inviteCode, created.invite_code);
  if (storedCode !== inviteCode) return;

  await loadJoinedChatChannels();
  openChatChannelIds.add(created.channel_id);
  await activateChatChannel(created.channel_id);
  window.prompt("created channel, share this invite code (one-time):", inviteCode);
}

async function joinChatChannel() {
  const code = window.prompt("enter invite code:")?.trim().toLowerCase();
  if (!code) return;
  if (!/^(?:[a-z]+(?:-[a-z]+){2}-(?!00000)[0-9]{5}|[a-z]+(?:-[a-z]+){2}|[0-9a-f]{32})$/.test(code)) {
    if (typeof showPopup === "function") showPopup("Invite codes must be three words followed by a five-digit number.", "error");
    return;
  }
  const data = await runChatChannelRpc("join_chat_channel", { p_code: code });
  const joined = getRpcResultRow(data);
  if (!joined?.channel_id) return;
  await loadJoinedChatChannels();
  openChatChannelIds.add(joined.channel_id);
  await activateChatChannel(joined.channel_id);
}

async function createChatChannelInvite() {
  if (!activeChatChannelId) return;
  let inviteCode;
  try {
    inviteCode = await createRandomChatInviteCode();
  } catch (error) {
    console.error("Could not generate a channel invite code.", error);
    if (typeof showPopup === "function") showPopup(`Could not generate an invite code: ${error.message}`, "error");
    return;
  }
  const storedCode = await storeChatInviteCode(activeChatChannelId, inviteCode);
  if (storedCode === inviteCode) {
    window.prompt("share this one-time invite code:", inviteCode);
  }
}


chatChannelTabs.addEventListener("click", event => {
  const closeButton = event.target.closest("button[data-close-channel-id]");
  if (closeButton) {
    const channelId = closeButton.dataset.closeChannelId;
    openChatChannelIds.delete(channelId);
    if (activeChatChannelId === channelId) activeChatChannelId = null;
    saveOpenChatChannels();
    renderChatChannelTabs();
    clearReplyTarget();
    fetchChatHistory(activeChatChannelId);
    return;
  }
  const tabButton = event.target.closest("button[data-channel-id]");
  if (tabButton) activateChatChannel(tabButton.dataset.channelId);
});
openChatChannelSelect.addEventListener("change", () => {
  if (openChatChannelSelect.value) activateChatChannel(openChatChannelSelect.value);
  openChatChannelSelect.value = "";
});
createChatChannelBtn.addEventListener("click", createChatChannel);
joinChatChannelBtn.addEventListener("click", joinChatChannel);
inviteChatChannelBtn.addEventListener("click", createChatChannelInvite);
