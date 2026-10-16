// Core chat state, history, realtime updates, and initialization.
let realtimeChannel = null;
let currentChatUserId = null;
let chatHistoryRequestId = 0;
let censoring = true;
let blankMessageCleanupInterval = null;
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
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_room_first_joins' }, (payload) => {
      if (payload.new.room_key !== (activeChatChannelId || "global")) return;
      appendChatJoinNotice(payload.new);
    })
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
  await recordChatRoomFirstJoin();
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
  await recordChatRoomFirstJoin();
}

window.addEventListener("app-auth-state-changed", event => {
  if (chatInitialized) handleChatAuthChange(event.detail?.userId || null);
});

document.getElementById('sendChatBtn').addEventListener('click', sendMessage);
document.getElementById('chatInput').addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });
