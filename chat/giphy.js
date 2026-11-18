
const GIF_MESSAGE_PREFIX = "gif:v1:";
const IMAGE_MESSAGE_PREFIX = "image:v1:";
const SHARED_GAME_MESSAGE_PREFIX = "game:v1:";
const GAME_INVITE_MESSAGE_PREFIX = "game-invite:v1:";
const GIF_HIDE_SETTING = "hide gifs";
const gifSearchForm = document.getElementById("gifSearchForm");
const gifSearchInput = document.getElementById("gifSearchInput");
const gifSearchButton = document.getElementById("gifSearchButton");
const gifSearchResults = document.getElementById("gifSearchResults");
const gifSearchPagination = document.getElementById("gifSearchPagination");
const gifSearchStatus = document.getElementById("gifSearchStatus");
const chatImageUploadBtn = document.getElementById("chatImageUploadBtn");
const chatImageInput = document.getElementById("chatImageInput");
const chatImagePreview = document.getElementById("chatImagePreview");
const chatImagePreviewImage = document.getElementById("chatImagePreviewImage");
const chatImagePreviewEdit = document.getElementById("chatImagePreviewEdit");
const chatImagePreviewDelete = document.getElementById("chatImagePreviewDelete");
let pendingChatImage = null;
let pendingChatImageUrl = null;
const gifSearchResultById = new Map();
const GIF_SEARCH_PAGE_SIZE = 12;
let gifSearchRequestId = 0;
let gifSearchQuery = "";
let gifSearchPage = 1;
let gifSearchPageCount = 0;
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

function parseChatImageMessage(content) {
  content = parseReplyMessage(content).content;
  if (!content.startsWith(IMAGE_MESSAGE_PREFIX)) return null;
  try {
    const image = JSON.parse(content.slice(IMAGE_MESSAGE_PREFIX.length));
    if (
      image?.provider !== "imgbb" ||
      typeof image.url !== "string" ||
      typeof image.deleteUrl !== "string"
    ) return null;
    const url = new URL(image.url);
    const deleteUrl = new URL(image.deleteUrl);
    if (
      url.protocol !== "https:" ||
      !/^(i\.)?ibb\.co$/i.test(url.hostname) ||
      deleteUrl.protocol !== "https:" ||
      !/^ibb\.co$/i.test(deleteUrl.hostname)
    ) return null;
    return {
      provider: "imgbb",
      url: url.href,
      deleteUrl: deleteUrl.href,
      alt: typeof image.alt === "string" && image.alt ? image.alt : "Uploaded image"
    };
  } catch (error) {
    return null;
  }
}

function parseSharedGameMessage(content) {
  if (
    typeof content !== "string" ||
    content.length > 40_000 ||
    !content.startsWith(SHARED_GAME_MESSAGE_PREFIX)
  ) return null;
  try {
    const shared = JSON.parse(content.slice(SHARED_GAME_MESSAGE_PREFIX.length));
    if (shared?.game === "chess") {
      if (typeof shared.pgn !== "string" || !shared.pgn.trim() || shared.pgn.length > 16_000) return null;
      if (
        shared.evaluations !== undefined &&
        shared.evaluations !== null &&
        (!Array.isArray(shared.evaluations) || shared.evaluations.length > 200)
      ) return null;
      return shared;
    }
    if (
      shared?.game === "number-pillars" &&
      Array.isArray(shared.numbers) &&
      shared.numbers.length > 0 &&
      shared.numbers.length <= 40 &&
      shared.numbers.every(number => Number.isFinite(number) && Math.abs(number) <= 1_000_000) &&
      Number.isFinite(shared.answer) &&
      Math.abs(shared.answer) <= 1_000_000 &&
      (shared.name === undefined || (typeof shared.name === "string" && shared.name.length <= 60))
    ) {
      return shared;
    }
    return null;
  } catch (error) {
    return null;
  }
}

function parseGameInviteMessage(content) {
  if (
    typeof content !== "string" ||
    content.length > 1000 ||
    !content.startsWith(GAME_INVITE_MESSAGE_PREFIX)
  ) return null;
  try {
    const invite = JSON.parse(content.slice(GAME_INVITE_MESSAGE_PREFIX.length));
    if (
      !["chess", "doudizhu", "streetfighter"].includes(invite?.game) ||
      typeof invite.invite_code !== "string" ||
      !/^[A-Z0-9]{8}$/.test(invite.invite_code)
    ) return null;
    return invite;
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

function renderChatMessageBody(bodyDiv, rawContent, username = "Player") {
  const content = parseReplyMessage(rawContent).content;
  const gif = parseGifMessage(content);
  const uploadedImage = parseChatImageMessage(content);
  const sharedGame = parseSharedGameMessage(content);
  const gameInvite = parseGameInviteMessage(content);
  bodyDiv.replaceChildren();

  if (gameInvite) {
    const card = document.createElement("div");
    card.className = `chat-shared-game chat-game-invite chat-shared-game-${gameInvite.game}`;

    const icon = document.createElement("span");
    icon.className = "chat-shared-game-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = gameInvite.game === "chess" ? "♟" : gameInvite.game === "doudizhu" ? "地主" : "SF";

    const title = document.createElement("span");
    title.className = "chat-shared-game-title";
    const gameName = { chess: "Chess", doudizhu: "Dou Dizhu", streetfighter: "Street Fighter" }[gameInvite.game];
    title.textContent = `${username} invited you to ${gameName}`;

    const joinButton = document.createElement("button");
    joinButton.type = "button";
    joinButton.className = "chat-shared-game-open";
    joinButton.textContent = "Join game";
    joinButton.addEventListener("click", () => {
      if (typeof window.openGameInvite !== "function") {
        console.error("The game launcher is unavailable.");
        return;
      }
      try {
        window.openGameInvite(gameInvite.game, gameInvite.invite_code);
      } catch (error) {
        console.error("Could not open the game invite.", error);
      }
    });

    card.append(icon, title, joinButton);
    bodyDiv.appendChild(card);
    return;
  }

  if (sharedGame) {
    const card = document.createElement("div");
    card.className = `chat-shared-game chat-shared-game-${sharedGame.game}`;

    const icon = document.createElement("span");
    icon.className = "chat-shared-game-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = sharedGame.game === "chess" ? "♟" : "🧮";

    const title = document.createElement("span");
    title.className = "chat-shared-game-title";
    title.textContent = `${username} shared a ${sharedGame.game === "chess" ? "chess game" : "Number Pillars level"}`;

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "chat-shared-game-open";
    openButton.textContent = sharedGame.game === "chess" ? "Review game" : "Play level";
    openButton.addEventListener("click", () => {
      if (typeof window.openSharedGame !== "function") {
        console.error("The game launcher is unavailable.");
        return;
      }
      try {
        window.openSharedGame(sharedGame.game, sharedGame);
      } catch (error) {
        console.error("Could not open the shared game.", error);
      }
    });

    card.append(icon, title, openButton);
    bodyDiv.appendChild(card);
    return;
  }

  if (uploadedImage) {
    const link = document.createElement("a");
    link.className = "chat-image-link";
    link.href = uploadedImage.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const image = document.createElement("img");
    image.className = "chat-image";
    image.src = uploadedImage.url;
    image.alt = uploadedImage.alt;
    image.loading = "lazy";
    link.appendChild(image);
    bodyDiv.appendChild(link);
    return;
  }

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

  const displayContent = censoring ? censorSwearWords(content) : content;
  if (window.ChatEmoji) window.ChatEmoji.renderText(bodyDiv, displayContent);
  else bodyDiv.textContent = displayContent;
}

function getChatMessagePreview(content) {
  if (typeof content !== "string") return getMessagePreview(content);
  if (parseGifMessage(content)) return "sent a GIF";
  if (parseChatImageMessage(content)) return "sent an image";
  const message = parseReplyMessage(content).content;
  const invite = parseGameInviteMessage(message);
  if (invite) return `invited you to ${invite.game === "chess" ? "Chess" : "Dou Dizhu"}`;
  const sharedGame = parseSharedGameMessage(message);
  if (sharedGame) return sharedGame.game === "chess" ? "shared a chess game" : "shared a Number Pillars level";
  return getMessagePreview(content);
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

async function uploadChatImage(file, statusElement) {
  if (!file) return false;
  const apiKey = window.IMGBB_API_KEY;
  if (!apiKey || apiKey === "YOUR_IMGBB_API_KEY") {
    statusElement.textContent = "Image uploads are unavailable. Add the ImgBB API key.";
    return false;
  }
  if (!/^image\/(png|jpeg|gif|webp)$/i.test(file.type)) {
    statusElement.textContent = "Choose a PNG, JPEG, GIF or WebP image.";
    return false;
  }
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > 32 * 1024 * 1024) {
    statusElement.textContent = "Choose an image smaller than 32 MB.";
    return false;
  }
  const { data: { user }, error: authError } = await _supabase.auth.getUser();
  if (authError) {
    console.error("Could not check chat sign-in status.", authError);
    statusElement.textContent = "Could not verify your sign-in.";
    return false;
  }
  if (!user) {
    statusElement.textContent = "Sign in to send images.";
    return false;
  }
  const previousDisabled = chatImageUploadBtn.disabled;
  chatImageUploadBtn.disabled = true;
  statusElement.textContent = "Uploading image...";
  try {
    const form = new FormData();
    form.append("image", file);
    const response = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      body: form
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error?.message || `ImgBB upload failed (${response.status}).`);
    const uploaded = result.data;
    if (!uploaded?.url || !uploaded?.delete_url) throw new Error("ImgBB did not return a usable image.");
    const url = new URL(uploaded.url);
    const deleteUrl = new URL(uploaded.delete_url);
    if (url.protocol !== "https:" || !/^(i\.)?ibb\.co$/i.test(url.hostname)
      || deleteUrl.protocol !== "https:" || !/^ibb\.co$/i.test(deleteUrl.hostname)) {
      throw new Error("ImgBB returned an invalid image link.");
    }
    const channelId = activeChatChannelId;
    const content = encodeReplyContent(`${IMAGE_MESSAGE_PREFIX}${JSON.stringify({
      provider: "imgbb", url: url.href, deleteUrl: deleteUrl.href, alt: file.name
    })}`);
    const message = { user_id: user.id, content };
    if (channelId) message.channel_id = channelId;
    const { error } = await _supabase.from("messages").insert([message]);
    if (error) throw error;
    statusElement.textContent = "Image sent.";
    clearPendingChatImage();
    clearReplyTarget();
    playSendIconAnimation();
    const recorder = window.achievements?.recordGameEvent;
    if (typeof recorder === "function") {
      recorder("main", "message-sent").catch(error => console.error("Could not record chat image achievement.", error));
      recorder("main", "image-sent").catch(error => console.error("Could not record image achievement.", error));
    }
    return true;
  } catch (error) {
    console.error("Could not upload chat image.", error);
    statusElement.textContent = `Could not upload image: ${error.message || "Unknown error"}`;
    return false;
  } finally {
    chatImageUploadBtn.disabled = previousDisabled;
    chatImageInput.value = "";
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
  const recorder = window.achievements?.recordGameEvent;
  if (typeof recorder !== "function") {
    console.error("Game achievement tracker is unavailable for GIF progress.");
  } else {
    recorder("main", "message-sent").catch(error => {
      console.error("Could not record chat message achievement.", error);
    });
    recorder("main", "gif-sent").catch(error => {
      console.error("Could not record GIF achievement.", error);
    });
  }
}


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

function clearPendingChatImage() {
  pendingChatImage = null;
  if (pendingChatImageUrl) URL.revokeObjectURL(pendingChatImageUrl);
  pendingChatImageUrl = null;
  chatImagePreview.hidden = true;
  chatImagePreviewImage.removeAttribute("src");
  chatImageInput.value = "";
}

async function sendPendingChatImage() {
  if (!pendingChatImage) return null;
  return await uploadChatImage(pendingChatImage, gifSearchStatus);
}

chatImageUploadBtn.addEventListener("click", () => chatImageInput.click());
chatImagePreviewEdit.addEventListener("click", () => chatImageInput.click());
chatImagePreviewDelete.addEventListener("click", () => clearPendingChatImage());
chatImageInput.addEventListener("change", () => {
  const file = chatImageInput.files?.[0];
  if (!file) return;
  if (pendingChatImageUrl) URL.revokeObjectURL(pendingChatImageUrl);
  pendingChatImage = file;
  pendingChatImageUrl = URL.createObjectURL(file);
  chatImagePreviewImage.src = pendingChatImageUrl;
  chatImagePreview.hidden = false;
});

window.sendPendingChatImage = sendPendingChatImage;
window.clearPendingChatImage = clearPendingChatImage;

if (!window.GIPHY_API_KEY || window.GIPHY_API_KEY === "YOUR_GIPHY_API_KEY") {
  setGifSearchStatus("Add your GIPHY API key in js/giphy-config.js to enable search.");
}

window.parseChatImageMessage = parseChatImageMessage;
