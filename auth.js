// 1. YOUR SUPABASE CREDENTIALS
    const SUPABASE_URL = 'https://opjceioyxodjsmnkmipu.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_AngjLShSQFSj9qlj_jdFng_pgp4gGty';
    const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const logEl = document.getElementById('log');
    function printLog(msg) {
      logEl.textContent = `[${new Date().toLocaleTimeString()}] ${msg}\n` + logEl.textContent;
      console.log(msg);
    }

    // 2. LISTEN FOR AUTH CHANGES
    _supabase.auth.onAuthStateChange(async (event, session) => {
      printLog(`Auth Event: ${event}`);
      
      if (session) {
        document.getElementById('authSection').style.display = 'none';
        document.getElementById('profileSection').style.display = 'block';
        document.getElementById('displayEmail').textContent = session.user.email;
        
        await fetchProfile(session.user.id);
      } else {
        document.getElementById('authSection').style.display = 'block';
        document.getElementById('profileSection').style.display = 'none';
        printLog("No user logged in (INITIAL_SESSION null). Fill form and click Sign Up.");
      }
    });

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
      } else if (data.user && !data.session) {
        printLog("son");
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
        
        // Auto-fill edit inputs with current profile data
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
        // Re-fetch to update display values
        await fetchProfile(user.id);
      }
    });

    // 7. BUTTON EVENT LISTENERS
    document.getElementById('signOutBtn').addEventListener('click', () => _supabase.auth.signOut());
    document.getElementById('refreshBtn').addEventListener('click', async () => {
      const { data: { user } } = await _supabase.auth.getUser();
      if (user) await fetchProfile(user.id);
    });
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