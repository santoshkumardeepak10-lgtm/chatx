/* ==========================================
   CHATX — MIDNIGHT AURORA
   VERSION 3.1

   REAL-TIME CHAT
   SHARED 24-HOUR STORIES
   IN-APP NOTIFICATIONS
   UNREAD CHAT BADGES
   FIREBASE AUTH + FIRESTORE
========================================== */

"use strict";

/* ========== FIREBASE IMPORTS ========== */

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

/* ========== FIREBASE CONFIG ========== */

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
const storyScreen = $("storyScreen");
const profileScreen = $("profileScreen");
const peopleScreen = $("peopleScreen");

const chatList = $("chatList");
const peopleList = $("peopleList");
const messagesBox = $("messages");
const storiesList = $("storiesList");

/* ========== STATE ========== */

let currentUser = null;

let registeredUsers = [];
let conversations = [];
let stories = [];

let activeChatId = null;
let activeChatUser = null;

let usersUnsubscribe = null;
let chatsUnsubscribe = null;
let messagesUnsubscribe = null;
let storiesUnsubscribe = null;

let sessionVersion = 0;

let storyTimer = null;
let activeStoryId = null;

let notificationsReady = false;
let knownChatUpdates = new Map();

let storyRefreshInterval = null;

const STORY_DURATION = 24 * 60 * 60 * 1000;

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

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  return `${Math.floor(minutes / 60)}h ago`;
}

function showScreen(screen) {
  document.querySelectorAll(".screen")
    .forEach(item => {
      item.classList.remove("active");
    });

  if (screen) {
    screen.classList.add("active");
  }
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

function showEmpty(container, text) {
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

  div.textContent = text;

  container.appendChild(div);
}

function reportError(error, action) {
  console.error(action, error);

  if (error?.code === "permission-denied") {
    alert(
      action +
      " failed: Firebase permission denied. " +
      "Check Firestore Security Rules."
    );

    return;
  }

  alert(
    action +
    " failed. " +
    (error?.message || "Check internet connection.")
  );
}

/* ========== NOTIFICATION STYLES ========== */

const notificationStyle = document.createElement("style");

notificationStyle.textContent = `
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
  font-family:Arial,sans-serif;
  box-sizing:border-box;
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
  box-sizing:border-box;
  border-radius:20px;
  background:#ff4568;
  color:white;
  font-size:11px;
  font-weight:bold;
  margin-left:8px;
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

document.head.appendChild(notificationStyle);

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
    console.warn("Notification sound unavailable:", error);
  }
}

document.addEventListener("click", () => {
  if (!audioContext) return;

  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }
});

/* ========== SHOW NOTIFICATION ========== */

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
    box.addEventListener("click", () => {
      box.remove();
      onClick();
    });
  }

  document.body.appendChild(box);

  playNotificationSound();

  setTimeout(() => {
    box.remove();
  }, 4500);
}

/* ========== UNREAD TRACKING ========== */

function readKey(chatId) {
  return `chatx_read_${currentUser?.uid}_${chatId}`;
}

function getLastRead(chatId) {
  try {
    return Number(
      localStorage.getItem(readKey(chatId))
    ) || 0;
  } catch {
    return 0;
  }
}

function markChatRead(chatId) {
  if (!currentUser || !chatId) return;

  try {
    localStorage.setItem(
      readKey(chatId),
      String(Date.now())
    );
  } catch (error) {
    console.warn(error);
  }

  renderChats($("searchInput").value);
}

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
    getLastRead(chat.id);
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

  activeChatId = null;
  activeChatUser = null;

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

/* ========== CONVERSATIONS LISTENER ========== */

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
            const otherId =
              getOtherUserId(chat);

            const person =
              findUser(otherId) || {
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

  $("chatCount").textContent =
    `${conversations.length} chats`;

  const filtered = conversations.filter(
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
    preview.textContent =
      chat.lastMessage ||
      "Start your conversation ✨";

    details.append(title, preview);

    const meta = document.createElement("div");
    meta.className = "chat-meta";

    const time = document.createElement("time");
    time.textContent =
      formatTime(chat.updatedAt);

    meta.appendChild(time);

    if (isUnread(chat)) {
      const badge = document.createElement("span");
      badge.className = "chatx-badge";
      badge.textContent = "1";
      meta.appendChild(badge);
    }

    item.append(avatar, details, meta);

    item.addEventListener("click", () => {
      const person = findUser(otherId) || {
        uid: otherId,
        displayName: name
      };

      openChatWithUser(person);
    });

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

    item.addEventListener("click", () => {
      openChatWithUser(person);
    });

    peopleList.appendChild(item);
  });
}

/* ========== NEW CHAT ========== */

function showNewChatModal() {
  $("newChatName").value = "";
  openModal("newChatModal");
}

$("newChatBtn").addEventListener(
  "click",
  showNewChatModal
);

$("addPersonBtn").addEventListener(
  "click",
  showNewChatModal
);

$("cancelNewChat").addEventListener(
  "click",
  () => closeModal("newChatModal")
);

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

/* ========== MESSAGES LISTENER ========== */

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

      const messages = snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
     d,
        displayName: name
      };

      openChatWithUser(person);
    });

    chatList.appendChild(item);
  });
}

/* ---------- PEOPLE DIRECTORY ---------- */

function renderPeople(search = "") {
  if (!peopleList || !currentUser) return;

  peopleList.innerHTML = "";

  const allPeople = registeredUsers.filter(
    user => user.uid !== currentUser.uid
  );

  const people = allPeople.filter(
    user => (user.displayName || "")
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  $("peopleCount").textContent =
    `${allPeople.length} people`;

  if (people.length === 0) {
    showEmpty(
      peopleList,
      search
        ? "No matching users found."
        : "No registered users found yet."
    );

    return;
  }

  people.forEach(person => {
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

    item.addEventListener("click", () => {
      openChatWithUser(person);
    });

    peopleList.appendChild(item);
  });
}

/* ---------- NEW CHAT ---------- */

function showNewChatModal() {
  $("newChatName").value = "";
  openModal("newChatModal");
}

$("newChatBtn").addEventListener(
  "click",
  showNewChatModal
);

$("addPersonBtn").addEventListener(
  "click",
  showNewChatModal
);

$("cancelNewChat").addEventListener(
  "click",
  () => closeModal("newChatModal")
);

$("newChatForm").addEventListener(
  "submit",
  async event => {
    event.preventDefault();

    if (!currentUser) return;

    const name = $("newChatName").value
      .trim()
      .toLowerCase();

    if (!name) return;

    const matches = registeredUsers.filter(
      user =>
        user.uid !== currentUser.uid &&
        (user.displayName || "")
          .toLowerCase() === name
    );

    if (matches.length === 0) {
      alert(
        "User not found. Your friend must create a ChatX account first."
      );
      return;
    }

    if (matches.length > 1) {
      alert(
        "Multiple users have this name. Please select your friend from the People section."
      );
      return;
    }

    closeModal("newChatModal");

    await openChatWithUser(matches[0]);
  }
);

/* ---------- CREATE OR OPEN CHAT ---------- */

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
    ) {
      return;
    }

    if (!snapshot.exists()) {
      await setDoc(chatRef, {
        participants,
        participantNames: {
          [myUid]: getDisplayName(currentUser),
          [person.uid]:
            person.displayName || "ChatX User"
        },
        lastMessage: "",
        updatedAt: serverTimestamp()
      });
    }

    if (
      thisSession !== sessionVersion ||
      currentUser?.uid !== myUid
    ) {
      return;
    }

    if (messagesUnsubscribe) {
      messagesUnsubscribe();
      messagesUnsubscribe = null;
    }

    activeChatId = chatId;
    activeChatUser = person;

    $("chatUsername").textContent =
      person.displayName || "ChatX User";

    $("chatAvatar").textContent =
      getInitial(person.displayName);

    $("chatStatus").textContent =
      "Real-time conversation";

    $("messageInput").value = "";

    messagesBox.innerHTML = "";

    showScreen(chatScreen);

    startMessagesListener(chatId);

  } catch (error) {
    reportError(error, "Opening chat");
  }
}

/* ---------- MESSAGES LISTENER ---------- */

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

      const messages = snapshot.docs.map(
        item => ({
          id: item.id,
          ...item.data()
        })
      );

      renderMessages(messages);
    },

    error => {
      reportError(error, "Loading messages");
    }
  );
}

/* ---------- RENDER MESSAGES ---------- */

function renderMessages(messages = []) {
  messagesBox.innerHTML = "";

  if (messages.length === 0) {
    showEmpty(
      messagesBox,
      "Your conversation starts here. Send a message!"
    );

    return;
  }

  messages.forEach(message => {
    const bubble = document.createElement("div");

    const isMine =
      message.senderId === currentUser?.uid;

    bubble.className =
      `message ${isMine ? "sent" : "received"}`;

    const text = document.createElement("div");
    text.textContent = message.text || "";

    const time = document.createElement("span");
    time.className = "message-time";

    time.textContent = formatTime(
      message.createdAt
    );

    bubble.append(text, time);

    messagesBox.appendChild(bubble);
  });

  const container = document.querySelector(
    ".chat-background"
  );

  if (container) {
    container.scrollTop =
      container.scrollHeight;
  }
}

/* ---------- SEND MESSAGE ---------- */

$("messageForm").addEventListener(
  "submit",
  async event => {
    event.preventDefault();

    if (!currentUser || !activeChatId) {
      return;
    }

    const input = $("messageInput");
    const text = input.value.trim();

    if (!text || text.length > 2000) {
      return;
    }

    const chatId = activeChatId;
    const senderId = currentUser.uid;
    const thisSession = sessionVersion;

    const sendButton = $("messageForm")
      .querySelector('button[type="submit"]');

    sendButton.disabled = true;

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

      if (
        thisSession === sessionVersion &&
        activeChatId === chatId
      ) {
        input.value = "";
      }

      await updateDoc(
        doc(db, "conversations", chatId),
        {
          lastMessage: text,
          updatedAt: serverTimestamp()
        }
      );

    } catch (error) {
      reportError(error, "Sending message");

    } finally {
      sendButton.disabled = false;
    }
  }
);

/* ---------- CHAT NAVIGATION ---------- */

function goHome() {
  activeChatId = null;
  activeChatUser = null;

  if (messagesUnsubscribe) {
    messagesUnsubscribe();
    messagesUnsubscribe = null;
  }

  selectTab("chatsTab");
  showScreen(homeScreen);

  renderChats(
    $("searchInput").value
  );
}

$("backBtn").addEventListener(
  "click",
  goHome
);

$("chatInfoBtn").addEventListener(
  "click",
  () => {
    alert(
      "ChatX Real-Time Chat\n\n" +
      "Friend: " +
      (activeChatUser?.displayName || "Unknown") +
      "\n\nMessages are stored in Firebase Firestore.\n" +
      "This app does not currently provide end-to-end encryption."
    );
  }
);

/* ---------- CHAT SEARCH ---------- */

$("searchInput").addEventListener(
  "input",
  event => {
    renderChats(event.target.value);
  }
);

/* ---------- PEOPLE NAVIGATION ---------- */

$("peopleTab").addEventListener(
  "click",
  () => {
    selectTab("peopleTab");

    $("peopleSearch").value = "";

    renderPeople();

    showScreen(peopleScreen);
  }
);

$("peopleBack").addEventListener(
  "click",
  goHome
);

$("peopleSearch").addEventListener(
  "input",
  event => {
    renderPeople(event.target.value);
  }
);

/* ---------- PROFILE ---------- */

function renderProfile() {
  if (!currentUser) return;

  const name = getDisplayName(currentUser);

  $("displayProfileName").textContent = name;
  $("profileName").value = name;

  $("accountEmail").textContent =
    currentUser.email || "";
}

function openProfile() {
  renderProfile();
  showScreen(profileScreen);
}

$("profileBtn").addEventListener(
  "click",
  openProfile
);

$("profileBack").addEventListener(
  "click",
  goHome
);

$("saveProfile").addEventListener(
  "click",
  async () => {
    if (!currentUser) return;

    const name = $("profileName").value.trim();

    if (name.length < 2 || name.length > 30) {
      alert(
        "Name must contain 2 to 30 characters."
      );
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
          uid: currentUser.uid,
          displayName: name,
          updatedAt: serverTimestamp()
        }
      );

      renderProfile();

      alert("Profile saved successfully!");

    } catch (error) {
      reportError(error, "Saving profile");

    } finally {
      button.disabled = false;
    }
  }
);

/* ---------- STORIES ---------- */

const STORY_DURATION =
  24 * 60 * 60 * 1000;

function removeExpiredStories() {
  const now = Date.now();

  const oldLength = appData.stories.length;

  appData.stories = appData.stories.filter(
    story =>
      story.createdAt <= now &&
      now - story.createdAt < STORY_DURATION
  );

  if (appData.stories.length !== oldLength) {
    saveData();
  }
}

function renderStories() {
  removeExpiredStories();

  storiesList.innerHTML = "";

  const addItem = document.createElement("div");
  addItem.className = "story-item";

  addItem.innerHTML = `
    <div class="story-ring add-ring">
      <div class="story-avatar">+</div>
    </div>
    <p>Your Story</p>
  `;

  addItem.addEventListener("click", () => {
    $("storyText").value = "";
    openModal("storyModal");
  });

  storiesList.appendChild(addItem);

  const sortedStories = [
    ...appData.stories
  ].sort(
    (a, b) => b.createdAt - a.createdAt
  );

  sortedStories.forEach(story => {
    const item = document.createElement("div");
    item.className = "story-item";

    const ring = document.createElement("div");
    ring.className = "story-ring";

    const avatar = document.createElement("div");
    avatar.className = "story-avatar";

    avatar.textContent =
      getInitial(story.username);

    ring.appendChild(avatar);

    const name = document.createElement("p");
    name.textContent = story.username;

    item.append(ring, name);

    item.addEventListener("click", () => {
      openStory(story.id);
    });

    storiesList.appendChild(item);
  });
}

/* ---------- CREATE STORY ---------- */

$("storyForm").addEventListener(
  "submit",
  event => {
    event.preventDefault();

    const text = $("storyText").value.trim();

    if (!text || !currentUser) return;

    const story = {
      id: makeId(),
      username: getDisplayName(currentUser),
      text,
      createdAt: Date.now()
    };

    appData.stories.push(story);

    saveData();
    renderStories();

    closeModal("storyModal");

    openStory(story.id);
  }
);

$("cancelStory").addEventListener(
  "click",
  () => closeModal("storyModal")
);

/* ---------- VIEW STORY ---------- */

function openStory(storyId) {
  removeExpiredStories();

  const story = appData.stories.find(
    item => item.id === storyId
  );

  if (!story) {
    renderStories();
    return;
  }

  clearInterval(storyTimer);

  activeStoryId = storyId;

  $("storyUsername").textContent =
    story.username;

  $("storyUserAvatar").textContent =
    getInitial(story.username);

  $("storyTime").textContent =
    formatStoryTime(story.createdAt);

  $("storyContent").textContent =
    story.text;

  $("storyProgressBar").style.width = "0%";

  showScreen(storyScreen);

  const startTime = Date.now();
  const viewDuration = 7000;

  storyTimer = setInterval(() => {
    const elapsed = Date.now() - startTime;

    const progress = Math.min(
      100,
      (elapsed / viewDuration) * 100
    );

    $("storyProgressBar").style.width =
      `${progress}%`;

    if (progress >= 100) {
      closeStory();
    }
  }, 50);
}

function closeStory() {
  clearInterval(storyTimer);

  storyTimer = null;
  activeStoryId = null;

  showScreen(homeScreen);

  renderStories();

  selectTab("chatsTab");
}

$("closeStory").addEventListener(
  "click",
  closeStory
);

/* ---------- BOTTOM NAVIGATION ---------- */

$("chatsTab").addEventListener(
  "click",
  goHome
);

$("storiesTab").addEventListener(
  "click",
  () => {
    selectTab("storiesTab");

    showScreen(homeScreen);
    renderStories();

    $("storiesList").scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });
  }
);

$("settingsTab").addEventListener(
  "click",
  () => {
    selectTab("settingsTab");
    openProfile();
  }
);

/* ---------- CLOSE MODALS ---------- */

document.querySelectorAll(".modal")
  .forEach(modal => {
    modal.addEventListener(
      "click",
      event => {
        if (event.target === modal) {
          modal.classList.add("hidden");
        }
      }
    );
  });

/* ---------- ANDROID BACK BUTTON ---------- */

document.addEventListener(
  "keydown",
  event => {
    if (event.key !== "Escape") return;

    const visibleModal =
      document.querySelector(
        ".modal:not(.hidden)"
      );

    if (visibleModal) {
      visibleModal.classList.add("hidden");
      return;
    }

    if (
      storyScreen.classList.contains("active")
    ) {
      closeStory();
      return;
    }

    if (
      chatScreen.classList.contains("active") ||
      profileScreen.classList.contains("active") ||
      peopleScreen.classList.contains("active")
    ) {
      goHome();
    }
  }
);

/* ---------- STORY EXPIRATION ---------- */

setInterval(() => {
  const previousCount = appData.stories.length;

  removeExpiredStories();

  if (
    previousCount !== appData.stories.length
  ) {
    renderStories();

    if (activeStoryId) {
      const exists = appData.stories.some(
        story => story.id === activeStoryId
      );

      if (!exists) {
        closeStory();
      }
    }
  }
}, 60000);

/* ---------- INITIAL UI ---------- */

removeExpiredStories();

renderStories();

showEmpty(
  chatList,
  "Sign in to load your conversations."
);

selectTab("chatsTab");
showScreen(homeScreen);

console.log(
  "ChatX Midnight Aurora v2.0 loaded."
);
