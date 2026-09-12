// 1. YOUR SUPABASE CREDENTIALS
const SUPABASE_URL = 'https://opjceioyxodjsmnkmipu.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_AngjLShSQFSj9qlj_jdFng_pgp4gGty';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const logEl = document.getElementById('log');
function printLog(msg) {
  let timestamp = `[${new Date().toLocaleTimeString()}] `;
  console.log(timestamp + msg);
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
  } else {
    document.getElementById('authSection').style.display = 'block';
    document.getElementById('profileSection').style.display = 'none';
    printLog("No user logged in (INITIAL_SESSION null). Fill form and click Sign Up.");
  }
});

// Helper: Detect Provider Badges & Password Capability
function updateAuthBadgesAndProviders(user) {
  const badgeEl = document.getElementById('authBadge');
  const addPwContainer = document.getElementById('addPasswordContainer');

  const providers = user.app_metadata?.providers || [];
  const hasGoogle = providers.includes('google');
  const hasEmail = providers.includes('email');

  // Reset badge classes
  badgeEl.classList.remove('badge-gmail', 'badge-google', 'badge-mail', 'btn-icon');
  badgeEl.classList.add('btn-icon');

  if (hasGoogle && hasEmail) {
    // google + email&pass
    badgeEl.classList.add('badge-gmail');
    addPwContainer.style.display = 'none';
    printLog("Provider Detected: Google + Password (badge-gmail)");
  } else if (hasGoogle) {
    // google. just google oauth
    badgeEl.classList.add('badge-google');
    addPwContainer.style.display = 'block';
    printLog("Provider Detected: Pure Google OAuth (badge-google)");
  } else {
    // email&pass
    badgeEl.classList.add('badge-mail');
    addPwContainer.style.display = 'none';
    printLog("Provider Detected: Standard Email (badge-mail)");
  }
}

// 3. SIGN UP FUNCTION
document.getElementById('signUpBtn').addEventListener('click', async () => {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const username = document.getElementById('username').value || 'Player_' + Math.floor(Math.random()*1000);
  const flair = document.getElementById('flair').value || 'Novice';

  if (!email || !password) {
    alert("Please enter an email and password!");
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
  } else {
    printLog("✅ Signup successful!");
  }
});

// 4. SIGN IN FUNCTION
document.getElementById('signInBtn').addEventListener('click', async () => {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  printLog("Logging in...");
  const { error } = await _supabase.auth.signInWithPassword({ email, password });
  if (error) printLog("❌ Login Error: " + error.message);
});

// GOOGLE SIGN IN
document.getElementById('googleSignInBtn').addEventListener('click', async () => {
  printLog("Redirecting to Google...");
  
  const { error } = await _supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + window.location.pathname
    }
  });

  if (error) printLog("❌ Google Auth Error: " + error.message);
});

// 5. FETCH PROFILE FROM DATABASE
async function fetchProfile(userId) {
  printLog("Fetching profile row from SQL table...");
  const { data, error } = await _supabase
    .from('profiles')
    .select('username, flair')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    printLog("❌ Database Query Error: " + error.message);
  } else if (!data) {
    printLog("⚠️ Connected, but profile row missing.");
  } else {
    document.getElementById('displayUsername').textContent = data.username;
    document.getElementById('displayFlair').textContent = data.flair;
    
    document.getElementById('editUsername').value = data.username || '';
    document.getElementById('editFlair').value = data.flair || '';
    
    printLog("✅ Profile loaded: " + JSON.stringify(data));
  }
}

// 6. UPDATE PROFILE FUNCTION
document.getElementById('updateProfileBtn').addEventListener('click', async () => {
  const { data: { user } } = await _supabase.auth.getUser();

  if (!user) {
    printLog("❌ Cannot update: No active user session.");
    return;
  }

  const newUsername = document.getElementById('editUsername').value;
  const newFlair = document.getElementById('editFlair').value;

  printLog("Updating profile in database...");
  
  const { error } = await _supabase
    .from('profiles')
    .update({
      username: newUsername,
      flair: newFlair
    })
    .eq('id', user.id);

  if (error) {
    printLog("❌ Update Error: " + error.message);
  } else {
    printLog("✅ Profile updated successfully!");
    await fetchProfile(user.id);
  }
});

// 7. ADD PASSWORD TO GOOGLE ACCOUNT
document.getElementById('addPasswordBtn')?.addEventListener('click', async () => {
  const newPassword = document.getElementById('newPasswordInput').value;

  if (!newPassword || newPassword.length < 6) {
    alert("Password must be at least 6 characters long.");
    return;
  }

  printLog("Adding password to account...");
  const { error } = await _supabase.auth.updateUser({ password: newPassword });

  if (error) {
    printLog("❌ Error adding password: " + error.message);
  } else {
    printLog("✅ Password attached! Your account can now sign in with Email + Password.");
    // Refresh user state to upgrade badge from badge-google to badge-gmail
    const { data: { user } } = await _supabase.auth.getUser();
    if (user) updateAuthBadgesAndProviders(user);
  }
});

// 8. DELETE ACCOUNT WITH PASSWORD CONFIRMATION
document.getElementById('deleteAccountBtn').addEventListener('click', async () => {
  const { data: { user } } = await _supabase.auth.getUser();
  if (!user) return;

  const password = prompt("⚠️ DELETING ACCOUNT: Enter your password to confirm deletion:");
  if (!password) {
    printLog("Account deletion cancelled.");
    return;
  }

  printLog("Verifying credentials before deletion...");
  
  // Re-authenticate user with entered password
  const { error: authError } = await _supabase.auth.signInWithPassword({
    email: user.email,
    password: password
  });

  if (authError) {
    alert("Incorrect password! Deletion aborted.");
    printLog("❌ Account deletion failed: Incorrect password.");
    return;
  }

  printLog("Password verified. Calling SQL RPC function to delete account...");

  // Call the database function to purge the user from auth.users and public.profiles
  const { error: rpcError } = await _supabase.rpc('delete_user_account');

  if (rpcError) {
    printLog("❌ Error deleting account: " + rpcError.message);
    return;
  }

  printLog("Account and profile row purged. Signing out...");
  await _supabase.auth.signOut();
  alert("Your account has been permanently deleted.");
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