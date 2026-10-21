// 1. YOUR SUPABASE CREDENTIALS
const SUPABASE_URL = 'https://opjceioyxodjsmnkmipu.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_AngjLShSQFSj9qlj_jdFng_pgp4gGty';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const logEl = document.getElementById('log');
function printLog(msg) {
  let timestamp = `[${new Date().toLocaleTimeString()}] `;
  console.log(timestamp + msg);
}

const AUTH_ASSET_ROOT = new URL('../assets/audio/', document.currentScript?.src || window.location.href);
const NOTIFICATION_SOUNDS = {
  error: new URL('error.wav', AUTH_ASSET_ROOT).href,
  success: new URL('success.wav', AUTH_ASSET_ROOT).href,
  warning: new URL('warn.wav', AUTH_ASSET_ROOT).href,
  warn: new URL('warn.wav', AUTH_ASSET_ROOT).href,
  info: new URL('info.wav', AUTH_ASSET_ROOT).href
};
const notificationAudio = new Map();
let notificationAudioUnlocked = false;

function unlockNotificationAudio() {
  if (notificationAudioUnlocked) return;
  notificationAudioUnlocked = true;
  Object.values(NOTIFICATION_SOUNDS).forEach(soundPath => {
    if (notificationAudio.has(soundPath)) return;
    const audio = new Audio(soundPath);
    audio.muted = true;
    audio.load();
    audio.play().then(() => {
      audio.pause();
      audio.currentTime = 0;
    }).catch(() => {});
    notificationAudio.set(soundPath, audio);
  });
}

document.addEventListener('pointerdown', unlockNotificationAudio, { once: true, capture: true });
document.addEventListener('keydown', unlockNotificationAudio, { once: true, capture: true });

function playNotificationSound(type, isStacked = false) {
  if (window.getAppSetting && !window.getAppSetting('audio', 'sound effects', true)) return;
  const soundPath = NOTIFICATION_SOUNDS[type] || NOTIFICATION_SOUNDS.info;
  const play = () => {
    const audio = notificationAudio.get(soundPath) || new Audio(soundPath);
    notificationAudio.set(soundPath, audio);
    audio.muted = false;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  };

  if (isStacked) {
    setTimeout(play, 200);
  } else {
    play();
  }
}

function dismissPopup(popup) {
  if (!popup || popup.classList.contains('notification-out')) return;
  popup.classList.add('notification-out');
  let removed = false;
  const onEnd = () => {
    if (removed) return;
    removed = true;
    const stack = popup.parentElement;
    popup.remove();
    if (stack && !stack.children.length) stack.remove();
  };
  popup.addEventListener('animationend', onEnd, { once: true });
  setTimeout(onEnd, 320);
}

function showPopup(message, type = 'info') {
  let stack = document.querySelector('.notification-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'notification-stack';
    document.body.appendChild(stack);
  }

  const existingPopup = [...stack.querySelectorAll('.notification:not(.notification-out)')].find((popup) => (
    popup.dataset.message === message && popup.dataset.type === type
  ));

  const hasExistingPopups = stack.querySelectorAll('.notification:not(.notification-out)').length > 0;

  if (existingPopup) {
    const count = Math.min(Number(existingPopup.dataset.count || 1) + 1, 9);
    existingPopup.dataset.count = count;

    const counter = existingPopup.querySelector('.notification-count');
    counter.textContent = `(${count === 9 ? '9+' : count})`;
    counter.classList.add('notification-count-visible');

    playNotificationSound(type, true);

    clearTimeout(existingPopup.dismissTimer);
    existingPopup.dismissTimer = setTimeout(() => {
      dismissPopup(existingPopup);
    }, 4000);
    return;
  }

  const popup = document.createElement('div');
  popup.className = `notification notification-${type}`;
  popup.setAttribute('role', 'status');
  popup.dataset.message = message;
  popup.dataset.type = type;
  popup.dataset.count = '1';

  const label = document.createElement('span');
  const labelType = ['error', 'success', 'warning', 'info', 'achievement', 'chat', 'music'].includes(type)
    ? (type === 'warning' ? 'warn' : type)
    : 'info';
  label.className = `notification-label label-${labelType}`;
  label.setAttribute('aria-hidden', 'true');

  const text = document.createElement('span');
  text.className = 'notification-text';
  text.textContent = message;

  const counter = document.createElement('span');
  counter.className = 'notification-count';
  counter.setAttribute('aria-hidden', 'true');

  popup.append(label, text, counter);
  stack.appendChild(popup);

  playNotificationSound(type, hasExistingPopups);

  popup.dismissTimer = setTimeout(() => {
    dismissPopup(popup);
  }, 4000);
}

function showInputPopup(message, inputType = 'text') {
  return new Promise((resolve) => {
    let stack = document.querySelector('.notification-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'notification-stack';
      document.body.appendChild(stack);
    }

    const hasExistingPopups = stack.querySelectorAll('.notification:not(.notification-out)').length > 0;
    playNotificationSound('warning', hasExistingPopups);

    const popup = document.createElement('div');
    popup.className = 'notification notification-warning input-popup';

    const notificationLabel = document.createElement('span');
    notificationLabel.className = 'notification-label label-warn';
    notificationLabel.setAttribute('aria-hidden', 'true');

    const label = document.createElement('label');
    label.textContent = message;

    const messageRow = document.createElement('div');
    messageRow.className = 'input-popup-message';
    messageRow.append(notificationLabel, label);

    const input = document.createElement('input');
    input.type = inputType;
    input.autocomplete = 'current-password';

    const actions = document.createElement('div');
    actions.className = 'input-popup-actions';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = 'Cancel';

    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.textContent = 'Confirm';

    const close = (value) => {
      dismissPopup(popup);
      resolve(value);
    };

    cancelButton.addEventListener('click', () => close(null));
    confirmButton.addEventListener('click', () => close(input.value));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') close(input.value);
      if (event.key === 'Escape') close(null);
    });

    actions.append(cancelButton, confirmButton);
    popup.append(messageRow, input, actions);
    stack.appendChild(popup);
    input.focus();
  });
}

// 2. LISTEN FOR AUTH CHANGES
_supabase.auth.onAuthStateChange(async (event, session) => {
  printLog(`Auth Event: ${event}`);
  
  if (session) {
    document.getElementById('authSection').style.display = 'none';
    document.getElementById('profileSection').style.display = 'block';
    
    // Evaluate providers & badge state
    updateAuthBadgesAndProviders(session.user);

    await fetchProfile(session.user.id);
    if (typeof window.setTabsGuestMode === "function") window.setTabsGuestMode(false);
  } else {
    document.getElementById('authSection').style.display = 'block';
    document.getElementById('profileSection').style.display = 'none';
    printLog("No user logged in (INITIAL_SESSION null). Fill form and click Sign Up.");
    showPopup("Sign in or create an account to start!", 'info');
    if (typeof window.setTabsGuestMode === "function") window.setTabsGuestMode(true);
    if (typeof realtimeChannel !== 'undefined' && realtimeChannel) {
      _supabase.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
  }

  window.dispatchEvent(new CustomEvent("app-auth-state-changed", {
    detail: { userId: session?.user?.id || null }
  }));
});

// Detect linked sign-in providers and whether the account can add a password.
function updateAuthBadgesAndProviders(user) {
  const addPwContainer = document.getElementById('addPasswordContainer');

  const providers = user.app_metadata?.providers || [];
  const hasGoogle = providers.includes('google');
  const hasEmail = providers.includes('email');

  if (hasGoogle && hasEmail) {
    addPwContainer.style.display = 'none';
    printLog("Provider Detected: Google and email sign-in");
  } else if (hasGoogle) {
    addPwContainer.style.display = 'block';
    printLog("Provider Detected: Google sign-in");
  } else {
    addPwContainer.style.display = 'none';
    printLog("Provider Detected: Email sign-in");
  }
}

function renderAccountProfileAvatar(avatar, username) {
  const canvas = document.getElementById('authProfileAvatar');
  canvas.alt = `${username || 'Player'}'s profile picture`;
  if (!avatar || window.ProfileAvatars.isDefault(avatar)) {
    canvas.src = './assets/profile.png';
    return;
  }
  const decoded = window.ProfileAvatars.decode(avatar);
  if (decoded) {
    const renderer = document.createElement('canvas');
    if (!window.ProfileAvatars.draw(renderer, avatar)) {
      canvas.src = './assets/profile.png';
      return;
    }
    canvas.src = renderer.toDataURL('image/png');
    return;
  }
  canvas.src = './assets/profile.png';
}

// 3. SIGN UP FUNCTION
document.getElementById('signUpBtn').addEventListener('click', async () => {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const username = document.getElementById('username').value || 'Player_' + Math.floor(Math.random()*1000);
  const flair = document.getElementById('flair').value || 'Novice';

  if (!email || !password) {
    showPopup("Please enter an email and password!", 'error');
    return;
  }

  printLog("Sending signup request...");
  const { data, error } = await _supabase.auth.signUp({
    email: email,
    password: password,
    options: {
      data: { username: username, flair: flair }
    }
  });

  if (error) {
    printLog("❌ Signup Error: " + error.message);
    showPopup("Signup failed ", 'error');
  } else {
    printLog("✅ Signup successful!");
    showPopup("Created new account!", 'success');
  }
});

// 4. SIGN IN FUNCTION
document.getElementById('signInBtn').addEventListener('click', async () => {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  printLog("Logging in...");
  showPopup("Logging in...", 'info');
  const { error } = await _supabase.auth.signInWithPassword({ email, password });
  if (error) {
    printLog("❌ Login Error: " + error.message);
    showPopup("Login failed ",  'error');
  } else {
    showPopup("Logged in successfully!", 'success');
  }
});

// GOOGLE SIGN IN
document.getElementById('googleSignInBtn').addEventListener('click', async () => {
  printLog("Redirecting to Google...");
  showPopup("Redirecting to Google...", 'info');
  
  const { error } = await _supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + window.location.pathname
    }
  });

  if (error) printLog("❌ Google Auth Error: " + error.message);
});

// 5. FETCH PROFILE FROM DATABASE
const PROFILE_AVATAR_DEFAULT_PALETTE = window.ProfileAvatars.defaultPalette;
const profileAvatarCanvas = document.getElementById('profileAvatarCanvas');
const profileAvatarPaletteEl = document.getElementById('profileAvatarPalette');
const profileAvatarStatus = document.getElementById('profileAvatarStatus');
const profileAvatarSizeSelect = document.getElementById('profileAvatarSize');
let profileAvatarSize = 16;
let profileAvatarPalette = PROFILE_AVATAR_DEFAULT_PALETTE.slice(0, 8);
let profileAvatarPixels = new Uint8Array(profileAvatarSize * profileAvatarSize);
let activeProfileAvatarColor = 0;
let paintingProfileAvatar = false;
let profileAvatarTool = 'pencil';
const profileAvatarPencilBtn = document.getElementById('profileAvatarPencilBtn');
const profileAvatarFillBtn = document.getElementById('profileAvatarFillBtn');
const settingsWorkspace = document.getElementById('settingsWorkspace');
const profileAvatarView = document.getElementById('profileAvatarView');
const openProfileAvatarEditorBtn = document.getElementById('openProfileAvatarEditorBtn');
const profileAvatarBackBtn = document.getElementById('profileAvatarBackBtn');

function setProfileAvatarTool(tool) {
  profileAvatarTool = tool;
  profileAvatarPencilBtn.setAttribute('aria-pressed', String(tool === 'pencil'));
  profileAvatarFillBtn.setAttribute('aria-pressed', String(tool === 'fill'));
  profileAvatarCanvas.dataset.tool = tool;
}

function openProfileAvatarEditor() {
  settingsWorkspace.classList.add('is-hidden');
  profileAvatarView.classList.remove('is-hidden');
  profileAvatarBackBtn.focus();
}

function closeProfileAvatarEditor() {
  profileAvatarView.classList.add('is-hidden');
  settingsWorkspace.classList.remove('is-hidden');
  openProfileAvatarEditorBtn.focus();
}

function drawProfileAvatarEditor() {
  const encoded = window.ProfileAvatars.encode(profileAvatarSize, profileAvatarPalette, profileAvatarPixels);
  window.ProfileAvatars.draw(profileAvatarCanvas, encoded);
}

function getPaletteLimit(size) {
  return window.ProfileAvatars.paletteLimits[size];
}

function colorDistance(first, second) {
  const firstChannels = first.slice(1).match(/.{2}/g).map(channel => parseInt(channel, 16));
  const secondChannels = second.slice(1).match(/.{2}/g).map(channel => parseInt(channel, 16));
  return firstChannels.reduce((distance, channel, index) => distance + (channel - secondChannels[index]) ** 2, 0);
}

function resizeProfileAvatar(nextSize) {
  if (nextSize === profileAvatarSize) return;
  const previousSize = profileAvatarSize;
  const previousPalette = profileAvatarPalette;
  const previousPixels = profileAvatarPixels;
  const nextPaletteLimit = getPaletteLimit(nextSize);
  const nextPalette = PROFILE_AVATAR_DEFAULT_PALETTE.slice(0, nextPaletteLimit);
  previousPalette.slice(0, nextPaletteLimit).forEach((color, index) => {
    nextPalette[index] = color;
  });

  const nextPixels = new Uint8Array(nextSize * nextSize);
  for (let y = 0; y < nextSize; y += 1) {
    for (let x = 0; x < nextSize; x += 1) {
      const sourceX = Math.min(previousSize - 1, Math.floor((x + 0.5) * previousSize / nextSize));
      const sourceY = Math.min(previousSize - 1, Math.floor((y + 0.5) * previousSize / nextSize));
      const sourceColorIndex = previousPixels[sourceY * previousSize + sourceX];
      const sourceColor = previousPalette[sourceColorIndex];
      if (sourceColorIndex < nextPaletteLimit) {
        nextPixels[y * nextSize + x] = sourceColorIndex;
        continue;
      }
      let nearestIndex = 0;
      for (let paletteIndex = 1; paletteIndex < nextPaletteLimit; paletteIndex += 1) {
        if (colorDistance(sourceColor, nextPalette[paletteIndex])
          < colorDistance(sourceColor, nextPalette[nearestIndex])) {
          nearestIndex = paletteIndex;
        }
      }
      nextPixels[y * nextSize + x] = nearestIndex;
    }
  }

  profileAvatarSize = nextSize;
  profileAvatarPalette = nextPalette;
  profileAvatarPixels = nextPixels;
  profileAvatarCanvas.width = nextSize;
  profileAvatarCanvas.height = nextSize;
  activeProfileAvatarColor = 0;
  initializeProfileAvatarPalette();
  drawProfileAvatarEditor();
  profileAvatarStatus.textContent = `Resized to ${nextSize}×${nextSize}. Save to apply the change.`;
}

function selectProfileAvatarColor(index) {
  activeProfileAvatarColor = index;
  profileAvatarPaletteEl.querySelectorAll('.profile-avatar-color-select').forEach((button, buttonIndex) => {
    button.setAttribute('aria-pressed', String(buttonIndex === index));
  });
}

function initializeProfileAvatarPalette() {
  profileAvatarPaletteEl.replaceChildren();
  profileAvatarPalette.forEach((color, index) => {
    const slot = document.createElement('div');
    slot.className = 'profile-avatar-color-slot';
    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'profile-avatar-color-select';
    select.setAttribute('aria-label', `Select color ${index + 1}`);
    select.setAttribute('aria-pressed', String(index === activeProfileAvatarColor));
    const preview = document.createElement('span');
    preview.className = 'profile-avatar-color-preview';
    preview.style.backgroundColor = color;
    select.appendChild(preview);
    select.addEventListener('click', () => selectProfileAvatarColor(index));

    const input = document.createElement('input');
    input.type = 'color';
    input.value = color;
    input.setAttribute('aria-label', `Change color ${index + 1}`);
    input.addEventListener('input', () => {
      profileAvatarPalette[index] = input.value;
      preview.style.backgroundColor = input.value;
      drawProfileAvatarEditor();
    });
    slot.append(select, input);
    profileAvatarPaletteEl.appendChild(slot);
  });
}

function loadProfileAvatarEditor(avatar) {
  profileAvatarSize = 16;
  profileAvatarPalette = PROFILE_AVATAR_DEFAULT_PALETTE.slice(0, 8);
  profileAvatarPixels = new Uint8Array(profileAvatarSize * profileAvatarSize);
  const decoded = window.ProfileAvatars.decode(avatar);
  if (avatar && decoded) {
    profileAvatarSize = decoded.size;
    profileAvatarPalette = decoded.palette;
    profileAvatarPixels = decoded.pixels;
    profileAvatarStatus.textContent = `Loaded saved ${decoded.size}×${decoded.size} profile picture.`;
  } else {
    profileAvatarStatus.textContent = avatar
      ? 'Saved picture was invalid; edit and save a new one.'
      : 'Draw a 16×16 picture using up to eight colors.';
    if (avatar) console.warn('Could not load the saved profile picture.', avatar);
  }
  profileAvatarSizeSelect.value = String(profileAvatarSize);
  profileAvatarCanvas.width = profileAvatarSize;
  profileAvatarCanvas.height = profileAvatarSize;
  activeProfileAvatarColor = 0;
  initializeProfileAvatarPalette();
  drawProfileAvatarEditor();
}

function paintProfileAvatar(event) {
  const bounds = profileAvatarCanvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - bounds.left - profileAvatarCanvas.clientLeft) * profileAvatarSize / profileAvatarCanvas.clientWidth);
  const y = Math.floor((event.clientY - bounds.top - profileAvatarCanvas.clientTop) * profileAvatarSize / profileAvatarCanvas.clientHeight);
  if (x < 0 || x >= profileAvatarSize || y < 0 || y >= profileAvatarSize) return;
  const startIndex = y * profileAvatarSize + x;
  if (profileAvatarTool === 'fill') {
    fillProfileAvatar(startIndex);
    return;
  }
  profileAvatarPixels[startIndex] = activeProfileAvatarColor;
  drawProfileAvatarEditor();
}

function fillProfileAvatar(startIndex) {
  const targetColor = profileAvatarPixels[startIndex];
  if (targetColor === activeProfileAvatarColor) return;

  const pending = new Uint16Array(profileAvatarPixels.length);
  let readIndex = 0;
  let writeIndex = 1;
  pending[0] = startIndex;
  profileAvatarPixels[startIndex] = activeProfileAvatarColor;

  while (readIndex < writeIndex) {
    const index = pending[readIndex++];
    const x = index % 16;
    const neighbors = [];
    if (x > 0) neighbors.push(index - 1);
    if (x < profileAvatarSize - 1) neighbors.push(index + 1);
    if (index >= profileAvatarSize) neighbors.push(index - profileAvatarSize);
    if (index < profileAvatarSize * (profileAvatarSize - 1)) neighbors.push(index + profileAvatarSize);

    neighbors.forEach(neighbor => {
      if (profileAvatarPixels[neighbor] !== targetColor) return;
      profileAvatarPixels[neighbor] = activeProfileAvatarColor;
      pending[writeIndex++] = neighbor;
    });
  }
  drawProfileAvatarEditor();
}

profileAvatarCanvas.addEventListener('pointerdown', event => {
  if (profileAvatarTool === 'fill') {
    paintProfileAvatar(event);
    return;
  }
  paintingProfileAvatar = true;
  profileAvatarCanvas.setPointerCapture(event.pointerId);
  paintProfileAvatar(event);
});
profileAvatarCanvas.addEventListener('pointermove', event => {
  if (paintingProfileAvatar) paintProfileAvatar(event);
});
profileAvatarCanvas.addEventListener('pointerup', () => {
  paintingProfileAvatar = false;
});
profileAvatarCanvas.addEventListener('pointercancel', () => {
  paintingProfileAvatar = false;
});
profileAvatarPencilBtn.addEventListener('click', () => setProfileAvatarTool('pencil'));
profileAvatarFillBtn.addEventListener('click', () => setProfileAvatarTool('fill'));
profileAvatarSizeSelect.addEventListener('change', () => resizeProfileAvatar(Number(profileAvatarSizeSelect.value)));
openProfileAvatarEditorBtn.addEventListener('click', openProfileAvatarEditor);
profileAvatarBackBtn.addEventListener('click', closeProfileAvatarEditor);
setProfileAvatarTool('pencil');
initializeProfileAvatarPalette();
drawProfileAvatarEditor();

async function fetchProfile(userId) {
  printLog("Fetching profile row from SQL table...");
  const { data, error } = await _supabase
    .from('profiles')
    .select('username, flair, avatar')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    printLog("❌ Database Query Error: " + error.message);
  } else if (!data) {
    printLog("⚠️ Connected, but profile row missing.");
    showPopup("Could not load some data", 'warning');
  } else {
    document.getElementById('displayUsername').textContent = data.username;
    document.getElementById('displayFlair').textContent = data.flair;
    renderAccountProfileAvatar(data.avatar, data.username);
    
    document.getElementById('editUsername').value = data.username || '';
    document.getElementById('editFlair').value = data.flair || '';
    loadProfileAvatarEditor(data.avatar);
    
    printLog("✅ Profile loaded: " + JSON.stringify(data));
    showPopup("All data was loaded successfully", 'success');
  }
}

// 6. UPDATE PROFILE FUNCTION
document.getElementById('updateProfileBtn').addEventListener('click', async () => {
  const { data: { user } } = await _supabase.auth.getUser();

  if (!user) {
    printLog("❌ Cannot update: No active user session.");
    showPopup("Update failed", 'error');
    return;
  }

  const newUsername = document.getElementById('editUsername').value;
  const newFlair = document.getElementById('editFlair').value;

  printLog("Updating profile in database...");
  showPopup("Updating profile...", 'info');
  
  const { error } = await _supabase
    .from('profiles')
    .update({
      username: newUsername,
      flair: newFlair
    })
    .eq('id', user.id);

  if (error) {
    printLog("❌ Update Error: " + error.message);
    showPopup("Update failed", 'error');
  } else {
    printLog("✅ Profile updated successfully!");
    showPopup("Saved profile data", 'success');
    await fetchProfile(user.id);
  }
});

document.getElementById('saveProfileAvatarBtn').addEventListener('click', async () => {
  const button = document.getElementById('saveProfileAvatarBtn');
  button.disabled = true;
  try {
    const { data: { user }, error: authError } = await _supabase.auth.getUser();
    if (authError) throw authError;
    if (!user) throw new Error('Sign in before saving a profile picture.');
    const avatar = window.ProfileAvatars.encode(profileAvatarSize, profileAvatarPalette, profileAvatarPixels);
    const { error } = await _supabase
      .from('profiles')
      .update({ avatar })
      .eq('id', user.id);
    if (error) throw error;
    renderAccountProfileAvatar(avatar, document.getElementById('displayUsername').textContent);
    profileAvatarStatus.textContent = 'Profile picture saved.';
    showPopup('Profile picture saved.', 'success');
  } catch (error) {
    console.error('Could not save the profile picture.', error);
    profileAvatarStatus.textContent = 'Could not save the profile picture.';
    showPopup(error.message || 'Could not save the profile picture.', 'error');
  } finally {
    button.disabled = false;
  }
});

document.getElementById('clearProfileAvatarBtn').addEventListener('click', async () => {
  const button = document.getElementById('clearProfileAvatarBtn');
  button.disabled = true;
  try {
    const { data: { user }, error: authError } = await _supabase.auth.getUser();
    if (authError) throw authError;
    if (!user) throw new Error('Sign in before removing a profile picture.');
    const { error } = await _supabase
      .from('profiles')
      .update({ avatar: null })
      .eq('id', user.id);
    if (error) throw error;
    loadProfileAvatarEditor(null);
    renderAccountProfileAvatar(null, document.getElementById('displayUsername').textContent);
    profileAvatarStatus.textContent = 'Profile picture removed.';
    showPopup('Profile picture removed.', 'success');
  } catch (error) {
    console.error('Could not remove the profile picture.', error);
    profileAvatarStatus.textContent = 'Could not remove the profile picture.';
    showPopup(error.message || 'Could not remove the profile picture.', 'error');
  } finally {
    button.disabled = false;
  }
});

// 7. ADD PASSWORD TO GOOGLE ACCOUNT
document.getElementById('addPasswordBtn')?.addEventListener('click', async () => {
  const newPassword = document.getElementById('newPasswordInput').value;

  if (!newPassword || newPassword.length < 6) {
    showPopup("Password must be at least 6 characters long.", 'warning');
    return;
  }

  printLog("Adding password to account...");
  const { error } = await _supabase.auth.updateUser({ password: newPassword });

  if (error) {
    printLog("❌ Error adding password: " + error.message);
    showPopup("Failed to add password", 'error');
  } else {
    printLog("✅ Password attached! Your account can now sign in with Email + Password.");
    showPopup("Password added successfully", 'success');
    // Refresh provider state after adding email/password sign-in.
    const { data: { user } } = await _supabase.auth.getUser();
    if (user) updateAuthBadgesAndProviders(user);
  }
});

// 8. DELETE ACCOUNT WITH PASSWORD CONFIRMATION
document.getElementById('deleteAccountBtn').addEventListener('click', async () => {
  const { data: { user } } = await _supabase.auth.getUser();
  if (!user) return;

  const password = await showInputPopup("Enter your password to confirm account deletion:", 'password');
  if (!password) {
    printLog("Account deletion cancelled.");
    showPopup("Account deletion cancelled", 'info');
    return;
  }

  printLog("Verifying credentials before deletion...");
  
  // Re-authenticate user with entered password
  const { error: authError } = await _supabase.auth.signInWithPassword({
    email: user.email,
    password: password
  });

  if (authError) {
    showPopup("Incorrect password! Deletion aborted.", 'error');
    printLog("❌ Account deletion failed: Incorrect password.");
    return;
  }

  printLog("Password verified. Calling SQL RPC function to delete account...");

  // Call the database function to purge the user from auth.users and public.profiles
  const { error: rpcError } = await _supabase.rpc('delete_user_account');

  if (rpcError) {
    printLog("❌ Error deleting account: " + rpcError.message);
    showPopup("Failed to delete account", 'error');
    return;
  }

  printLog("Account and profile row purged. Signing out...");
  await _supabase.auth.signOut();
  showPopup("Your account has been permanently deleted.", 'success');

});

// 9. OTHER UTILITY LISTENERS
document.getElementById('signOutBtn').addEventListener('click', () => _supabase.auth.signOut());
document.getElementById('refreshBtn').addEventListener('click', async () => {
  const { data: { user } } = await _supabase.auth.getUser();
  if (user) await fetchProfile(user.id);
});

const pressedButtonTimers = new WeakMap();
document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;

  clearTimeout(pressedButtonTimers.get(button));
  button.classList.add('button-pressed');
  pressedButtonTimers.set(button, setTimeout(() => {
    button.classList.remove('button-pressed');
    pressedButtonTimers.delete(button);
  }, 420));
});