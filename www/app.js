
(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);

  const authScreen = $("#auth-screen");
  const appScreen = $("#app-screen");
  const authForm = $("#auth-form");
  const authError = $("#auth-error");
  const nameField = $("#name-field");
  const authName = $("#auth-name");
  const authEmail = $("#auth-email");
  const authPassword = $("#auth-password");
  const contactList = $("#contact-list");
  const messagesBox = $("#messages");
  const welcomePanel = $("#welcome-panel");
  const chatHeader = $("#chat-header");
  const composer = $("#composer");
  const messageInput = $("#message-input");
  const typingLine = $("#typing-line");
  const typingLabel = $("#typing-label");
  const uploadProgress = $("#upload-progress");
  const toastBox = $("#toast");

  let auth = null;
  let db = null;
  let rtdb = null;
  let currentUser = null;
  let myProfile = null;
  let authMode = "login";
  let selectedUser = null;
  let selectedChatId = null;

  let usersCache = [];
  let chatsCache = [];

  let usersUnsub = null;
  let chatsUnsub = null;
  let messagesUnsub = null;

  let typingRef = null;
  let statusRef = null;
  let presenceRef = null;
  let connectedRef = null;

  let toastTimer = null;
  let typingTimer = null;
  let isSending = false;
  let authReady = false;
  let chatGeneration = 0;

  const MAX_ATTACHMENT_BYTES = 300 * 1024;
  const MAX_MESSAGE_LENGTH = 5000;

  const unsubscribe = (fn) => {
    if (typeof fn === "function") {
      try {
        fn();
      } catch (_) {}
    }
  };

  const escapeHTML = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);

  const initials = (name) =>
    String(name || "?")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] || "")
      .join("")
      .toUpperCase() || "?";

  const timestampDate = (value) => {
    if (value?.toDate) return value.toDate();
    if (typeof value === "number") return new Date(value);
    if (value instanceof Date) return value;
    return null;
  };

  const formatTime = (value) => {
    const date = timestampDate(value);
    if (!date || Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const formatDay = (value) => {
    const date = timestampDate(value) || new Date();
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return "HARI INI";
    if (date.toDateString() === yesterday.toDateString()) return "KEMARIN";

    return date.toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric"
    }).toUpperCase();
  };

  const formatSize = (size) => {
    if (size < 1024) return `${size} B`;
    if (size < 1048576) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / 1048576).toFixed(1)} MB`;
  };

  const serverTimestamp = () =>
    firebase.firestore.FieldValue.serverTimestamp();

  function toast(message) {
    if (!toastBox) {
      console.log(message);
      return;
    }

    toastBox.textContent = message;
    toastBox.classList.add("show");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastBox.classList.remove("show");
    }, 3200);
  }

  function friendlyError(error) {
    const code = error?.code || "";

    const messages = {
      "auth/email-already-in-use": "Email sudah terdaftar.",
      "auth/invalid-email": "Format email tidak valid.",
      "auth/weak-password": "Password minimal 6 karakter.",
      "auth/invalid-credential": "Email atau password salah.",
      "auth/user-not-found": "Akun tidak ditemukan.",
      "auth/wrong-password": "Email atau password salah.",
      "auth/too-many-requests": "Terlalu banyak percobaan. Coba lagi nanti.",
      "auth/network-request-failed": "Koneksi internet bermasalah.",
      "permission-denied": "Akses ditolak. Periksa Firestore Security Rules.",
      "storage/unauthorized": "Upload Storage tidak diaktifkan.",
      "unavailable": "Layanan tidak tersedia. Periksa koneksi internet.",
      "failed-precondition": "Operasi gagal. Periksa konfigurasi database.",
      "resource-exhausted": "Kuota Firebase mungkin sudah tercapai."
    };

    console.error(error);
    return messages[code] || error?.message || "Terjadi kesalahan.";
  }

  function setAuthMode(mode) {
    authMode = mode;

    document.querySelectorAll("[data-auth-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.authTab === mode);
    });

    nameField?.classList.toggle("hidden", mode !== "register");

    const submitButton = $("#auth-submit");
    if (submitButton) {
      submitButton.innerHTML = mode === "login"
        ? 'Masuk'
        : 'Buat akun';
    }

    if (authPassword) {
      authPassword.autocomplete =
        mode === "login" ? "current-password" : "new-password";
    }

    if (authError) authError.textContent = "";
  }

  document.querySelectorAll("[data-auth-tab]").forEach((button) => {
    button.addEventListener("click", () => setAuthMode(button.dataset.authTab));
  });

  function chatIdFor(uidA, uidB) {
    return [uidA, uidB].sort().join("_");
  }

  function chatFor(uid) {
    if (!currentUser) return null;

    return chatsCache.find((chat) =>
      Array.isArray(chat.participants) &&
      chat.participants.includes(currentUser.uid) &&
      chat.participants.includes(uid)
    ) || null;
  }

  function getUser(uid) {
    return usersCache.find((user) => user.uid === uid) || null;
  }

  async function initFirebase() {
    const config = window.FIREBASE_CONFIG;

    if (!config?.apiKey || !config?.projectId || !config?.databaseURL) {
      if (authError) {
        authError.textContent =
          "Konfigurasi Firebase belum lengkap. Periksa firebase-config.js.";
      }
      return;
    }

    try {
      if (!firebase.apps.length) firebase.initializeApp(config);

      auth = firebase.auth();
      db = firebase.firestore();
      rtdb = firebase.database();

      auth.onAuthStateChanged(async (user) => {
        authReady = true;

        if (!user) {
          await cleanupRealtime();
          currentUser = null;
          myProfile = null;

          appScreen?.classList.add("hidden");
          authScreen?.classList.remove("hidden");
          return;
        }

        currentUser = user;

        try {
          await ensureProfile(user);
          await enterApp();
        } catch (error) {
          toast(friendlyError(error));
        }
      });
    } catch (error) {
      if (authError) authError.textContent = friendlyError(error);
    }
  }

  async function ensureProfile(user) {
    const ref = db.collection("users").doc(user.uid);
    const snapshot = await ref.get();

    const fallbackName = (user.email || "Pengguna").split("@")[0];

    if (!snapshot.exists) {
      myProfile = {
        uid: user.uid,
        displayName: user.displayName || fallbackName,
        email: user.email || "",
        emailLower: (user.email || "").toLowerCase(),
        photoURL: user.photoURL || "",
        createdAt: serverTimestamp(),
        lastSeen: serverTimestamp()
      };

      await ref.set(myProfile);
      return;
    }

    myProfile = snapshot.data();

    if (!myProfile.displayName) {
      myProfile.displayName = user.displayName || fallbackName;
    }

    await ref.set({
      uid: user.uid,
      email: user.email || "",
      emailLower: (user.email || "").toLowerCase(),
      lastSeen: serverTimestamp()
    }, { merge: true });
  }

  authForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!auth) return;

    const submitButton = $("#auth-submit");
    if (submitButton) submitButton.disabled = true;
    if (authError) authError.textContent = "";

    try {
      const email = authEmail.value.trim().toLowerCase();
      const password = authPassword.value;

      if (!email || !password) {
        throw new Error("Email dan password wajib diisi.");
      }

      if (authMode === "register") {
        const name = authName.value.trim();

        if (!name) throw new Error("Nama tampilan wajib diisi.");
        if (name.length > 40) {
          throw new Error("Nama maksimal 40 karakter.");
        }

        const credential = await auth.createUserWithEmailAndPassword(
          email,
          password
        );

        await credential.user.updateProfile({ displayName: name });

        await db.collection("users").doc(credential.user.uid).set({
          uid: credential.user.uid,
          displayName: name,
          email,
          emailLower: email,
          photoURL: "",
          createdAt: serverTimestamp(),
          lastSeen: serverTimestamp()
        });
      } else {
        await auth.signInWithEmailAndPassword(email, password);
      }
    } catch (error) {
      if (authError) authError.textContent = friendlyError(error);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });

  async function enterApp() {
    authScreen?.classList.add("hidden");
    appScreen?.classList.remove("hidden");

    $("#my-name").textContent = myProfile.displayName || currentUser.email;
    renderAvatar($("#my-avatar"), myProfile.photoURL, initials(myProfile.displayName));
    renderAvatar($("#profile-photo-preview"), myProfile.photoURL, initials(myProfile.displayName));

    setupPresence();
    listenUsers();
    listenMyChats();
  }

  function setupPresence() {
    if (!currentUser) return;

    presenceRef = rtdb.ref(`/status/${currentUser.uid}`);
    connectedRef = rtdb.ref(".info/connected");

    connectedRef.on("value", async (snapshot) => {
      if (snapshot.val() !== true || !currentUser || !presenceRef) return;

      try {
        await presenceRef.onDisconnect().set({
          state: "offline",
          last_changed: firebase.database.ServerValue.TIMESTAMP
        });

        await presenceRef.set({
          state: "online",
          last_changed: firebase.database.ServerValue.TIMESTAMP
        });
      } catch (error) {
        console.warn("Presence:", error);
      }
    });
  }

  function listenUsers() {
    unsubscribe(usersUnsub);

    usersUnsub = db.collection("users").onSnapshot((snapshot) => {
      usersCache = snapshot.docs
        .map((doc) => doc.data())
        .filter((user) => user.uid && user.uid !== currentUser.uid);

      renderContacts();
    }, (error) => toast(friendlyError(error)));
  }

  function listenMyChats() {
    unsubscribe(chatsUnsub);

    chatsUnsub = db.collection("chats")
      .where("participants", "array-contains", currentUser.uid)
      .onSnapshot((snapshot) => {
        chatsCache = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data()
        }));

        renderContacts();
      }, (error) => toast(friendlyError(error)));
  }

  function renderAvatar(element, photoURL, fallback) {
    if (!element) return;
    if (photoURL) {
      element.innerHTML = `<img class="avatar-photo" src="${escapeHTML(photoURL)}" alt="">`;
    } else {
      element.textContent = fallback || "S";
    }
  }

  function renderContacts() {
    if (!contactList || !currentUser) return;

    const query = ($("#user-search")?.value || "").trim().toLowerCase();

    const users = usersCache.filter((user) =>
      !query ||
      (user.displayName || "").toLowerCase().includes(query) ||
      (user.emailLower || user.email || "").toLowerCase().includes(query)
    );

    users.sort((a, b) => {
      const chatA = chatFor(a.uid);
      const chatB = chatFor(b.uid);

      const timeA = chatA?.updatedAt?.toMillis?.() || 0;
      const timeB = chatB?.updatedAt?.toMillis?.() || 0;

      return timeB - timeA ||
        (a.displayName || "").localeCompare(b.displayName || "");
    });

    if (!users.length) {
      contactList.innerHTML = `<div class="empty-state">${
        query
          ? "Tidak ada pengguna yang cocok."
          : "Belum ada pengguna lain. Daftarkan akun kedua untuk mulai chat."
      }</div>`;
      return;
    }

    contactList.innerHTML = users.map((user) => {
      const chat = chatFor(user.uid);
      const lastMessage = chat?.lastMessage;

      let preview = "Mulai percakapan";

      if (lastMessage) {
        if (lastMessage.type === "image") preview = "Gambar";
        else if (lastMessage.type === "file") preview = "File terlampir";
        else preview = lastMessage.text || "Pesan";
      }

      const unread = Number(chat?.unreadBy?.[currentUser.uid] || 0);

      return `
        <button class="contact ${
          selectedUser?.uid === user.uid ? "active" : ""
        }" data-user-id="${escapeHTML(user.uid)}">
          <div class="avatar">${user.photoURL ? `<img class="avatar-photo" src="${escapeHTML(user.photoURL)}" alt="" loading="lazy">` : escapeHTML(initials(user.displayName))}</div>
          <div class="contact-copy">
            <div class="contact-top">
              <strong>${escapeHTML(user.displayName || user.email || "Pengguna")}</strong>
              <time>${escapeHTML(formatTime(chat?.updatedAt))}</time>
            </div>
            <div class="contact-bottom">
              <span>${escapeHTML(preview)}</span>
              ${unread ? `<b class="unread-badge">${unread > 99 ? "99+" : unread}</b>` : ""}
            </div>
          </div>
        </button>`;
    }).join("");

    contactList.querySelectorAll("[data-user-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const user = getUser(button.dataset.userId);
        if (user) openChat(user);
      });
    });
  }

  function detachChatListeners() {
    chatGeneration++;

    unsubscribe(messagesUnsub);
    messagesUnsub = null;

    if (typingRef) typingRef.off();
    typingRef = null;

    if (statusRef) statusRef.off();
    statusRef = null;

    if (selectedChatId && currentUser) {
      rtdb.ref(`/typing/${selectedChatId}/${currentUser.uid}`)
        .remove()
        .catch(() => {});
    }

    clearTimeout(typingTimer);
  }

  async function openChat(user) {
    if (!user || !currentUser || user.uid === currentUser.uid) return;

    detachChatListeners();

    const generation = chatGeneration;

    selectedUser = user;
    selectedChatId = chatIdFor(currentUser.uid, user.uid);

    appScreen?.classList.add("chat-open");
    welcomePanel?.classList.add("hidden");
    chatHeader?.classList.remove("hidden");
    messagesBox?.classList.remove("hidden");
    composer?.classList.remove("hidden");

    $("#chat-name").textContent = user.displayName || user.email;
    renderAvatar($("#chat-avatar"), user.photoURL || "", initials(user.displayName));
    $("#chat-status").textContent = "Menghubungkan...";
    typingLabel.textContent = `${user.displayName || "Kontak"} sedang mengetik...`;

    typingLine?.classList.add("hidden");
    messagesBox.innerHTML = `<div class="empty-state">Menghubungkan percakapan...</div>`;

    const chatRef = db.collection("chats").doc(selectedChatId);

    try {
      await chatRef.set({
        participants: [currentUser.uid, user.uid].sort(),
        participantInfo: {
          [currentUser.uid]: {
            displayName: myProfile.displayName || currentUser.email
          },
          [user.uid]: {
            displayName: user.displayName || user.email
          }
        },
        updatedAt: serverTimestamp()
      }, { merge: true });

      if (generation !== chatGeneration) return;

      await chatRef.set({
        unreadBy: { [currentUser.uid]: 0 }
      }, { merge: true });

      messagesUnsub = chatRef.collection("messages")
        .orderBy("createdAt", "asc")
        .limitToLast(300)
        .onSnapshot(async (snapshot) => {
          if (generation !== chatGeneration) return;

          const messages = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data()
          }));

          renderMessages(messages);

          const unread = snapshot.docs.filter((doc) => {
            const message = doc.data();

            return message.senderId !== currentUser.uid &&
              !(message.readBy || []).includes(currentUser.uid);
          });

          if (unread.length) {
            const batch = db.batch();

            unread.forEach((doc) => {
              batch.update(doc.ref, {
                readBy: firebase.firestore.FieldValue.arrayUnion(
                  currentUser.uid
                )
              });
            });

            try {
              await batch.commit();
            } catch (error) {
              console.warn("Read receipt:", error);
            }
          }
        }, (error) => toast(friendlyError(error)));

      typingRef = rtdb.ref(
        `/typing/${selectedChatId}/${user.uid}`
      );

      typingRef.on("value", (snapshot) => {
        if (generation !== chatGeneration) return;

        const isTyping = snapshot.val()?.typing === true;
        typingLine?.classList.toggle("hidden", !isTyping);

        if (isTyping) {
          $("#chat-status").textContent = "Sedang mengetik...";
        } else {
          updateChatPresenceLabel();
        }
      });

      statusRef = rtdb.ref(`/status/${user.uid}`);

      statusRef.on("value", (snapshot) => {
        if (generation !== chatGeneration) return;
        updateChatPresenceLabel(snapshot.val());
      });

      renderContacts();
      setTimeout(() => messageInput?.focus(), 100);
    } catch (error) {
      toast(friendlyError(error));
    }
  }

  function updateChatPresenceLabel(statusValue) {
    if (!selectedUser || !$("#chat-status")) return;

    if (!typingLine?.classList.contains("hidden")) {
      $("#chat-status").textContent = "Sedang mengetik...";
      return;
    }

    const isOnline = statusValue?.state === "online";

    $("#chat-status").innerHTML = isOnline
      ? '<i class="online-dot"></i> Online'
      : "Offline";
  }

  function renderMessages(messages) {
    if (!messagesBox || !selectedUser || !selectedChatId) return;

    if (!messages.length) {
      messagesBox.innerHTML = `<div class="empty-state">Belum ada pesan. Sapa ${
        escapeHTML(selectedUser.displayName || "kontakmu")
      }</div>`;
      return;
    }

    const wasNearBottom =
      messagesBox.scrollHeight -
      messagesBox.scrollTop -
      messagesBox.clientHeight < 180;

    const html = [];
    let previousDay = "";

    for (const message of messages) {
      const dayKey = message.createdAt?.toDate
        ? message.createdAt.toDate().toDateString()
        : "pending";

      if (dayKey !== previousDay) {
        html.push(
          `<div class="day-divider">${escapeHTML(formatDay(message.createdAt))}</div>`
        );
        previousDay = dayKey;
      }

      const mine = message.senderId === currentUser.uid;
      const attachment = message.attachmentDataUrl || "";
      let attachmentMarkup = "";

      if (message.type === "image" && attachment) {
        attachmentMarkup = `
          <a href="${escapeHTML(attachment)}" target="_blank" rel="noopener">
            <img class="message-image"
              src="${escapeHTML(attachment)}"
              alt="${escapeHTML(message.fileName || "Gambar")}"
              loading="lazy">
          </a>`;
      } else if (message.type === "file" && attachment) {
        attachmentMarkup = `
          <a class="attachment-card"
             href="${escapeHTML(attachment)}"
             target="_blank"
             rel="noopener"
             download="${escapeHTML(message.fileName || "file")}">
            <span class="attachment-icon">FILE</span>
            <span>
              <span class="attachment-name">${escapeHTML(message.fileName || "File")}</span>
              <span class="attachment-size">${escapeHTML(formatSize(message.fileSize || 0))} - Unduh</span>
            </span>
          </a>`;
      }

      const textMarkup = message.text
        ? `<div>${escapeHTML(message.text).replace(/\n/g, "<br>")}</div>`
        : "";

      let receipt = "";

      if (mine) {
        const read = (message.readBy || []).includes(selectedUser.uid);
        const delivered = (message.deliveredTo || []).includes(selectedUser.uid) || read;

        receipt = `<span class="read-state ${read ? "is-read" : ""}">${
          read ? "Dibaca" : delivered ? "Diterima" : "Terkirim"
        }</span>`;
      }

      html.push(`
        <article class="message-row ${mine ? "mine" : ""}">
          <div class="message-bubble">${attachmentMarkup}${textMarkup}</div>
          <div class="message-meta">
            <time>${escapeHTML(formatTime(message.createdAt))}</time>
            ${mine ? receipt : ""}
          </div>
        </article>`);
    }

    messagesBox.innerHTML = html.join("");

    if (wasNearBottom) messagesBox.scrollTop = messagesBox.scrollHeight;

    // Batch small groups to avoid exceeding Firestore batch limits.
    const undelivered = messages.filter((message) =>
      message.senderId !== currentUser.uid &&
      !(message.deliveredTo || []).includes(currentUser.uid) &&
      message.id
    );

    for (let index = 0; index < undelivered.length; index += 400) {
      const batch = db.batch();

      undelivered.slice(index, index + 400).forEach((message) => {
        const ref = db.collection("chats")
          .doc(selectedChatId)
          .collection("messages")
          .doc(message.id);

        batch.update(ref, {
          deliveredTo: firebase.firestore.FieldValue.arrayUnion(
            currentUser.uid
          )
        });
      });

      batch.commit().catch((error) => {
        console.warn("Delivery receipt:", error);
      });
    }
  }

  function setTyping(isTyping) {
    if (!currentUser || !selectedChatId) return;

    rtdb.ref(`/typing/${selectedChatId}/${currentUser.uid}`)
      .set({
        typing: Boolean(isTyping),
        at: firebase.database.ServerValue.TIMESTAMP
      })
      .catch((error) => console.warn("Typing:", error));
  }

  messageInput?.addEventListener("input", () => {
    messageInput.style.height = "auto";
    messageInput.style.height =
      `${Math.min(messageInput.scrollHeight, 130)}px`;

    setTyping(true);
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => setTyping(false), 1300);
  });

  messageInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      composer?.requestSubmit();
    }
  });

  composer?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const text = messageInput.value.trim();

    if (!text || !selectedChatId || !selectedUser || isSending) return;

    if (text.length > MAX_MESSAGE_LENGTH) {
      toast(`Pesan maksimal ${MAX_MESSAGE_LENGTH} karakter.`);
      return;
    }

    isSending = true;
    $("#send-btn").disabled = true;

    try {
      await sendMessage({ text, type: "text" });
      messageInput.value = "";
      messageInput.style.height = "auto";
      setTyping(false);
    } catch (error) {
      toast(friendlyError(error));
    } finally {
      isSending = false;
      $("#send-btn").disabled = false;
      messageInput.focus();
    }
  });

  async function sendMessage(data) {
    if (!currentUser || !selectedUser || !selectedChatId) {
      throw new Error("Pilih percakapan terlebih dahulu.");
    }

    const chatId = selectedChatId;
    const recipientId = selectedUser.uid;

    const messageRef = db.collection("chats")
      .doc(chatId)
      .collection("messages")
      .doc();

    const payload = {
      ...data,
      senderId: currentUser.uid,
      recipientId,
      createdAt: serverTimestamp(),
      deliveredTo: [],
      readBy: []
    };

    // Message creation and chat preview are committed atomically.
    const batch = db.batch();

    batch.set(messageRef, payload);

    const preview = data.type === "image"
      ? "Gambar"
      : data.type === "file"
        ? "File"
        : data.text;

    const chatRef = db.collection("chats").doc(chatId);

    batch.set(chatRef, {
      participants: [currentUser.uid, recipientId].sort(),
      lastMessage: {
        text: preview,
        type: data.type,
        senderId: currentUser.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      },
      updatedAt: serverTimestamp(),
      unreadBy: {
        [recipientId]: firebase.firestore.FieldValue.increment(1),
        [currentUser.uid]: 0
      }
    }, { merge: true });

    await batch.commit();
  }

  $("#attach-btn")?.addEventListener("click", () => {
    $("#file-input")?.click();
  });

  $("#file-input")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || !selectedChatId || !selectedUser) return;

    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast("Mode gratis: ukuran file maksimal 300 KB.");
      return;
    }

    const isImage = file.type.startsWith("image/");
    const isText = file.type.startsWith("text/");
    const isPDF = file.type === "application/pdf";

    if (!isImage && !isText && !isPDF) {
      toast("Format yang didukung: gambar, file teks, dan PDF.");
      return;
    }

    const safeName = file.name
      .replace(/[^\w.\- ()]/g, "_")
      .slice(0, 100);

    try {
      uploadProgress?.classList.remove("hidden");

      const dataURL = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Gagal membaca file."));
        reader.readAsDataURL(file);
      });

      await sendMessage({
        text: "",
        type: isImage ? "image" : "file",
        attachmentDataUrl: dataURL,
        fileName: safeName,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream"
      });

      toast("Lampiran terkirim. Lampiran memakai kuota Firestore.");
    } catch (error) {
      toast(friendlyError(error));
    } finally {
      uploadProgress?.classList.add("hidden");
    }
  });

  $("#user-search")?.addEventListener("input", renderContacts);

  $("#back-btn")?.addEventListener("click", () => {
    detachChatListeners();
    selectedUser = null;
    selectedChatId = null;
    appScreen?.classList.remove("chat-open");
    welcomePanel?.classList.remove("hidden");
    chatHeader?.classList.add("hidden");
    messagesBox?.classList.add("hidden");
    composer?.classList.add("hidden");
  });

  $("#logout-btn")?.addEventListener("click", async () => {
    try {
      setTyping(false);
      await auth.signOut();
    } catch (error) {
      toast(friendlyError(error));
    }
  });

  $("#edit-profile-btn")?.addEventListener("click", () => {
    $("#profile-name-input").value = myProfile?.displayName || "";
    renderAvatar($("#profile-photo-preview"), myProfile?.photoURL || "", initials(myProfile?.displayName || "S"));
    $("#modal-backdrop")?.classList.remove("hidden");
  });

  $("#modal-close")?.addEventListener("click", () => {
    $("#modal-backdrop")?.classList.add("hidden");
  });

  $("#modal-backdrop")?.addEventListener("click", (event) => {
    if (event.target.id === "modal-backdrop") {
      event.currentTarget.classList.add("hidden");
    }
  });

  let pendingProfilePhoto = undefined;

  $("#profile-photo-input")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      toast("Gunakan gambar JPG, PNG, atau WebP.");
      event.target.value = "";
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast("Ukuran foto maksimal 2 MB.");
      event.target.value = "";
      return;
    }
    try {
      pendingProfilePhoto = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Foto tidak dapat dibaca."));
        reader.onload = () => {
          const image = new Image();
          image.onerror = () => reject(new Error("Format foto tidak valid."));
          image.onload = () => {
            const canvas = document.createElement("canvas");
            const max = 320;
            const scale = Math.min(1, max / Math.max(image.width, image.height));
            canvas.width = Math.max(1, Math.round(image.width * scale));
            canvas.height = Math.max(1, Math.round(image.height * scale));
            canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/jpeg", 0.72));
          };
          image.src = reader.result;
        };
        reader.readAsDataURL(file);
      });
      renderAvatar($("#profile-photo-preview"), pendingProfilePhoto, initials(myProfile?.displayName || "S"));
    } catch (error) {
      toast(error.message || "Gagal memproses foto.");
    }
  });

  $("#remove-profile-photo-btn")?.addEventListener("click", () => {
    pendingProfilePhoto = "";
    renderAvatar($("#profile-photo-preview"), "", initials(myProfile?.displayName || "S"));
    const input = $("#profile-photo-input");
    if (input) input.value = "";
  });

  $("#save-profile-btn")?.addEventListener("click", async () => {
    const name = $("#profile-name-input").value.trim();

    if (!name) {
      toast("Nama tidak boleh kosong.");
      return;
    }

    if (name.length > 40) {
      toast("Nama maksimal 40 karakter.");
      return;
    }

    try {
      const profileUpdate = { displayName: name };
      if (pendingProfilePhoto !== undefined) profileUpdate.photoURL = pendingProfilePhoto;
      await db.collection("users").doc(currentUser.uid).set(profileUpdate, { merge: true });

      await currentUser.updateProfile({ displayName: name });

      myProfile.displayName = name;
      if (pendingProfilePhoto !== undefined) myProfile.photoURL = pendingProfilePhoto;
      pendingProfilePhoto = undefined;
      $("#my-name").textContent = name;
      renderAvatar($("#my-avatar"), myProfile.photoURL, initials(name));
      renderAvatar($("#profile-photo-preview"), myProfile.photoURL, initials(name));
      renderContacts();

      $("#modal-backdrop").classList.add("hidden");
      toast("Profil diperbarui.");
    } catch (error) {
      toast(friendlyError(error));
    }
  });

  async function cleanupRealtime() {
    unsubscribe(usersUnsub);
    unsubscribe(chatsUnsub);
    unsubscribe(messagesUnsub);

    usersUnsub = null;
    chatsUnsub = null;
    messagesUnsub = null;

    if (typingRef) typingRef.off();
    if (statusRef) statusRef.off();
    if (connectedRef) connectedRef.off();

    typingRef = null;
    statusRef = null;
    connectedRef = null;

    if (selectedChatId && currentUser) {
      await rtdb.ref(`/typing/${selectedChatId}/${currentUser.uid}`)
        .remove()
        .catch(() => {});
    }

    if (presenceRef) {
      await presenceRef.set({
        state: "offline",
        last_changed: firebase.database.ServerValue.TIMESTAMP
      }).catch(() => {});
    }

    clearTimeout(typingTimer);

    selectedUser = null;
    selectedChatId = null;
    usersCache = [];
    chatsCache = [];
    presenceRef = null;
  }

  document.addEventListener("keydown", (event) => {
    if (
      event.key === "/" &&
      !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName) &&
      !appScreen?.classList.contains("hidden")
    ) {
      event.preventDefault();
      $("#user-search")?.focus();
    }

    if (event.key === "Escape") {
      $("#modal-backdrop")?.classList.add("hidden");
    }
  });

  // Mulai aplikasi setelah Firebase SDK dan konfigurasi dimuat.
  initFirebase();
})();
