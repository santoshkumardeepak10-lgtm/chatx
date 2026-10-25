/* ==========================================
   CHATX — MIDNIGHT AURORA
   VERSION 3.2

   REAL-TIME CHAT
   SHARED 24-HOUR STORIES
   IN-APP NOTIFICATIONS
   UNREAD BADGES
   CLEAR CHAT + DELETE CHAT
========================================== */

"use strict";

/* ========== FIREBASE ========== */

import {
  initializeApp,
  getApp,
  getApps
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCAeOr_hpbi22EHQ3w1RakU-WUASEIif1A",
  authDomain: "chatx-b1cea.firebaseapp.com",
  projectId: "chatx-b1cea",
  storageBucket: "chatx-b1cea.firebasestorage.app",
  messagingSenderId: "784164213926",
  appId: "1:784164213926:web:83cd1aafdba8c539689067",
  measurementId: "G-MM7342DKW0"
};

const firebaseApp = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);

const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

/* ========== ELEMENTS ========== */

const $ = id => document.getElementById(id);

const homeScreen = $("homeScreen");
const chatScreen = $("chatScreen");
const peopleScreen = $("peopleScreen");
const storyScreen = $("storyScreen");
const profileScreen = $("profileScreen");

const chatList = $("chatList");
const peopleList = $("peopleList");
const messagesBox = $("messages");
const storiesList = $("storiesList");

/* ========== STATE ========== */

let currentUser = null;

let registeredUsers = [];
let conversations = [];
let stories = [];
let currentMessages = [];

let activeChatId = null;
let activeChatUser = null;
let activeStoryId = null;

let usersUnsubscribe = null;
let chatsUnsubscribe = null;
let messagesUnsubscribe = null;
let storiesUnsubscribe = null;

let storyTimer = null;
let storyRefreshInterval = null;

let sessionVersion = 0;
let notificationsReady = false;

const knownChatUpdates = new Map();

const STORY_DURATION = 86400000;

/* ========== HELPERS ========== */

function getInitial(name) {
  return (name || "?")
    .trim()
    .charAt(0)
    .toUpperCase();
}

function getDisplayName(user) {
  return user?.displayName ||
    user?.email?.split("@")[0] ||
    "ChatX User";
}

function getTimestamp(value) {
  if (!value) return 0;

  if (typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (typeof value === "number") {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  return 0;
}

function formatTime(value) {
  const time = getTimestamp(value);

  if (!time) return "";

  return new Date(time).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatStoryTime(time) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - time) / 60000)
  );

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  return `${Math.floor(minutes / 60)}h ago`;
}

function showScreen(screen) {
  document.querySelectorAll(".screen")
    .forEach(item => {
      item.classList.remove("active");
    });

  screen?.classList.add("active");
}

function selectTab(id) {
  document.querySelectorAll(".nav-item")
    .forEach(item => {
      item.classList.remove("selected");
    });

  $(id)?.classList.add("selected");
}

function openModal(id) {
  $(id)?.classList.remove("hidden");
}

function closeModal(id) {
  $(id)?.classList.add("hidden");
}

function showEmpty(container, message) {
  if (!container) return;

  container.innerHTML = "";

  const div = document.createElement("div");

  div.style.cssText = `
    text-align:center;
    padding:40px 20px;
    color:#8c99b5;
    font-size:14px;
    line-height:1.8;
  `;

  div.textContent = message;
  container.appendChild(div);
}

function reportError(error, action) {
  console.error(action, error);

  if (error?.code === "permission-denied") {
    alert(
      action +
      " failed. Check Firebase Firestore Security Rules."
    );
    return;
  }

  alert(
    action +
    " failed: " +
    (error?.message || "Unknown error")
  );
}

/* ========== LOCAL STORAGE ========== */

function storageKey(type, chatId) {
  return (
    "chatx_" +
    type +
    "_" +
    currentUser?.uid +
    "_" +
    chatId
  );
}

function getStoredNumber(type, chatId) {
  try {
    return Number(
      localStorage.getItem(
        storageKey(type, chatId)
      )
    ) || 0;
  } catch {
    return 0;
  }
}

function setStoredNumber(type, chatId, value) {
  try {
    localStorage.setItem(
      storageKey(type, chatId),
      String(value)
    );
  } catch (error) {
    console.warn("Storage unavailable:", error);
  }
}

function getLastRead(chatId) {
  return getStoredNumber("read", chatId);
}

function getClearTime(chatId) {
  return getStoredNumber("clear", chatId);
}

function getDeleteTime(chatId) {
  return getStoredNumber("deleted", chatId);
}

function markChatRead(chatId) {
  if (!currentUser || !chatId) return;

  setStoredNumber(
    "read",
    chatId,
    Date.now()
  );

  renderChats($("searchInput").value);
}

/* ========== CLEAR CHAT ========== */

function clearCurrentChat() {
  if (!currentUser || !activeChatId) return;

  const confirmed = confirm(
    "Clear this chat?\n\n" +
    "All previous messages will be hidden " +
    "on this device only.\n\n" +
    "The other person will still have them."
  );

  if (!confirmed) return;

  setStoredNumber(
    "clear",
    activeChatId,
    Date.now()
  );

  renderMessages(currentMessages);

  showNotification(
    "Chat cleared",
    "Previous messages are hidden on this device."
  );
}

/* ========== DELETE CHAT ========== */

function deleteCurrentChat() {
  if (!currentUser || !activeChatId) return;

  const confirmed = confirm(
    "Delete this conversation?\n\n" +
    "It will disappear from your chat list " +
    "on this device.\n\n" +
    "The other person's chat will not be deleted."
  );

  if (!confirmed) return;

  const chatId = activeChatId;
  const now = Date.now();

  setStoredNumber(
    "deleted",
    chatId,
    now
  );

  setStoredNumber(
    "clear",
    chatId,
    now
  );

  goHome();

  renderChats($("searchInput").value);

  showNotification(
    "Chat deleted",
    "Conversation removed from your list."
  );
}

/* ========== CHAT OPTIONS MENU ========== */

const chatOptionsStyle = document.createElement("style");

chatOptionsStyle.textContent = `
.chatx-options-overlay {
  position:fixed;
  inset:0;
  background:rgba(0,0,0,.55);
  z-index:99998;
  display:flex;
  align-items:center;
  justify-content:center;
  padding:20px;
  box-sizing:border-box;
}

.chatx-options-card {
  width:100%;
  max-width:350px;
  background:#192542;
  color:white;
  border:1px solid #40537b;
  border-radius:20px;
  padding:22px;
  box-sizing:border-box;
  font-family:Arial,sans-serif;
}

.chatx-options-card h3 {
  margin:0 0 8px;
}

.chatx-options-card p {
  color:#aebbd4;
  font-size:13px;
  margin:0 0 20px;
}

.chatx-option-btn {
  width:100%;
  padding:14px;
  margin-top:10px;
  border:1px solid #40537b;
  border-radius:12px;
  background:#101a31;
  color:white;
  font-size:14px;
  cursor:pointer;
  text-align:left;
}

.chatx-option-danger {
  color:#ff8da2;
}

.chatx-option-cancel {
  text-align:center;
  background:#263657;
}

.chatx-notification {
  position:fixed;
  top:18px;
  left:50%;
  transform:translateX(-50%);
  width:calc(100% - 36px);
  max-width:400px;
  background:#192542;
  color:white;
  padding:15px;
  border-radius:15px;
  border:1px solid #5269aa;
  box-shadow:0 10px 35px #0008;
  z-index:99999;
  box-sizing:border-box;
  font-family:Arial,sans-serif;
  cursor:pointer;
}

.chatx-notification strong {
  display:block;
  margin-bottom:6px;
  color:#79d4ff;
}

.chatx-notification p {
  margin:0;
  font-size:13px;
  overflow-wrap:anywhere;
}

.chatx-badge {
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-width:19px;
  height:19px;
  padding:0 4px;
  border-radius:20px;
  background:#ff4568;
  color:white;
  font-size:11px;
  font-weight:bold;
  margin-left:8px;
  box-sizing:border-box;
}

.chatx-story {
  cursor:pointer;
}

.chatx-story-name {
  max-width:75px;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
`;

document.head.appendChild(chatOptionsStyle);

function closeChatOptions() {
  document.querySelector(
    ".chatx-options-overlay"
  )?.remove();
}

function openChatOptions() {
  if (!activeChatId) return;

  closeChatOptions();

  const overlay = document.createElement("div");
  overlay.className = "chatx-options-overlay";

  const card = document.createElement("div");
  card.className = "chatx-options-card";

  const title = document.createElement("h3");
  title.textContent = "Chat Options ⋮";

  const description = document.createElement("p");
  description.textContent =
    activeChatUser?.displayName ||
    "Manage conversation";

  const clearBtn = document.createElement("button");
  clearBtn.className = "chatx-option-btn";
  clearBtn.textContent = "🧹 Clear Chat";

  const deleteBtn = document.createElement("button");
  deleteBtn.className =
    "chatx-option-btn chatx-option-danger";
  deleteBtn.textContent = "🗑️ Delete Chat";

  const cancelBtn = document.createElement("button");
  cancelBtn.className =
    "chatx-option-btn chatx-option-cancel";
  cancelBtn.textContent = "Cancel";

  clearBtn.onclick = () => {
    closeChatOptions();
    clearCurrentChat();
  };

  deleteBtn.onclick = () => {
    closeChatOptions();
    deleteCurrentChat();
  };

  cancelBtn.onclick = closeChatOptions;

  overlay.onclick = event => {
    if (event.target === overlay) {
      closeChatOptions();
    }
  };

  card.append(
    title,
    description,
    clearBtn,
    deleteBtn,
    cancelBtn
  );

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

$("chatInfoBtn").addEventListener(
  "click",
  openChatOptions
);

/* ========== NOTIFICATION SOUND ========== */

let audioContext = null;

function playNotificationSound() {
  try {
    const AudioContextClass =
      window.AudioContext ||
      window.webkitAudioContext;

    if (!AudioContextClass) return;

    if (!audioContext) {
      audioContext = new AudioContextClass();
    }

    if (audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = 850;

    gain.gain.setValueAtTime(
      0.06,
      audioContext.currentTime
    );

    gain.gain.exponentialRampToValueAtTime(
      0.001,
      audioContext.currentTime + 0.18
    );

    oscillator.connect(gain);
    gain.connect(audioContext.destination);

    oscillator.start();
    oscillator.stop(
      audioContext.currentTime + 0.18
    );

  } catch (error) {
    console.warn("Sound unavailable:", error);
  }
}

document.addEventListener("click", () => {
  if (
    audioContext &&
    audioContext.state === "suspended"
  ) {
    audioContext.resume().catch(() => {});
  }
});

/* ========== NOTIFICATIONS ========== */

function showNotification(title, message, onClick) {
  document.querySelectorAll(".chatx-notification")
    .forEach(item => item.remove());

  const box = document.createElement("div");
  box.className = "chatx-notification";

  const heading = document.createElement("strong");
  heading.textContent = "🔔 " + title;

  const description = document.createElement("p");
  description.textContent = message;

  box.append(heading, description);

  if (typeof onClick === "function") {
    box.onclick = () => {
      box.remove();
      onClick();
    };
  }

  document.body.appendChild(box);

  playNotificationSound();

  setTimeout(() => box.remove(), 4500);
}

/* ========== UNREAD ========== */

function isUnread(chat) {
  if (!currentUser) return false;

  if (!chat.lastSenderId) return false;

  if (chat.lastSenderId === currentUser.uid) {
    return false;
  }

  if (activeChatId === chat.id) {
    return false;
  }

  return getTimestamp(chat.updatedAt) >
    Math.max(
      getLastRead(chat.id),
      getDeleteTime(chat.id)
    );
}

/* ========== AUTH STATE ========== */

onAuthStateChanged(auth, async user => {
  sessionVersion++;

  const thisSession = sessionVersion;

  stopListeners();

  currentUser = user;

  registeredUsers = [];
  conversations = [];
  stories = [];
  currentMessages = [];

  activeChatId = null;
  activeChatUser = null;
  activeStoryId = null;

  knownChatUpdates.clear();
  notificationsReady = false;

  if (!user) {
    chatList.innerHTML = "";
    peopleList.innerHTML = "";
    messagesBox.innerHTML = "";

    $("chatCount").textContent = "0 chats";
    $("peopleCount").textContent = "0 people";

    renderStories();
    showScreen(homeScreen);
    return;
  }

  try {
    await createUserProfile(user);

    if (thisSession !== sessionVersion) {
      return;
    }

    startUsersListener();
    startChatsListener();
    startStoriesListener();

    renderProfile();
    goHome();

    console.log("ChatX connected:", user.uid);

  } catch (error) {
    if (thisSession === sessionVersion) {
      reportError(error, "Firebase initialization");
    }
  }
});

/* ========== USER PROFILE ========== */

async function createUserProfile(user) {
  const userRef = doc(db, "users", user.uid);
  const snapshot = await getDoc(userRef);

  const name = getDisplayName(user);

  if (!snapshot.exists()) {
    await setDoc(userRef, {
      uid: user.uid,
      displayName: name,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

  } else if (
    snapshot.data().displayName !== name
  ) {
    await updateDoc(userRef, {
      displayName: name,
      updatedAt: serverTimestamp()
    });
  }
}

/* ========== USERS LISTENER ========== */

function startUsersListener() {
  const myUid = currentUser.uid;

  usersUnsubscribe = onSnapshot(
    collection(db, "users"),

    snapshot => {
      if (currentUser?.uid !== myUid) return;

      registeredUsers = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));

      renderPeople($("peopleSearch").value);
      renderChats($("searchInput").value);
      renderStories();
    },

    error => reportError(error, "Loading users")
  );
}

/* ========== CHAT LISTENER ========== */

function startChatsListener() {
  const myUid = currentUser.uid;

  const chatsQuery = query(
    collection(db, "conversations"),
    where("participants", "array-contains", myUid)
  );

  chatsUnsubscribe = onSnapshot(
    chatsQuery,

    snapshot => {
      if (currentUser?.uid !== myUid) return;

      const updatedChats = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));

      updatedChats.sort(
        (a, b) =>
          getTimestamp(b.updatedAt) -
          getTimestamp(a.updatedAt)
      );

      if (notificationsReady) {
        updatedChats.forEach(chat => {
          const timestamp =
            getTimestamp(chat.updatedAt);

          const previous =
            knownChatUpdates.get(chat.id);

          if (
            previous !== undefined &&
            timestamp > previous &&
            chat.lastSenderId &&
            chat.lastSenderId !== myUid &&
            chat.id !== activeChatId &&
            !snapshot.metadata.fromCache &&
            !snapshot.metadata.hasPendingWrites
          ) {
            const otherId = getOtherUserId(chat);

            const person = findUser(otherId) || {
              uid: otherId,
              displayName: getChatName(chat)
            };

            showNotification(
              getChatName(chat),
              chat.lastMessage || "New message",
              () => openChatWithUser(person)
            );
          }
        });
      }

      updatedChats.forEach(chat => {
        const timestamp =
          getTimestamp(chat.updatedAt);

        if (timestamp) {
          knownChatUpdates.set(
            chat.id,
            Math.max(
              knownChatUpdates.get(chat.id) || 0,
              timestamp
            )
          );
        }
      });

      conversations = updatedChats;

      if (!snapshot.metadata.fromCache) {
        notificationsReady = true;
      }

      renderChats($("searchInput").value);
    },

    error => reportError(error, "Loading conversations")
  );
}

/* ========== STOP LISTENERS ========== */

function stopListeners() {
  if (usersUnsubscribe) usersUnsubscribe();
  if (chatsUnsubscribe) chatsUnsubscribe();
  if (messagesUnsubscribe) messagesUnsubscribe();
  if (storiesUnsubscribe) storiesUnsubscribe();

  usersUnsubscribe = null;
  chatsUnsubscribe = null;
  messagesUnsubscribe = null;
  storiesUnsubscribe = null;

  clearTimeout(storyTimer);
  clearInterval(storyRefreshInterval);

  storyTimer = null;
  storyRefreshInterval = null;
}

/* ========== USER HELPERS ========== */

function findUser(uid) {
  return registeredUsers.find(
    user => user.uid === uid
  );
}

function getOtherUserId(chat) {
  return chat.participants?.find(
    uid => uid !== currentUser?.uid
  );
}

function getChatName(chat) {
  const otherId = getOtherUserId(chat);

  return findUser(otherId)?.displayName ||
    chat.participantNames?.[otherId] ||
    "ChatX User";
}

/* ========== CHAT LIST ========== */

function renderChats(search = "") {
  if (!chatList || !currentUser) return;

  chatList.innerHTML = "";

  const visibleChats = conversations.filter(chat => {
    const deletedAt = getDeleteTime(chat.id);

    if (!deletedAt) return true;

    return getTimestamp(chat.updatedAt) > deletedAt;
  });

  $("chatCount").textContent =
    `${visibleChats.length} chats`;

  const filtered = visibleChats.filter(
    chat => getChatName(chat)
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  if (!filtered.length) {
    showEmpty(
      chatList,
      search
        ? "No matching conversations found."
        : "No conversations yet. Tap + to start chatting!"
    );
    return;
  }

  filtered.forEach(chat => {
    const otherId = getOtherUserId(chat);
    const name = getChatName(chat);

    const item = document.createElement("div");
    item.className = "chat-item";

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = getInitial(name);

    const details = document.createElement("div");
    details.className = "chat-details";

    const title = document.createElement("h3");
    title.textContent = name;

    const preview = document.createElement("p");

    const clearedAt = Math.max(
      getClearTime(chat.id),
      getDeleteTime(chat.id)
    );

    preview.textContent =
      clearedAt &&
      getTimestamp(chat.updatedAt) <= clearedAt
        ? "No messages"
        : chat.lastMessage ||
          "Start your conversation ✨";

    details.append(title, preview);

    const meta = document.createElement("div");
    meta.className = "chat-meta";

    const time = document.createElement("time");
    time.textContent = formatTime(chat.updatedAt);

    meta.appendChild(time);

    if (isUnread(chat)) {
      const badge = document.createElement("span");
      badge.className = "chatx-badge";
      badge.textContent = "1";
      meta.appendChild(badge);
    }

    item.append(avatar, details, meta);

    item.onclick = () => {
      const person = findUser(otherId) || {
        uid: otherId,
        displayName: name
      };

      openChatWithUser(person);
    };

    chatList.appendChild(item);
  });
}

/* ========== PEOPLE DIRECTORY ========== */

function renderPeople(search = "") {
  if (!currentUser) return;

  peopleList.innerHTML = "";

  const allPeople = registeredUsers.filter(
    user => user.uid !== currentUser.uid
  );

  const filtered = allPeople.filter(
    user => (user.displayName || "")
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  $("peopleCount").textContent =
    `${allPeople.length} people`;

  if (!filtered.length) {
    showEmpty(
      peopleList,
      search
        ? "No matching users found."
        : "No registered users found yet."
    );
    return;
  }

  filtered.forEach(person => {
    const item = document.createElement("div");
    item.className = "chat-item";

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent =
      getInitial(person.displayName);

    const details = document.createElement("div");
    details.className = "chat-details";

    const name = document.createElement("h3");
    name.textContent =
      person.displayName || "ChatX User";

    const status = document.createElement("p");
    status.textContent = "Tap to start chatting";

    details.append(name, status);
    item.append(avatar, details);

    item.onclick = () => openChatWithUser(person);

    peopleList.appendChild(item);
  });
}

/* ========== NEW CHAT ========== */

function showNewChatModal() {
  $("newChatName").value = "";
  openModal("newChatModal");
}

$("newChatBtn").onclick = showNewChatModal;
$("addPersonBtn").onclick = showNewChatModal;

$("cancelNewChat").onclick = () => {
  closeModal("newChatModal");
};

$("newChatForm").addEventListener(
  "submit",
  async event => {
    event.preventDefault();

    if (!currentUser) return;

    const name = $("newChatName").value
      .trim()
      .toLowerCase();

    const matches = registeredUsers.filter(
      user =>
        user.uid !== currentUser.uid &&
        (user.displayName || "")
          .toLowerCase() === name
    );

    if (!matches.length) {
      alert(
        "User not found. Your friend must create a ChatX account first."
      );
      return;
    }

    if (matches.length > 1) {
      alert(
        "Multiple users have this name. Select your friend from People."
      );
      return;
    }

    closeModal("newChatModal");

    await openChatWithUser(matches[0]);
  }
);

/* ========== OPEN CHAT ========== */

async function openChatWithUser(person) {
  if (!currentUser || !person?.uid) return;

  if (person.uid === currentUser.uid) {
    alert("You cannot chat with yourself.");
    return;
  }

  const myUid = currentUser.uid;
  const thisSession = sessionVersion;

  const participants = [
    myUid,
    person.uid
  ].sort();

  const chatId = participants.join("__");

  const chatRef = doc(
    db,
    "conversations",
    chatId
  );

  try {
    const snapshot = await getDoc(chatRef);

    if (
      thisSession !== sessionVersion ||
      currentUser?.uid !== myUid
    ) return;

    if (!snapshot.exists()) {
      await setDoc(chatRef, {
        participants,
        participantNames: {
          [myUid]: getDisplayName(currentUser),
          [person.uid]:
            person.displayName || "ChatX User"
        },
        lastMessage: "",
        lastSenderId: "",
        updatedAt: serverTimestamp()
      });
    }

    if (
      thisSession !== sessionVersion ||
      currentUser?.uid !== myUid
    ) return;

    if (messagesUnsubscribe) {
      messagesUnsubscribe();
      messagesUnsubscribe = null;
    }

    activeChatId = chatId;
    activeChatUser = person;
    currentMessages = [];

    $("chatUsername").textContent =
      person.displayName || "ChatX User";

    $("chatAvatar").textContent =
      getInitial(person.displayName);

    $("chatStatus").textContent =
      "Real-time conversation";

    $("messageInput").value = "";
    messagesBox.innerHTML = "";

    showScreen(chatScreen);

    markChatRead(chatId);
    startMessagesListener(chatId);

  } catch (error) {
    reportError(error, "Opening chat");
  }
}

/* ========== MESSAGE LISTENER ========== */

function startMessagesListener(chatId) {
  const messagesQuery = query(
    collection(
      db,
      "conversations",
      chatId,
      "messages"
    ),
    orderBy("createdAt", "asc")
  );

  messagesUnsubscribe = onSnapshot(
    messagesQuery,

    snapshot => {
      if (activeChatId !== chatId) return;

      currentMessages = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));

      renderMessages(currentMessages);
      markChatRead(chatId);
    },

    error => reportError(error, "Loading messages")
  );
}

/* ========== RENDER MESSAGES ========== */

function renderMessages(messages = []) {
  messagesBox.innerHTML = "";

  if (!activeChatId) return;

  const hiddenUntil = Math.max(
    getClearTime(activeChatId),
    getDeleteTime(activeChatId)
  );

  const visibleMessages = messages.filter(
    message =>
      getTimestamp(message.createdAt) > hiddenUntil
  );

  if (!visibleMessages.length) {
    showEmpty(
      messagesBox,
      "Your conversation starts here. Send a message!"
    );
    return;
  }

  visibleMessages.forEach(message => {
    const bubble = document.createElement("div");

    const isMine =
      message.senderId === currentUser?.uid;

    bubble.className =
      "message " +
      (isMine ? "sent" : "received");

    const text = document.createElement("div");
    text.className = "message-text";
    text.textContent = message.text || "";

    const time = document.createElement("small");
    time.className = "message-time";
    time.textContent =
      formatTime(message.createdAt);

    bubble.append(text, time);
    messagesBox.appendChild(bubble);
  });

  messagesBox.scrollTop =
    messagesBox.scrollHeight;
}

/* ========== SEND MESSAGE ========== */

$("messageForm").addEventListener(
  "submit",
  async event => {
    event.preventDefault();

    if (!currentUser || !activeChatId) {
      return;
    }

    const input = $("messageInput");
    const text = input.value.trim();

    if (!text) return;

    const chatId = activeChatId;
    const senderId = currentUser.uid;

    const button =
      event.currentTarget.querySelector(
        'button[type="submit"]'
      );

    if (button) button.disabled = true;

    try {
      await addDoc(
        collection(
          db,
          "conversations",
          chatId,
          "messages"
        ),
        {
          senderId,
          text,
          createdAt: serverTimestamp()
        }
      );

      await updateDoc(
        doc(db, "conversations", chatId),
        {
          lastMessage: text,
          lastSenderId: senderId,
          updatedAt: serverTimestamp()
        }
      );

      if (activeChatId === chatId) {
        input.value = "";
        markChatRead(chatId);
      }

    } catch (error) {
      reportError(error, "Sending message");

    } finally {
      if (button) button.disabled = false;
    }
  }
);

/* ========== SHARED STORIES ========== */

function startStoriesListener() {
  const myUid = currentUser.uid;

  storiesUnsubscribe = onSnapshot(
    collection(db, "stories"),

    snapshot => {
      if (currentUser?.uid !== myUid) {
        return;
      }

      stories = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }));

      renderStories();
    },

    error => reportError(error, "Loading stories")
  );

  storyRefreshInterval = setInterval(() => {
    renderStories();

    if (
      activeStoryId &&
      !getActiveStories().some(
        story => story.id === activeStoryId
      )
    ) {
      closeStoryViewer();
    }
  }, 30000);
}

function getActiveStories() {
  const now = Date.now();

  return stories.filter(story => {
    const createdAt =
      getTimestamp(story.createdAt);

    if (!createdAt) return false;

    return (
      createdAt <= now &&
      now - createdAt < STORY_DURATION
    );
  }).sort(
    (a, b) =>
      getTimestamp(b.createdAt) -
      getTimestamp(a.createdAt)
  );
}

function renderStories() {
  if (!storiesList) return;

  storiesList.innerHTML = "";

  const addItem = document.createElement("div");
  addItem.className = "story-item";
  addItem.id = "addStory";

  const addRing = document.createElement("div");
  addRing.className = "story-ring add-ring";

  const addAvatar = document.createElement("div");
  addAvatar.className = "story-avatar";
  addAvatar.textContent = "+";

  const addLabel = document.createElement("p");
  addLabel.textContent = "Your Story";

  addRing.appendChild(addAvatar);
  addItem.append(addRing, addLabel);

  addItem.onclick = () => {
    if (!currentUser) return;

    $("storyText").value = "";
    openModal("storyModal");
  };

  storiesList.appendChild(addItem);

  if (!currentUser) return;

  getActiveStories().forEach(story => {
    const name =
      findUser(story.userId)?.displayName ||
      story.userName ||
      "ChatX User";

    const item = document.createElement("div");
    item.className = "story-item chatx-story";

    const ring = document.createElement("div");
    ring.className = "story-ring";

    const avatar = document.createElement("div");
    avatar.className = "story-avatar";
    avatar.textContent = getInitial(name);

    const label = document.createElement("p");
    label.className = "chatx-story-name";

    label.textContent =
      story.userId === currentUser.uid
        ? "You"
        : name;

    ring.appendChild(avatar);
    item.append(ring, label);

    item.onclick = () => {
      openStoryViewer(story);
    };

    storiesList.appendChild(item);
  });
}

/* ========== POST STORY ========== */

$("storyForm").addEventListener(
  "submit",
  async event => {
    event.preventDefault();

    if (!currentUser) return;

    const text = $("storyText").value.trim();

    if (!text) {
      alert("Write something for your Story.");
      return;
    }

    const button =
      event.currentTarget.querySelector(
        'button[type="submit"]'
      );

    if (button) button.disabled = true;

    try {
      await addDoc(
        collection(db, "stories"),
        {
          userId: currentUser.uid,
          userName: getDisplayName(currentUser),
          text,
          createdAt: serverTimestamp()
        }
      );

      $("storyText").value = "";
      closeModal("storyModal");

      showNotification(
        "Story posted",
        "Your Moment is visible to ChatX users."
      );

    } catch (error) {
      reportError(error, "Posting story");

    } finally {
      if (button) button.disabled = false;
    }
  }
);

/* ========== STORY VIEWER ========== */

function openStoryViewer(story) {
  if (!story) return;

  const timestamp =
    getTimestamp(story.createdAt);

  if (
    !timestamp ||
    Date.now() - timestamp >= STORY_DURATION
  ) {
    alert("This Story has expired.");
    return;
  }

  clearTimeout(storyTimer);

  activeStoryId = story.id;

  const name =
    findUser(story.userId)?.displayName ||
    story.userName ||
    "ChatX User";

  $("storyUsername").textContent = name;

  $("storyUserAvatar").textContent =
    getInitial(name);

  $("storyTime").textContent =
    formatStoryTime(timestamp);

  $("storyContent").textContent =
    story.text || "";

  const progress = $("storyProgressBar");

  progress.style.transition = "none";
  progress.style.width = "0%";

  showScreen(storyScreen);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      progress.style.transition =
        "width 6s linear";

      progress.style.width = "100%";
    });
  });

  storyTimer = setTimeout(() => {
    closeStoryViewer();
  }, 6000);
}

function closeStoryViewer() {
  clearTimeout(storyTimer);

  storyTimer = null;
  activeStoryId = null;

  goHome();
}

$("closeStory").onclick = closeStoryViewer;

$("cancelStory").onclick = () => {
  closeModal("storyModal");
};

/* ========== PROFILE ========== */

function renderProfile() {
  if (!currentUser) return;

  const name = getDisplayName(currentUser);

  $("displayProfileName").textContent = name;
  $("profileName").value = name;

  $("accountEmail").textContent =
    currentUser.email || "";
}

$("saveProfile").addEventListener(
  "click",
  async () => {
    if (!currentUser) return;

    const name = $("profileName").value.trim();

    if (name.length < 2) {
      alert("Name must contain at least 2 characters.");
      return;
    }

    const button = $("saveProfile");
    button.disabled = true;

    try {
      await updateProfile(currentUser, {
        displayName: name
      });

      await updateDoc(
        doc(db, "users", currentUser.uid),
        {
          displayName: name,
          updatedAt: serverTimestamp()
        }
      );

      $("displayProfileName").textContent =
        name;

      showNotification(
        "Profile updated",
        "Your display name has been saved."
      );

    } catch (error) {
      reportError(error, "Saving profile");

    } finally {
      button.disabled = false;
    }
  }
);

/* ========== NAVIGATION ========== */

function leaveChat() {
  if (messagesUnsubscribe) {
    messagesUnsubscribe();
    messagesUnsubscribe = null;
  }

  activeChatId = null;
  activeChatUser = null;
  currentMessages = [];

  closeChatOptions();
}

function goHome() {
  leaveChat();

  clearTimeout(storyTimer);

  storyTimer = null;
  activeStoryId = null;

  showScreen(homeScreen);
  selectTab("chatsTab");

  if (currentUser) {
    renderChats($("searchInput").value);
  }
}

function goPeople() {
  leaveChat();

  showScreen(peopleScreen);
  selectTab("peopleTab");

  if (currentUser) {
    renderPeople($("peopleSearch").value);
  }
}

function goProfile() {
  leaveChat();

  renderProfile();
  showScreen(profileScreen);
  selectTab("settingsTab");
}

$("backBtn").onclick = goHome;
$("peopleBack").onclick = goHome;
$("profileBack").onclick = goHome;
$("profileBtn").onclick = goProfile;

$("chatsTab").onclick = goHome;
$("peopleTab").onclick = goPeople;
$("settingsTab").onclick = goProfile;

$("storiesTab").onclick = () => {
  goHome();

  $("storiesList")?.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
};

/* ========== SEARCH ========== */

$("searchInput").addEventListener(
  "input",
  event => {
    renderChats(event.target.value);
  }
);

$("peopleSearch").addEventListener(
  "input",
  event => {
    renderPeople(event.target.value);
  }
);

/* ========== INITIAL UI ========== */

showScreen(homeScreen);

console.log(
  "ChatX Midnight Aurora v3.2 loaded successfully."
);
