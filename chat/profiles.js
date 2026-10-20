// Public profile search and profile cards for the Chat Options panel.
const profileSearchForm = document.getElementById("profileSearchForm");
const profileSearchInput = document.getElementById("profileSearchInput");
const profileSearchStatus = document.getElementById("profileSearchStatus");
const profileSearchResults = document.getElementById("profileSearchResults");
const chatProfileView = document.getElementById("chatProfileView");
const chatProfileBackBtn = document.getElementById("chatProfileBackBtn");
const chatWorkspace = document.querySelector("#chatPanel .chat-workspace");
const chatPublicProfileContent = document.getElementById("chatPublicProfileContent");
const chatOptionsTabs = [...document.querySelectorAll("[data-chat-options-tab]")];
const chatOptionsBody = document.getElementById("chatOptionsBody");
const minimizeChatOptionsBtn = document.getElementById("minimizeChatOptionsBtn");
let profileRequestId = 0;

async function queryPublicProfiles(buildQuery) {
  const result = await buildQuery("id, username, flair, created_at");
  if (result.error) throw result.error;
  return result.data;
}

function activateChatOptionsTab(name) {
  chatOptionsBody.hidden = false;
  document.getElementById("chatOptionsPanel").classList.remove("is-minimized");
  minimizeChatOptionsBtn.setAttribute("aria-expanded", "true");
  minimizeChatOptionsBtn.textContent = "Minimize";
  chatOptionsTabs.forEach(tab => {
    const active = tab.dataset.chatOptionsTab === name;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll(".chat-options-tab-panel").forEach(panel => {
    const active = panel.id === (name === "gifs" ? "chatOptionsGifs" : "chatOptionsPlayers");
    panel.hidden = !active;
    panel.classList.toggle("is-hidden", !active);
  });
}

function makeProfileStat(labelText, valueText, extraClass = "") {
  const item = document.createElement("div");
  item.className = `public-profile-stat${extraClass ? ` ${extraClass}` : ""}`;
  const label = document.createElement("span");
  label.className = "public-profile-stat-label";
  label.textContent = labelText;
  const value = document.createElement("strong");
  value.className = "public-profile-stat-value";
  value.textContent = valueText;
  item.append(label, value);
  return item;
}

function getProfileSearchCountLabel(count) {
  return `${count} player${count === 1 ? "" : "s"} found.`;
}

function showProfileLoadError(message) {
  chatPublicProfileContent.replaceChildren();
  const error = document.createElement("p");
  error.className = "public-profile-error";
  error.textContent = message;
  chatPublicProfileContent.appendChild(error);
}

async function openChatProfile(userId, { keepSearchResults = false } = {}) {
  if (typeof userId !== "string" || !userId) return;
  if (typeof window.activateTab === "function") window.activateTab("chat");
  activateChatOptionsTab("players");
  if (!keepSearchResults) profileSearchResults.replaceChildren();
  chatWorkspace.classList.add("is-hidden");
  chatProfileView.classList.remove("is-hidden");
  chatPublicProfileContent.replaceChildren();
  profileSearchStatus.textContent = "Loading profile...";
  const requestId = ++profileRequestId;

  try {
    const profile = await queryPublicProfiles(columns => _supabase
      .from("public_profiles")
      .select(columns)
      .eq("id", userId)
      .maybeSingle());
    if (requestId !== profileRequestId) return;
    if (!profile) {
      showProfileLoadError("This player profile could not be found.");
      profileSearchStatus.textContent = "";
      return;
    }

    await window.achievements.loadAllFromDirectoryIndex();
    const [{ data: stats, error: statsError }, achievements, milestones] = await Promise.all([
      _supabase
        .from("public_user_stats")
        .select("user_id, achievements")
        .eq("user_id", profile.id)
        .maybeSingle(),
      Promise.resolve(window.achievements.getAchievements()),
      Promise.resolve(window.achievements.getMilestones())
    ]);
    if (requestId !== profileRequestId) return;
    if (statsError) console.error("Could not load public profile achievement stats.", statsError);

    const achievementIds = Array.isArray(stats?.achievements)
      ? [...new Set(stats.achievements.filter(id => typeof id === "string"))]
      : [];
    if (stats?.achievements != null && !Array.isArray(stats.achievements)) {
      console.error("Public profile achievements were returned in an unexpected format.", stats.achievements);
    }
    const completedIds = new Set(achievementIds);
    const rarityCounts = {
      common: { completed: 0, total: 0 },
      rare: { completed: 0, total: 0 },
      epic: { completed: 0, total: 0 },
      legendary: { completed: 0, total: 0 },
      secret: { completed: 0, total: 0 }
    };
    let completedAchievementCount = 0;
    let points = 0;
    achievements.forEach(achievement => {
      if (Object.hasOwn(rarityCounts, achievement.rarity)) {
        rarityCounts[achievement.rarity].total += 1;
      }
      if (completedIds.has(achievement.id)) {
        completedAchievementCount += 1;
        points += achievement.points || 0;
        if (Object.hasOwn(rarityCounts, achievement.rarity)) {
          rarityCounts[achievement.rarity].completed += 1;
        }
      }
    });
    const statsUnavailable = Boolean(statsError || !stats);
    const medal = statsUnavailable
      ? null
      : milestones.filter(item => points >= item.points).at(-1) || null;

    const heading = document.createElement("h2");
    heading.className = "public-profile-name";
    heading.textContent = profile.username || "Player";
    const flair = document.createElement("p");
    flair.className = "public-profile-flair";
    flair.textContent = profile.flair || "No flair";
    const statsGrid = document.createElement("div");
    statsGrid.className = "public-profile-stats";
    statsGrid.append(
      makeProfileStat(
        "Achievements",
        statsUnavailable ? "Unavailable" : `${completedAchievementCount}/${achievements.length}`
      ),
      makeProfileStat("Points", statsUnavailable ? "Unavailable" : String(points))
    );

    const medalStat = document.createElement("div");
    medalStat.className = "public-profile-stat public-profile-medal-stat";
    const medalLabel = document.createElement("span");
    medalLabel.className = "public-profile-stat-label";
    medalLabel.textContent = "Milestone Medal";
    if (medal) {
      const medalIconWrap = document.createElement("span");
      medalIconWrap.className = "public-profile-medal-icon";
      const medalIcon = document.createElement("span");
      const medalClass = String(medal.name).toLowerCase().replace(/[^a-z0-9-]/g, "");
      medalIcon.className = `icons_medal icons_medal-${medalClass}`;
      medalIcon.setAttribute("aria-hidden", "true");
      medalIconWrap.appendChild(medalIcon);
      medalLabel.appendChild(medalIconWrap);
    }
    medalStat.appendChild(medalLabel);
    statsGrid.appendChild(medalStat);

    const joined = profile.created_at ? new Date(profile.created_at) : null;
    const joinedText = joined && Number.isFinite(joined.getTime())
      ? joined.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
      : "Unavailable";
    statsGrid.appendChild(makeProfileStat("Joined", joinedText, "public-profile-joined"));

    const rarityHeading = document.createElement("h3");
    rarityHeading.className = "public-profile-rarity-heading";
    rarityHeading.textContent = "Achievements by rarity";
    const rarityList = document.createElement("dl");
    rarityList.className = "public-profile-rarity-list";
    Object.entries(rarityCounts).forEach(([rarity, count]) => {
      const row = document.createElement("div");
      row.className = `public-profile-rarity rarity-${rarity}`;
      const name = document.createElement("dt");
      name.textContent = rarity[0].toUpperCase() + rarity.slice(1);
      const value = document.createElement("dd");
      value.textContent = statsUnavailable ? "N/A" : `${count.completed}/${count.total}`;
      row.append(name, value);
      rarityList.appendChild(row);
    });

    chatPublicProfileContent.replaceChildren(heading, flair, statsGrid, rarityHeading, rarityList);
    profileSearchStatus.textContent = statsUnavailable
      ? "Profile loaded, but achievement stats are unavailable."
      : `Viewing ${profile.username || "Player"}'s profile.`;
  } catch (error) {
    if (requestId !== profileRequestId) return;
    console.error("Could not load public profile.", error);
    profileSearchStatus.textContent = "";
    showProfileLoadError("Could not load this profile. Apply the public profile views SQL migration in Supabase.");
  }
}

async function searchChatProfiles(event) {
  event.preventDefault();
  const search = profileSearchInput.value.trim();
  if (!search) {
    profileSearchStatus.textContent = "Enter a username to search.";
    profileSearchInput.focus();
    return;
  }

  const requestId = ++profileRequestId;
  profileSearchResults.replaceChildren();
  profileSearchStatus.textContent = "Searching players...";
  try {
    const escapedSearch = search.replace(/[\\%_]/g, "\\$&");
    const profiles = await queryPublicProfiles(columns => _supabase
      .from("public_profiles")
      .select(columns)
      .ilike("username", `%${escapedSearch}%`)
      .order("username", { ascending: true })
      .limit(20));
    if (requestId !== profileRequestId) return;
    if (!profiles?.length) {
      profileSearchStatus.textContent = "No players found.";
      return;
    }

    profiles.forEach(profile => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "profile-search-result";
      button.dataset.userId = profile.id;
      const username = document.createElement("strong");
      username.textContent = profile.username || "Player";
      const flair = document.createElement("span");
      flair.textContent = profile.flair || "";
      button.append(username, flair);
      profileSearchResults.appendChild(button);
    });
    profileSearchStatus.textContent = getProfileSearchCountLabel(profiles.length);
  } catch (error) {
    if (requestId !== profileRequestId) return;
    console.error("Could not search public profiles.", error);
    profileSearchStatus.textContent = "Could not search players. Apply the public profile views SQL migration in Supabase.";
  }
}

chatOptionsTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => activateChatOptionsTab(tab.dataset.chatOptionsTab));
  tab.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const nextTab = chatOptionsTabs[(index + offset + chatOptionsTabs.length) % chatOptionsTabs.length];
    activateChatOptionsTab(nextTab.dataset.chatOptionsTab);
    nextTab.focus();
  });
});

profileSearchForm.addEventListener("submit", searchChatProfiles);
document.getElementById("chatMessages").addEventListener("click", event => {
  const button = event.target.closest("button[data-chat-profile-user]");
  if (button) openChatProfile(button.dataset.userId);
});
profileSearchResults.addEventListener("click", event => {
  const button = event.target.closest("button[data-user-id]");
  if (button) openChatProfile(button.dataset.userId, { keepSearchResults: true });
});
chatProfileBackBtn.addEventListener("click", () => {
  profileRequestId += 1;
  chatProfileView.classList.add("is-hidden");
  chatWorkspace.classList.remove("is-hidden");
  profileSearchStatus.textContent = profileSearchResults.childElementCount
    ? getProfileSearchCountLabel(profileSearchResults.childElementCount)
    : "Search for a username, or select a name in chat to view that profile.";
});
minimizeChatOptionsBtn.addEventListener("click", () => {
  const willMinimize = !chatOptionsBody.hidden;
  chatOptionsBody.hidden = willMinimize;
  document.getElementById("chatOptionsPanel").classList.toggle("is-minimized", willMinimize);
  minimizeChatOptionsBtn.setAttribute("aria-expanded", String(!willMinimize));
  minimizeChatOptionsBtn.textContent = willMinimize ? "Show" : "Minimize";
});
document.getElementById("viewOwnProfileBtn").addEventListener("click", async () => {
  const { data: { user }, error } = await _supabase.auth.getUser();
  if (error) {
    console.error("Could not get the signed-in user for profile viewing.", error);
    profileSearchStatus.textContent = "Could not open your profile.";
    activateChatOptionsTab("players");
    if (typeof window.activateTab === "function") window.activateTab("chat");
    return;
  }
  if (user) openChatProfile(user.id);
});

window.openChatProfile = openChatProfile;
window.activateChatOptionsTab = activateChatOptionsTab;
