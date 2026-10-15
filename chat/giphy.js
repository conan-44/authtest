// GIPHY message rendering, search, pagination, and send controls.
const GIF_MESSAGE_PREFIX = "gif:v1:";
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
const GIF_PICKER_COLLAPSED_KEY = "chat-gif-picker-collapsed";
const toggleGifPickerBtn = document.getElementById("toggleGifPickerBtn");
const chatOptionsBody = document.getElementById("chatOptionsBody");
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

if (!window.GIPHY_API_KEY || window.GIPHY_API_KEY === "YOUR_GIPHY_API_KEY") {
  setGifSearchStatus("Add your GIPHY API key in js/giphy-config.js to enable search.");
}
