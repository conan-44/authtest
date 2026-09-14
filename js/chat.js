// REALTIME CHAT MODULE (Add to existing JS)

let realtimeChannel = null;
let currentChatUserId = null;

// 1. CHAT HISTORY
async function fetchChatHistory() {
  const { data, error } = await _supabase
    .from('messages')
    .select(`id, content, created_at, user_id, profiles(username, flair)`)
    .order('created_at', { ascending: true })
    .limit(50);

  if (error) return console.error("Error loading chat:", error.message);

  const container = document.getElementById('chatMessages');
  container.innerHTML = '';
  data.forEach(msg => appendMessageUI(msg));
  scrollToBottom();
}

// 2. REALTIME LISTENER
function initRealtimeChat() {
  realtimeChannel = _supabase
    .channel('public:messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
      const { data: profile } = await _supabase
        .from('profiles')
        .select('username, flair')
        .eq('id', payload.new.user_id)
        .single();

      appendMessageUI({ ...payload.new, profiles: profile });
      scrollToBottom();

      if (chatPanel.classList.contains('is-hidden') && typeof showPopup === "function") {
        showPopup(`${profile?.username || 'Player'}: ${payload.new.content}`, 'chat');
      }
    })
    .subscribe();
}

// 3. SEND MESSAGE
async function sendMessage() {
  const input = document.getElementById('chatInput');
  const content = input.value.trim();
  if (!content) return;

  playSendIconAnimation();

  const { data: { user } } = await _supabase.auth.getUser();
  if (!user) return;

  input.value = '';
  const { error } = await _supabase.from('messages').insert([{ user_id: user.id, content }]);
  if (error) console.error("Error sending message:", error.message);
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
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  const isOwn = msg.user_id && msg.user_id === currentChatUserId;
  div.className = `chat-msg ${isOwn ? 'chat-msg-own' : 'chat-msg-other'}`;

  const username = escapeHTML(msg.profiles?.username || 'Player');
  const flair = msg.profiles?.flair ? `<span class="chat-flair">${escapeHTML(msg.profiles.flair)}</span>` : '';
  const timestamp = msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  div.innerHTML = `<div class="chat-header">${username}${flair}<span class="chat-timestamp">${timestamp}</span></div><div>${escapeHTML(msg.content)}</div>`;
  container.appendChild(div);
}

function scrollToBottom() {
  const container = document.getElementById('chatMessages');
  container.scrollTop = container.scrollHeight;
}

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}

// 5. PANEL TOGGLE (swaps achievements panel for chat panel)
let chatInitialized = false;
const achievementsPanel = document.getElementById('achievementsPanel');
const chatPanel = document.getElementById('chatPanel');

async function openChatPanel() {
  achievementsPanel.classList.add('is-hidden');
  chatPanel.classList.remove('is-hidden');
  if (!chatInitialized) {
    chatInitialized = true;
    const { data: { user } } = await _supabase.auth.getUser();
    currentChatUserId = user?.id || null;
    await fetchChatHistory();
    initRealtimeChat();
  }
}

function closeChatPanel() {
  chatPanel.classList.add('is-hidden');
  achievementsPanel.classList.remove('is-hidden');
}

document.getElementById('toggleChatBtn').addEventListener('click', openChatPanel);
document.getElementById('toggleAchievementsBtn').addEventListener('click', closeChatPanel);
document.getElementById('sendChatBtn').addEventListener('click', sendMessage);
document.getElementById('chatInput').addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });