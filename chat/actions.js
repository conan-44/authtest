// Reply, edit, delete, and message action controls.
const REPLY_MESSAGE_PREFIX = "reply:v1:";
const chatReplyContext = document.getElementById("chatReplyContext");
const chatReplyText = document.getElementById("chatReplyText");
const cancelChatReplyBtn = document.getElementById("cancelChatReplyBtn");
let replyTargetId = null;
function parseReplyMessage(content) {
  if (typeof content !== "string" || !content.startsWith(REPLY_MESSAGE_PREFIX)) {
    return { replyId: null, content };
  }
  const separatorIndex = content.indexOf("|", REPLY_MESSAGE_PREFIX.length);
  if (separatorIndex < 0) return { replyId: null, content };
  const replyId = content.slice(REPLY_MESSAGE_PREFIX.length, separatorIndex);
  if (!/^[\w-]{1,100}$/.test(replyId)) return { replyId: null, content };
  return { replyId, content: content.slice(separatorIndex + 1) };
}

function encodeReplyContent(content) {
  return replyTargetId ? `${REPLY_MESSAGE_PREFIX}${replyTargetId}|${content}` : content;
}

function getMessagePreview(content) {
  const message = parseReplyMessage(content);
  return parseGifMessage(message.content) ? "GIF" : (censoring ? censorSwearWords(message.content) : message.content);
}

function renderReplyPreview(messageEl, rawContent) {
  const preview = messageEl.querySelector(".chat-reply-preview");
  const { replyId } = parseReplyMessage(rawContent);
  if (!replyId) {
    preview.classList.add("is-hidden");
    preview.replaceChildren();
    return;
  }
  const target = messageRecords.get(replyId);
  const username = target?.profiles?.username || "Message";
  const text = target ? getMessagePreview(target.content) : "Original message is unavailable";
  preview.textContent = `Replying to ${username}: ${text}`;
  preview.classList.remove("is-hidden");
}

function setReplyTarget(messageEl) {
  const target = messageRecords.get(messageEl.dataset.messageId);
  if (!target) return;
  replyTargetId = String(target.id);
  chatReplyText.textContent = `Replying to ${target.profiles?.username || "Player"}: ${getMessagePreview(target.content)}`;
  chatReplyContext.classList.remove("is-hidden");
  document.getElementById("chatInput").focus();
}

function clearReplyTarget() {
  replyTargetId = null;
  chatReplyText.textContent = "";
  chatReplyContext.classList.add("is-hidden");
}

function startEditingMessage(messageEl) {
  if (messageEl.querySelector(".chat-message-editor")) return;
  const body = messageEl.querySelector(".chat-body");
  const originalContent = body.getAttribute("data-raw") || "";
  const parsedReply = parseReplyMessage(originalContent);
  const isGif = Boolean(parseGifMessage(parsedReply.content));
  const editor = document.createElement("textarea");
  editor.className = "chat-message-editor";
  editor.value = isGif ? "" : parsedReply.content;
  editor.dataset.replyId = parsedReply.replyId || "";
  editor.placeholder = isGif ? "Replace this GIF with a text message..." : "Edit your message...";
  editor.maxLength = 1000;
  editor.setAttribute("aria-label", "Edit chat message");

  const actions = document.createElement("div");
  actions.className = "chat-message-actions chat-message-edit-actions";
  actions.innerHTML = `
    <button type="button" data-message-action="save">Save</button>
    <button type="button" data-message-action="cancel">Cancel</button>
  `;
  body.replaceChildren(editor, actions);
  editor.focus();
  editor.setSelectionRange(editor.value.length, editor.value.length);
}

async function saveEditedMessage(messageEl) {
  const editor = messageEl.querySelector(".chat-message-editor");
  const editedContent = editor?.value.trim();
  const content = editor?.dataset.replyId
    ? `${REPLY_MESSAGE_PREFIX}${editor.dataset.replyId}|${editedContent}`
    : editedContent;
  if (!editedContent) {
    setGifSearchStatus("A message cannot be blank. Use Delete to remove it.");
    return;
  }

  const messageId = messageEl.dataset.messageId;
  const { data, error } = await _supabase
    .from("messages")
    .update({ content })
    .eq("id", messageId)
    .eq("user_id", currentChatUserId)
    .select("id, content")
    .maybeSingle();

  if (error || !data) {
    console.error("Error editing chat message:", error || "No message was updated.");
    setGifSearchStatus(`Could not edit message: ${error?.message || "No message was updated."}`);
    return;
  }
  updateMessageUI({ id: messageId, content: data.content });
  setGifSearchStatus("Message updated.");
}

async function deleteChatMessage(messageEl) {
  const messageId = messageEl.dataset.messageId;
  const { error: deleteError } = await _supabase
    .from("messages")
    .delete()
    .eq("id", messageId)
    .eq("user_id", currentChatUserId);

  if (deleteError) console.warn("Could not delete chat message directly; trying blank-content fallback.", deleteError.message);
  const { data: remainingMessage, error: verifyDeleteError } = await _supabase
    .from("messages")
    .select("id, content")
    .eq("id", messageId)
    .eq("user_id", currentChatUserId)
    .maybeSingle();

  if (verifyDeleteError) {
    console.error("Could not verify chat message deletion:", verifyDeleteError.message);
    setGifSearchStatus(`Could not verify message deletion: ${verifyDeleteError.message}`);
    return;
  }
  if (!remainingMessage) {
    removeMessageUI(messageId);
    setGifSearchStatus("Message deleted.");
    return;
  }

  const { error: blankError } = await _supabase
    .from("messages")
    .update({ content: "" })
    .eq("id", messageId)
    .eq("user_id", currentChatUserId);

  if (blankError) {
    console.error("Could not blank chat message:", blankError.message);
    setGifSearchStatus(`Could not delete message: ${blankError.message}`);
    return;
  }

  const { data: blankedMessage, error: verifyBlankError } = await _supabase
    .from("messages")
    .select("id, content")
    .eq("id", messageId)
    .eq("user_id", currentChatUserId)
    .maybeSingle();
  if (verifyBlankError || (blankedMessage && blankedMessage.content.trim() !== "")) {
    const reason = verifyBlankError?.message || "Supabase did not blank the message. Check the messages table UPDATE policy.";
    console.error("Could not confirm chat message deletion:", reason);
    setGifSearchStatus(`Could not delete message: ${reason}`);
    return;
  }
  removeMessageUI(messageId);
  setGifSearchStatus("Message deleted.");
  if (blankedMessage) cleanupBlankMessages();
}

async function cleanupBlankMessages(userId = null) {
  if (!userId) {
    const { data: { user }, error: authError } = await _supabase.auth.getUser();
    if (authError) {
      console.warn("Could not check the signed-in user for blank-message cleanup.", authError.message);
      return;
    }
    userId = user?.id || null;
  }
  if (!userId) return;
  const { error } = await _supabase
    .from("messages")
    .delete()
    .eq("user_id", userId)
    .eq("content", "");
  if (error) console.warn("Could not clean up blank chat messages.", error.message);
}


cancelChatReplyBtn.addEventListener("click", clearReplyTarget);

document.getElementById("chatMessages").addEventListener("click", event => {
  const actionButton = event.target.closest("button[data-message-action]");
  const messageEl = actionButton?.closest(".chat-msg");
  if (!actionButton || !messageEl) return;
  if (actionButton.dataset.messageAction !== "reply" && messageEl.dataset.userId !== currentChatUserId) return;

  switch (actionButton.dataset.messageAction) {
    case "reply":
      setReplyTarget(messageEl);
      break;
    case "toggle-actions": {
      const isOpen = messageEl.classList.toggle("has-actions-open");
      if (isOpen) {
        messageEl.querySelector('.chat-message-actions button[data-message-action="edit"]')?.focus();
      }
      break;
    }
    case "edit":
      startEditingMessage(messageEl);
      break;
    case "save":
      saveEditedMessage(messageEl);
      break;
    case "cancel":
      renderChatMessageBody(messageEl.querySelector(".chat-body"), messageEl.querySelector(".chat-body").dataset.raw || "");
      break;
    case "delete":
      deleteChatMessage(messageEl);
      break;
  }
});

