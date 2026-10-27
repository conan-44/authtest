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

const profileRanks = ["BANANA", "TOAST", "MUFFIN", "COOKIE", "ADMIN"];
const publicGameRatingDefaults = {
  mastermind: 1000,
  chess: 1000,
  blackjack: 1000,
  doudizhu: 1000,
  "number-pillars": 0,
  minecraft: 0,
  streetfighter: 1000
};
const publicGameRatingLabels = {
  mastermind: "Bulls & Cows",
  chess: "Chess",
  blackjack: "Blackjack",
  doudizhu: "Dou Dizhu",
  "number-pillars": "Number Pillars",
  minecraft: "Minecraft",
  streetfighter: "Street Fighter"
};

async function queryPublicProfiles(buildQuery) {
  const result = await buildQuery("id, username, flair, created_at, avatar, auth_providers");
  if (result.error) throw result.error;
  return result.data;
}

function makeProfileSignInStat(providers) {
  const stat = document.createElement("div");
  stat.className = "public-profile-stat";
  const label = document.createElement("span");
  label.className = "public-profile-stat-label";
  label.textContent = "Can sign in via";
  const value = document.createElement("strong");
  value.className = "public-profile-stat-value public-profile-provider-value";

  const providerNames = new Map([
    ["google", ["Google", "badge-google"]],
    ["email", ["Email", "badge-mail"]]
  ]);
  const knownProviders = [...new Set(Array.isArray(providers) ? providers : [])]
    .filter(provider => providerNames.has(provider));
  if (!knownProviders.length) {
    value.textContent = "Unavailable";
  } else {
    const bothMethods = knownProviders.includes("google") && knownProviders.includes("email");
    const icon = document.createElement("span");
    icon.className = `btn-icon public-profile-provider-icon ${bothMethods ? "badge-gmail" : providerNames.get(knownProviders[0])[1]}`;
    icon.setAttribute("aria-hidden", "true");
    const methodText = document.createElement("span");
    methodText.textContent = bothMethods
      ? "Google and Email"
      : providerNames.get(knownProviders[0])[0];
    value.append(icon, methodText);
  }
  stat.append(label, value);
  return stat;
}

function makeProfileAvatar(avatar, className, username) {
  if (!avatar || window.ProfileAvatars.isDefault(avatar)) {
    const image = document.createElement("img");
    image.src = "./assets/profile.png";
    image.className = className;
    image.alt = `${username || "Player"}'s profile picture`;
    return image;
  }
  const canvas = document.createElement("canvas");
  canvas.className = className;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `${username || "Player"}'s profile picture`);
  if (!window.ProfileAvatars.draw(canvas, avatar)) {
    console.warn("A public profile picture has an invalid format.", avatar);
    return makeProfileAvatar(null, className, username);
  }
  return canvas;
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

function normalizeProfileRank(value) {
  return typeof value === "string" && profileRanks.includes(value) ? value : null;
}

function makeProfileRankStat(rank) {
  const stat = document.createElement("div");
  stat.className = "public-profile-stat public-profile-rank-stat";
  const label = document.createElement("span");
  label.className = "public-profile-stat-label";
  label.textContent = "Rank";
  const value = document.createElement("strong");
  value.className = "public-profile-stat-value public-profile-rank-value";
  if (rank) {
    const icon = document.createElement("span");
    const styleRank = rank === "ADMIN" ? "COOKIE" : rank;
    icon.className = `profile-rank-icon rank-${styleRank.toLowerCase()}`;
    icon.setAttribute("aria-hidden", "true");
    icon.title = rank;
    value.append(icon, document.createTextNode(rank));
  } else {
    value.textContent = "Unavailable";
  }
  stat.append(label, value);
  return stat;
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
    const recordAchievement = window.achievements?.recordGameEvent;
    if (typeof recordAchievement === "function") {
      recordAchievement("main", "profile-viewed").catch(error => {
        console.error("Could not record profile-view achievement.", error);
      });
    } else {
      console.error("Achievement tracker is unavailable for profile views.");
    }

    await window.achievements.loadAllFromDirectoryIndex();
    const [
      { data: stats, error: statsError },
      { data: rawRank, error: rankError },
      { data: gameRatings, error: gameRatingsError },
      achievements,
      milestones
    ] = await Promise.all([
      _supabase
        .from("public_user_stats")
        .select("user_id, achievements")
        .eq("user_id", profile.id)
        .maybeSingle(),
      _supabase.rpc("get_public_profile_rank", { p_user_id: profile.id }),
      _supabase
        .from("game_ratings")
        .select("game, rating")
        .eq("user_id", profile.id),
      Promise.resolve(window.achievements.getAchievements()),
      Promise.resolve(window.achievements.getMilestones())
    ]);
    if (requestId !== profileRequestId) return;
    if (statsError) console.error("Could not load public profile achievement stats.", statsError);
    if (rankError) console.error("Could not load the public profile rank.", rankError);
    if (gameRatingsError) console.error("Could not load public game ratings.", gameRatingsError);
    const rank = rankError ? null : normalizeProfileRank(rawRank);
    if (!rankError && !rank) console.error("Supabase returned an invalid public profile rank.", rawRank);

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
    const currentMilestone = statsUnavailable
      ? null
      : milestones.filter(item => points >= item.points).at(-1) || null;

    const headingRow = document.createElement("div");
    headingRow.className = "public-profile-heading";
    const avatar = makeProfileAvatar(profile.avatar, "public-profile-avatar", profile.username);
    const styleRank = rank === "ADMIN" ? "COOKIE" : rank;
    if (avatar) {
      if (styleRank === "TOAST" || styleRank === "MUFFIN" || styleRank === "COOKIE") {
        avatar.classList.add("profile-rank-aura", `rank-${styleRank.toLowerCase()}`);
      }
      headingRow.appendChild(avatar);
    }
    const heading = document.createElement("h2");
    heading.className = "public-profile-name";
    heading.textContent = profile.username || "Player";
    if (rank) heading.classList.add(`rank-${styleRank.toLowerCase()}`);
    headingRow.appendChild(heading);
    if (rank === "COOKIE" || rank === "ADMIN") {
      const adminBadge = document.createElement("span");
      const isAdmin = rank === "ADMIN";
      adminBadge.className = `profile-admin-badge ${isAdmin ? "rank-admin" : "rank-cookie"}`;
      adminBadge.setAttribute("aria-label", isAdmin ? "Admin" : "Cookie rank");
      const badgeIcon = document.createElement(isAdmin ? "img" : "span");
      if (isAdmin) {
        badgeIcon.src = "./assets/admin.png";
        badgeIcon.alt = "";
      } else {
        badgeIcon.className = "profile-rank-icon rank-cookie";
      }
      badgeIcon.setAttribute("aria-hidden", "true");
      const badgeLabel = document.createElement("span");
      badgeLabel.textContent = rank;
      adminBadge.append(badgeIcon, badgeLabel);
      headingRow.appendChild(adminBadge);
    }
    const flair = document.createElement("p");
    flair.className = `public-profile-flair${styleRank === "MUFFIN" || styleRank === "COOKIE" ? ` rank-${styleRank.toLowerCase()}` : ""}`;
    flair.textContent = profile.flair || "No flair";
    if (styleRank === "COOKIE") flair.dataset.text = flair.textContent;
    const statsGrid = document.createElement("div");
    statsGrid.className = "public-profile-stats";
    statsGrid.append(
      makeProfileStat(
        "Achievements",
        statsUnavailable ? "Unavailable" : `${completedAchievementCount}/${achievements.length}`
      ),
      makeProfileStat("Points", statsUnavailable ? "Unavailable" : String(points)),
      makeProfileRankStat(rank),
      makeProfileSignInStat(profile.auth_providers)
    );

    const milestoneStat = document.createElement("div");
    milestoneStat.className = "public-profile-stat public-profile-milestone-stat";
    const milestoneLabel = document.createElement("span");
    milestoneLabel.className = "public-profile-stat-label";
    milestoneLabel.textContent = "Milestone";
    const milestoneValue = document.createElement("strong");
    milestoneValue.className = "public-profile-stat-value public-profile-milestone-value";
    if (statsUnavailable) {
      milestoneValue.textContent = "Unavailable";
    } else if (currentMilestone) {
      const paragonTier = currentMilestone.name.match(/^Paragon\s+([IVXLCDM]+)$/i)?.[1];
      const paragonNumber = { I: 1, II: 2, III: 3 }[paragonTier?.toUpperCase()];
      const medalClass = paragonTier
        ? `paragon-${paragonNumber}`
        : currentMilestone.name.toLowerCase().replace(/[^a-z0-9-]/g, "");
      const medalIcon = document.createElement("span");
      medalIcon.className = "public-profile-current-medal";
      medalIcon.setAttribute("aria-hidden", "true");
      medalIcon.title = `${currentMilestone.name} milestone medal`;
      const medalSprite = document.createElement("span");
      medalSprite.className = `icons_medal icons_medal-${medalClass}`;
      medalSprite.setAttribute("aria-hidden", "true");
      medalIcon.appendChild(medalSprite);
      const milestoneName = document.createElement("span");
      milestoneName.textContent = currentMilestone.name;
      milestoneValue.append(medalIcon, milestoneName);
    } else {
      milestoneValue.textContent = "None";
    }
    milestoneStat.append(milestoneLabel, milestoneValue);
    statsGrid.appendChild(milestoneStat);

    const gameRatingsSection = document.createElement("section");
    gameRatingsSection.className = "public-profile-game-rating-section";
    const gameRatingsHeading = document.createElement("h3");
    gameRatingsHeading.className = "public-profile-rarity-heading";
    gameRatingsHeading.textContent = "Game Ratings";
    const gameRatingsGrid = document.createElement("div");
    gameRatingsGrid.className = "public-profile-game-ratings";
    const ratingsByGame = new Map(
      Array.isArray(gameRatings)
        ? gameRatings
          .filter(item => typeof item?.game === "string" && Number.isSafeInteger(item.rating))
          .map(item => [item.game, item.rating])
        : []
    );
    if (gameRatings && !Array.isArray(gameRatings)) {
      console.error("Public game ratings were returned in an unexpected format.", gameRatings);
    }
    Object.entries(publicGameRatingLabels).forEach(([game, label]) => {
      const rating = gameRatingsError
        ? null
        : ratingsByGame.get(game) ?? publicGameRatingDefaults[game];
      const value = rating === null
        ? "Unavailable"
        : game === "number-pillars"
          ? `${rating.toLocaleString()} XP`
          : game === "minecraft"
            ? `${rating.toLocaleString()} min`
            : `${rating.toLocaleString()} Elo`;
      gameRatingsGrid.appendChild(makeProfileStat(label, value, "public-profile-game-rating"));
    });
    gameRatingsSection.append(gameRatingsHeading, gameRatingsGrid);

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

    chatPublicProfileContent.replaceChildren(
      headingRow,
      flair,
      statsGrid,
      gameRatingsSection,
      rarityHeading,
      rarityList
    );
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
      const avatar = makeProfileAvatar(profile.avatar, "profile-search-avatar", profile.username);
      const username = document.createElement("strong");
      username.className = "profile-search-username";
      username.textContent = profile.username || "Player";
      if (avatar) button.appendChild(avatar);
      button.appendChild(username);
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
