// REALTIME CHAT MODULE (Add to existing JS)

let realtimeChannel = null;
let currentChatUserId = null;
let activeChatChannelId = null;
let joinedChatChannels = [];
let openChatChannelIds = new Set();
let chatHistoryRequestId = 0;
let censoring = true;
const GIF_MESSAGE_PREFIX = "gif:v1:";
const REPLY_MESSAGE_PREFIX = "reply:v1:";
const GIF_HIDE_SETTING = "hide gifs";
const gifSearchForm = document.getElementById("gifSearchForm");
const gifSearchInput = document.getElementById("gifSearchInput");
const gifSearchButton = document.getElementById("gifSearchButton");
const gifSearchResults = document.getElementById("gifSearchResults");
const gifSearchPagination = document.getElementById("gifSearchPagination");
const gifSearchStatus = document.getElementById("gifSearchStatus");
const gifSearchResultById = new Map();
const GIF_SEARCH_PAGE_SIZE = 12;
let gifSearchRequestId = 0;
let gifSearchQuery = "";
let gifSearchPage = 1;
let gifSearchPageCount = 0;
let blankMessageCleanupInterval = null;
const GIF_PICKER_COLLAPSED_KEY = "chat-gif-picker-collapsed";
const toggleGifPickerBtn = document.getElementById("toggleGifPickerBtn");
const chatOptionsBody = document.getElementById("chatOptionsBody");
const chatReplyContext = document.getElementById("chatReplyContext");
const chatReplyText = document.getElementById("chatReplyText");
const cancelChatReplyBtn = document.getElementById("cancelChatReplyBtn");
const messageRecords = new Map();
let replyTargetId = null;
const chatChannelTabs = document.getElementById("chatChannelTabs");
const openChatChannelSelect = document.getElementById("openChatChannelSelect");
const createChatChannelBtn = document.getElementById("createChatChannelBtn");
const joinChatChannelBtn = document.getElementById("joinChatChannelBtn");
const inviteChatChannelBtn = document.getElementById("inviteChatChannelBtn");
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
  const name = window.prompt("Enter a name for the new channel:")?.trim();
  if (!name) return;
  if (name.length > 40) {
    if (typeof showPopup === "function") showPopup("Channel names must be 40 characters or fewer.", "error");
    return;
  }
  const data = await runChatChannelRpc("create_chat_channel", { p_name: name });
  const created = getRpcResultRow(data);
  if (!created?.channel_id || !created?.invite_code) return;

  await loadJoinedChatChannels();
  openChatChannelIds.add(created.channel_id);
  await activateChatChannel(created.channel_id);
  window.prompt("Channel created. Copy and share this one-time invite code:", created.invite_code);
}

async function joinChatChannel() {
  const code = window.prompt("Enter the one-time channel invite code:")?.trim();
  if (!code) return;
  const data = await runChatChannelRpc("join_chat_channel", { p_code: code });
  const joined = getRpcResultRow(data);
  if (!joined?.channel_id) return;
  await loadJoinedChatChannels();
  openChatChannelIds.add(joined.channel_id);
  await activateChatChannel(joined.channel_id);
}

async function createChatChannelInvite() {
  if (!activeChatChannelId) return;
  const data = await runChatChannelRpc("create_chat_channel_invite", { p_channel_id: activeChatChannelId });
  if (typeof data === "string" && data) {
    window.prompt("Copy and share this one-time invite code:", data);
  }
}

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
      renderChatMessageBody(contentDiv, rawContent);
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
      .select(`id, content, created_at, user_id${includeChannelId ? ", channel_id" : ""}, profiles(username, flair)`)
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
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
      if (!payload.new.content || (payload.new.channel_id || null) !== activeChatChannelId) return;
      const { data: profile } = await _supabase
        .from('profiles')
        .select('username, flair')
        .eq('id', payload.new.user_id)
        .single();

      const message = { ...payload.new, profiles: profile };
      messageRecords.set(String(message.id), message);
      appendMessageUI(message);
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

// 3. SEND MESSAGE
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
  clearReplyTarget();
}

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

  const username = escapeHTML(msg.profiles?.username || 'Player');
  const flair = msg.profiles?.flair ? `<span class="chat-flair">${escapeHTML(msg.profiles.flair)}</span>` : '';
  const timestamp = msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  // Use a dedicated .chat-body wrapper with data-raw storing unescaped/uncensored raw text
  div.innerHTML = `<div class="chat-header">${username}${flair}<span class="chat-timestamp">${timestamp}</span><button type="button" class="chat-reply-button" data-message-action="reply" aria-label="Reply"><span class="btn-icon icon-reply" aria-hidden="true"></span></button></div><div class="chat-reply-preview is-hidden"></div><div class="chat-body">${escapeHTML(rawContent)}</div>`;
  
  const bodyDiv = div.querySelector('.chat-body');
  bodyDiv.setAttribute('data-raw', rawContent);
  renderReplyPreview(div, rawContent);
  renderChatMessageBody(bodyDiv, rawContent);
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
  renderChatMessageBody(body, msg.content);
}

function removeMessageUI(id) {
  if (id === undefined || id === null) return;
  messageRecords.delete(String(id));
  document.querySelector(`#chatMessages [data-message-id="${CSS.escape(String(id))}"]`)?.remove();
}

function parseReplyMessage(content) {
  if (typeof content !== "string" || !content.startsWith(REPLY_MESSAGE_PREFIX)) {
    return { replyId: null, content };
  }
  const separatorIndex = content.indexOf("|", REPLY_MESSAGE_PREFIX.length);
  if (separatorIndex < 0) return { replyId: null, content };
  const replyId = content.slice(REPLY_MESSAGE_PREFIX.length, separatorIndex);
  if (!/^[\w-]{1,100}$/.test(replyId)) return { replyId: null, content };
  return { replyId, content: content.slice(separatorIndex + 1) };
}

function encodeReplyContent(content) {
  return replyTargetId ? `${REPLY_MESSAGE_PREFIX}${replyTargetId}|${content}` : content;
}

function getMessagePreview(content) {
  const message = parseReplyMessage(content);
  return parseGifMessage(message.content) ? "GIF" : (censoring ? censorSwearWords(message.content) : message.content);
}

function renderReplyPreview(messageEl, rawContent) {
  const preview = messageEl.querySelector(".chat-reply-preview");
  const { replyId } = parseReplyMessage(rawContent);
  if (!replyId) {
    preview.classList.add("is-hidden");
    preview.replaceChildren();
    return;
  }
  const target = messageRecords.get(replyId);
  const username = target?.profiles?.username || "Message";
  const text = target ? getMessagePreview(target.content) : "Original message is unavailable";
  preview.textContent = `Replying to ${username}: ${text}`;
  preview.classList.remove("is-hidden");
}

function setReplyTarget(messageEl) {
  const target = messageRecords.get(messageEl.dataset.messageId);
  if (!target) return;
  replyTargetId = String(target.id);
  chatReplyText.textContent = `Replying to ${target.profiles?.username || "Player"}: ${getMessagePreview(target.content)}`;
  chatReplyContext.classList.remove("is-hidden");
  document.getElementById("chatInput").focus();
}

function clearReplyTarget() {
  replyTargetId = null;
  chatReplyText.textContent = "";
  chatReplyContext.classList.add("is-hidden");
}

function startEditingMessage(messageEl) {
  if (messageEl.querySelector(".chat-message-editor")) return;
  const body = messageEl.querySelector(".chat-body");
  const originalContent = body.getAttribute("data-raw") || "";
  const parsedReply = parseReplyMessage(originalContent);
  const isGif = Boolean(parseGifMessage(parsedReply.content));
  const editor = document.createElement("textarea");
  editor.className = "chat-message-editor";
  editor.value = isGif ? "" : parsedReply.content;
  editor.dataset.replyId = parsedReply.replyId || "";
  editor.placeholder = isGif ? "Replace this GIF with a text message..." : "Edit your message...";
  editor.maxLength = 1000;
  editor.setAttribute("aria-label", "Edit chat message");

  const actions = document.createElement("div");
  actions.className = "chat-message-actions chat-message-edit-actions";
  actions.innerHTML = `
    <button type="button" data-message-action="save">Save</button>
    <button type="button" data-message-action="cancel">Cancel</button>
  `;
  body.replaceChildren(editor, actions);
  editor.focus();
  editor.setSelectionRange(editor.value.length, editor.value.length);
}

async function saveEditedMessage(messageEl) {
  const editor = messageEl.querySelector(".chat-message-editor");
  const editedContent = editor?.value.trim();
  const content = editor?.dataset.replyId
    ? `${REPLY_MESSAGE_PREFIX}${editor.dataset.replyId}|${editedContent}`
    : editedContent;
  if (!editedContent) {
    setGifSearchStatus("A message cannot be blank. Use Delete to remove it.");
    return;
  }

  const messageId = messageEl.dataset.messageId;
  const { data, error } = await _supabase
    .from("messages")
    .update({ content })
    .eq("id", messageId)
    .eq("user_id", currentChatUserId)
    .select("id, content")
    .maybeSingle();

  if (error || !data) {
    console.error("Error editing chat message:", error || "No message was updated.");
    setGifSearchStatus(`Could not edit message: ${error?.message || "No message was updated."}`);
    return;
  }
  updateMessageUI({ id: messageId, content: data.content });
  setGifSearchStatus("Message updated.");
}

async function deleteChatMessage(messageEl) {
  const messageId = messageEl.dataset.messageId;
  const { error: deleteError } = await _supabase
    .from("messages")
    .delete()
    .eq("id", messageId)
    .eq("user_id", currentChatUserId);

  if (deleteError) console.warn("Could not delete chat message directly; trying blank-content fallback.", deleteError.message);
  const { data: remainingMessage, error: verifyDeleteError } = await _supabase
    .from("messages")
    .select("id, content")
    .eq("id", messageId)
    .eq("user_id", currentChatUserId)
    .maybeSingle();

  if (verifyDeleteError) {
    console.error("Could not verify chat message deletion:", verifyDeleteError.message);
    setGifSearchStatus(`Could not verify message deletion: ${verifyDeleteError.message}`);
    return;
  }
  if (!remainingMessage) {
    removeMessageUI(messageId);
    setGifSearchStatus("Message deleted.");
    return;
  }

  const { error: blankError } = await _supabase
    .from("messages")
    .update({ content: "" })
    .eq("id", messageId)
    .eq("user_id", currentChatUserId);

  if (blankError) {
    console.error("Could not blank chat message:", blankError.message);
    setGifSearchStatus(`Could not delete message: ${blankError.message}`);
    return;
  }

  const { data: blankedMessage, error: verifyBlankError } = await _supabase
    .from("messages")
    .select("id, content")
    .eq("id", messageId)
    .eq("user_id", currentChatUserId)
    .maybeSingle();
  if (verifyBlankError || (blankedMessage && blankedMessage.content.trim() !== "")) {
    const reason = verifyBlankError?.message || "Supabase did not blank the message. Check the messages table UPDATE policy.";
    console.error("Could not confirm chat message deletion:", reason);
    setGifSearchStatus(`Could not delete message: ${reason}`);
    return;
  }
  removeMessageUI(messageId);
  setGifSearchStatus("Message deleted.");
  if (blankedMessage) cleanupBlankMessages();
}

async function cleanupBlankMessages(userId = null) {
  if (!userId) {
    const { data: { user }, error: authError } = await _supabase.auth.getUser();
    if (authError) {
      console.warn("Could not check the signed-in user for blank-message cleanup.", authError.message);
      return;
    }
    userId = user?.id || null;
  }
  if (!userId) return;
  const { error } = await _supabase
    .from("messages")
    .delete()
    .eq("user_id", userId)
    .eq("content", "");
  if (error) console.warn("Could not clean up blank chat messages.", error.message);
}

function parseGifMessage(content) {
  content = parseReplyMessage(content).content;
  const idPrefix = "gif:giphy:";
  if (content.startsWith(idPrefix)) {
    const id = content.slice(idPrefix.length);
    if (!/^[\w-]{1,100}$/.test(id)) return null;
    return {
      provider: "giphy",
      id,
      url: `https://media.giphy.com/media/${id}/giphy.gif`,
      pageUrl: `https://giphy.com/gifs/${id}`,
      alt: "GIF shared from GIPHY"
    };
  }

  if (!content.startsWith(GIF_MESSAGE_PREFIX)) return null;

  try {
    const gif = JSON.parse(content.slice(GIF_MESSAGE_PREFIX.length));
    if (
      gif?.provider !== "giphy" ||
      typeof gif.id !== "string" ||
      !/^[\w-]{1,100}$/.test(gif.id) ||
      !isGiphyMediaUrl(gif.url) ||
      !isGiphyPageUrl(gif.pageUrl)
    ) {
      return null;
    }
    return gif;
  } catch (error) {
    return null;
  }
}

function isGiphyMediaUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /^media\d*\.giphy\.com$/i.test(url.hostname);
  } catch (error) {
    return false;
  }
}

function isGiphyPageUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /^(www\.)?giphy\.com$/i.test(url.hostname);
  } catch (error) {
    return false;
  }
}

function renderChatMessageBody(bodyDiv, rawContent) {
  const content = parseReplyMessage(rawContent).content;
  const gif = parseGifMessage(content);
  bodyDiv.replaceChildren();

  if (gif) {
    const hideGifs = window.getAppSetting ? window.getAppSetting("chat", GIF_HIDE_SETTING, false) : false;
    if (hideGifs) {
      bodyDiv.textContent = "GIF hidden in settings";
      return;
    }

    const link = document.createElement("a");
    link.className = "chat-gif-link";
    link.href = gif.pageUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    const image = document.createElement("img");
    image.className = "chat-gif";
    image.src = gif.url;
    image.alt = typeof gif.alt === "string" ? gif.alt : "GIF shared from GIPHY";
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    link.appendChild(image);
    const attribution = document.createElement("span");
    attribution.className = "chat-gif-attribution";
    attribution.textContent = "Powered by GIPHY";
    link.appendChild(attribution);
    bodyDiv.appendChild(link);
    return;
  }

  bodyDiv.textContent = censoring ? censorSwearWords(content) : content;
}

function getChatMessagePreview(content) {
  return typeof content === "string" && parseGifMessage(content) ? "sent a GIF" : getMessagePreview(content);
}

function setGifSearchStatus(message) {
  gifSearchStatus.textContent = message;
}

function renderGifSearchResults(gifs) {
  gifSearchResults.replaceChildren();
  gifSearchResultById.clear();

  gifs.forEach(gif => {
    gifSearchResultById.set(gif.id, gif);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gif-search-result";
    button.dataset.gifId = gif.id;
    button.setAttribute("aria-label", `Send GIF: ${gif.alt}`);

    const image = document.createElement("img");
    image.src = gif.previewUrl;
    image.alt = gif.alt;
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    button.appendChild(image);
    gifSearchResults.appendChild(button);
  });
}

function renderGifSearchPagination() {
  gifSearchPagination.replaceChildren();
  gifSearchPagination.hidden = gifSearchPageCount <= 1;
  if (gifSearchPagination.hidden) return;

  const addPageButton = page => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gif-search-page";
    button.dataset.page = String(page);
    button.textContent = String(page);
    if (page === gifSearchPage) {
      button.disabled = true;
      button.setAttribute("aria-current", "page");
    } else {
      button.setAttribute("aria-label", `Go to GIF results page ${page}`);
    }
    gifSearchPagination.appendChild(button);
  };
  const addEllipsis = () => {
    const ellipsis = document.createElement("span");
    ellipsis.className = "gif-search-page-ellipsis";
    ellipsis.textContent = "\u2026";
    gifSearchPagination.appendChild(ellipsis);
  };

  addPageButton(1);
  const startPage = gifSearchPage <= 2
    ? 2
    : gifSearchPage >= gifSearchPageCount - 1
      ? gifSearchPageCount - 2
      : gifSearchPage - 1;
  const endPage = gifSearchPage <= 2
    ? Math.min(gifSearchPageCount - 1, 3)
    : gifSearchPage >= gifSearchPageCount - 1
      ? gifSearchPageCount - 1
      : gifSearchPage + 1;

  if (startPage > 2) addEllipsis();
  for (let page = startPage; page <= endPage; page++) addPageButton(page);
  if (endPage < gifSearchPageCount - 1) addEllipsis();
  if (gifSearchPageCount > 1) addPageButton(gifSearchPageCount);
}

async function searchGiphyGifs(event) {
  event.preventDefault();
  const query = gifSearchInput.value.trim();
  if (!query) {
    setGifSearchStatus("Enter a search term.");
    return;
  }

  gifSearchQuery = query;
  gifSearchPage = 1;
  await loadGiphyPage(gifSearchPage);
}

async function loadGiphyPage(page) {
  const apiKey = window.GIPHY_API_KEY;
  if (!apiKey || apiKey === "YOUR_GIPHY_API_KEY") {
    setGifSearchStatus("Add your GIPHY API key in js/giphy-config.js to enable search.");
    return;
  }

  if (!gifSearchQuery || !Number.isInteger(page) || page < 1) return;
  const requestId = ++gifSearchRequestId;
  gifSearchButton.disabled = true;
  gifSearchPagination.querySelectorAll("button").forEach(button => {
    button.disabled = true;
  });
  setGifSearchStatus("Searching GIPHY...");
  renderGifSearchResults([]);

  try {
    const params = new URLSearchParams({
      api_key: apiKey,
      q: gifSearchQuery,
      limit: String(GIF_SEARCH_PAGE_SIZE),
      offset: String((page - 1) * GIF_SEARCH_PAGE_SIZE),
      rating: "g",
      bundle: "messaging_non_clips"
    });
    const response = await fetch(`https://api.giphy.com/v1/gifs/search?${params}`);
    if (!response.ok) throw new Error(`GIPHY search failed (${response.status}).`);

    const result = await response.json();
    if (requestId !== gifSearchRequestId) return;
    const totalCount = Number(result.pagination?.total_count);
    gifSearchPageCount = Number.isFinite(totalCount) && totalCount > 0
      ? Math.ceil(totalCount / GIF_SEARCH_PAGE_SIZE)
      : 0;
    gifSearchPage = Math.min(page, Math.max(1, gifSearchPageCount));

    const gifs = (Array.isArray(result.data) ? result.data : []).flatMap(item => {
      const id = typeof item.id === "string" ? item.id : "";
      const media = item.images?.original?.url;
      const preview = item.images?.fixed_width?.url || item.images?.downsized?.url;
      const pageUrl = item.url;
      if (!/^[\w-]{1,100}$/.test(id) || !isGiphyMediaUrl(media) || !isGiphyMediaUrl(preview) || !isGiphyPageUrl(pageUrl)) {
        return [];
      }
      return [{
        id,
        url: media,
        previewUrl: preview,
        pageUrl,
        alt: typeof item.title === "string" && item.title ? item.title : "GIF from GIPHY"
      }];
    });
    renderGifSearchResults(gifs);
    renderGifSearchPagination();
    setGifSearchStatus(gifSearchPageCount
      ? `Page ${gifSearchPage} of ${gifSearchPageCount} \u00b7 ${totalCount} GIFs found. Select one to send it.`
      : "No GIFs found.");
  } catch (error) {
    if (requestId === gifSearchRequestId) {
      console.error("GIPHY search failed.", error);
      setGifSearchStatus(error.message || "GIPHY search failed. Please try again.");
    }
  } finally {
    if (requestId === gifSearchRequestId) {
      gifSearchButton.disabled = false;
      gifSearchPagination.querySelectorAll("button[data-page]").forEach(button => {
        button.disabled = button.dataset.page === String(gifSearchPage);
      });
    }
  }
}

async function sendGiphyGif(gif) {
  const channelId = activeChatChannelId;
  const { data: { user }, error: authError } = await _supabase.auth.getUser();
  if (authError) {
    console.error("Could not check chat sign-in status.", authError.message);
    setGifSearchStatus("Could not verify your sign-in. Please try again.");
    return;
  }
  if (!user) {
    setGifSearchStatus("Sign in to send GIFs.");
    return;
  }

  const content = encodeReplyContent(`gif:giphy:${gif.id}`);
  const message = { user_id: user.id, content };
  if (channelId) message.channel_id = channelId;
  const { error } = await _supabase.from('messages').insert([message]);
  if (error) {
    console.error("Error sending GIF:", error);
    setGifSearchStatus(`Could not send GIF: ${error.message || "Unknown database error"}`);
    return;
  }

  setGifSearchStatus("GIF sent.");
  clearReplyTarget();
  playSendIconAnimation();
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
    "andrew chiu", "andrewchiu", "chiu, andrew"
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
};

async function handleChatAuthChange(userId) {
  if (currentChatUserId === userId) return;
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
}

window.addEventListener("app-auth-state-changed", event => {
  if (chatInitialized) handleChatAuthChange(event.detail?.userId || null);
});

document.getElementById('sendChatBtn').addEventListener('click', sendMessage);
document.getElementById('chatInput').addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });
cancelChatReplyBtn.addEventListener("click", clearReplyTarget);
toggleGifPickerBtn.addEventListener("click", () => {
  const isExpanded = toggleGifPickerBtn.getAttribute("aria-expanded") === "true";
  toggleGifPickerBtn.setAttribute("aria-expanded", String(!isExpanded));
  chatOptionsBody.hidden = isExpanded;
  toggleGifPickerBtn.textContent = isExpanded ? "Show GIF picker" : "Minimize GIF picker";
});
gifSearchForm.addEventListener("submit", searchGiphyGifs);
gifSearchPagination.addEventListener("click", event => {
  const button = event.target.closest("button[data-page]");
  if (!button || button.disabled) return;
  loadGiphyPage(Number(button.dataset.page));
});
gifSearchResults.addEventListener("click", event => {
  const button = event.target.closest("button[data-gif-id]");
  const gif = button ? gifSearchResultById.get(button.dataset.gifId) : null;
  if (gif) sendGiphyGif(gif);
});
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
document.getElementById("chatMessages").addEventListener("click", event => {
  const actionButton = event.target.closest("button[data-message-action]");
  const messageEl = actionButton?.closest(".chat-msg");
  if (!actionButton || !messageEl) return;
  if (actionButton.dataset.messageAction !== "reply" && messageEl.dataset.userId !== currentChatUserId) return;

  switch (actionButton.dataset.messageAction) {
    case "reply":
      setReplyTarget(messageEl);
      break;
    case "toggle-actions": {
      const isOpen = messageEl.classList.toggle("has-actions-open");
      if (isOpen) {
        messageEl.querySelector('.chat-message-actions button[data-message-action="edit"]')?.focus();
      }
      break;
    }
    case "edit":
      startEditingMessage(messageEl);
      break;
    case "save":
      saveEditedMessage(messageEl);
      break;
    case "cancel":
      renderChatMessageBody(messageEl.querySelector(".chat-body"), messageEl.querySelector(".chat-body").dataset.raw || "");
      break;
    case "delete":
      deleteChatMessage(messageEl);
      break;
  }
});
if (!window.GIPHY_API_KEY || window.GIPHY_API_KEY === "YOUR_GIPHY_API_KEY") {
  setGifSearchStatus("Add your GIPHY API key in js/giphy-config.js to enable search.");
}