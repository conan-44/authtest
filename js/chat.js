// REALTIME CHAT MODULE (Add to existing JS)

let realtimeChannel = null;
let currentChatUserId = null;
const censoringCheck = document.getElementById('censoringCheck');
let censoring = censoringCheck.checked;

// Toggle censoring directly on existing DOM elements
censoringCheck.addEventListener('change', () => {
  censoring = censoringCheck.checked;
  updateExistingMessagesCensoring();
});

function updateExistingMessagesCensoring() {
  const messageElements = document.querySelectorAll('#chatMessages .chat-msg');
  messageElements.forEach(div => {
    const contentDiv = div.querySelector('.chat-body');
    if (!contentDiv) return;
    
    const rawContent = contentDiv.getAttribute('data-raw');
    if (rawContent !== null) {
      contentDiv.textContent = censoring ? censorSwearWords(rawContent) : rawContent;
    }
  });
}

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
        const chatNotificationsCheck = document.getElementById('chatNotificationsCheck');
        if (chatNotificationsCheck.checked) showPopup(`${profile?.username || 'Player'}: ${payload.new.content}`, 'chat');
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
  
  const rawContent = msg.content || '';
  const displayContent = censoring ? censorSwearWords(rawContent) : rawContent;
  
  const isOwn = msg.user_id && msg.user_id === currentChatUserId;
  div.className = `chat-msg ${isOwn ? 'chat-msg-own' : 'chat-msg-other'}`;

  const username = escapeHTML(msg.profiles?.username || 'Player');
  const flair = msg.profiles?.flair ? `<span class="chat-flair">${escapeHTML(msg.profiles.flair)}</span>` : '';
  const timestamp = msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  // Use a dedicated .chat-body wrapper with data-raw storing unescaped/uncensored raw text
  div.innerHTML = `<div class="chat-header">${username}${flair}<span class="chat-timestamp">${timestamp}</span></div><div class="chat-body"></div>`;
  
  const bodyDiv = div.querySelector('.chat-body');
  bodyDiv.setAttribute('data-raw', rawContent);
  bodyDiv.textContent = displayContent; // textContent handles escaping automatically

  container.appendChild(div);
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
    "pussy", "cunt", "cock", "suck", "nigga", "nigger", "fag"
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
    const suffixPattern = `(?:[\\s*#x!_\\-$%^&]*[a-zA-Z0-9]+)*`;
    return `${corePattern}${suffixPattern}`;
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
  await fetchChatHistory();
  initRealtimeChat();
};

document.getElementById('sendChatBtn').addEventListener('click', sendMessage);
document.getElementById('chatInput').addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });