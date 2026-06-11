// background.js - Main extension logic
// Handles context menu, message data extraction, OAuth, and popup communication

// ── Context Menu Setup ──────────────────────────────────────────────────────

messenger.menus.create({
  id: "schedule-gmeet",
  title: "Schedule Google Meet",
  contexts: ["message_list"],
});

messenger.menus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "schedule-gmeet") return;

  const messageId = info.selectedMessages?.messages?.[0]?.id;
  if (!messageId) {
    console.error("No message selected");
    return;
  }

  try {
    const messageData = await extractMessageData(messageId);
    await openPopup(messageData);
  } catch (err) {
    console.error("Error handling context menu click:", err);
  }
});

// ── Message Data Extraction ─────────────────────────────────────────────────

async function extractMessageData(messageId) {
  const message = await messenger.messages.get(messageId);
  const full = await messenger.messages.getFull(messageId);

  const userEmail = await getAuthenticatedUserEmail();

  const addresses = [];
  const fromHeader = message.author || "";
  const toHeader = (message.recipients || []).join(", ");
  const ccHeader = (message.ccList || []).join(", ");

  [fromHeader, toHeader, ccHeader].forEach((header) => {
    extractEmails(header).forEach((email) => addresses.push(email));
  });

  const attendees = [...new Set(addresses)].filter(
    (email) => email.toLowerCase() !== (userEmail || "").toLowerCase()
  );

  let body = "";
  try {
    body = extractTextBody(full).slice(0, 500);
  } catch (e) {
    body = "";
  }

  return { subject: message.subject || "", attendees, body, messageId };
}

function extractEmails(headerStr) {
  if (!headerStr) return [];
  const regex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  return headerStr.match(regex) || [];
}

function extractTextBody(fullMessage) {
  function findText(part) {
    if (!part) return "";
    if (part.contentType === "text/plain" && part.body) return part.body;
    if (part.parts) {
      for (const sub of part.parts) {
        const found = findText(sub);
        if (found) return found;
      }
    }
    return "";
  }
  return findText(fullMessage);
}

async function getAuthenticatedUserEmail() {
  try {
    const accounts = await messenger.accounts.list();
    if (accounts.length > 0) {
      return accounts[0].identities?.[0]?.email || "";
    }
  } catch (e) {
    console.warn("Could not get user email:", e);
  }
  return "";
}

// ── Popup Management ────────────────────────────────────────────────────────

let pendingMessageData = null;

async function openPopup(messageData) {
  pendingMessageData = messageData;
  await messenger.windows.create({
    url: "popup.html",
    type: "popup",
    width: 520,
    height: 880,
  });
}

// ── Message Listener ────────────────────────────────────────────────────────

messenger.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_MESSAGE_DATA") {
    sendResponse({ data: pendingMessageData });
    return false;
  }

  if (msg.type === "GET_TOKEN") {
    getAccessToken().then((token) => {
      if (token) {
        sendResponse({ token });
      } else {
        // No stored token — launch full OAuth flow
        launchOAuthFlow()
          .then((newToken) => sendResponse({ token: newToken }))
          .catch((err) => sendResponse({ error: err.message }));
      }
    }).catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.type === "POPUP_CLOSED") {
    pendingMessageData = null;
    return false;
  }
});

// ── PKCE Helpers ────────────────────────────────────────────────────────────

function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64urlEncode(array);
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64urlEncode(new Uint8Array(digest));
}

function base64urlEncode(buffer) {
  return btoa(String.fromCharCode(...buffer))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

// ── OAuth Flow ──────────────────────────────────────────────────────────────

async function getAccessToken() {
  const stored = await messenger.storage.local.get([
    "access_token",
    "token_expiry",
    "refresh_token",
  ]);

  if (stored.access_token && stored.token_expiry > Date.now()) {
    return stored.access_token;
  }

  if (stored.refresh_token) {
    try {
      return await refreshAccessToken(stored.refresh_token);
    } catch (e) {
      console.warn("Token refresh failed, re-authenticating:", e);
    }
  }

  return null; // no valid token; popup will trigger auth flow
}

// Launch OAuth in a tab and automatically capture the code from the localhost redirect
async function launchOAuthFlow() {
  const { CLIENT_ID, SCOPES, AUTH_URL, REDIRECT_URI } = CONFIG;

  // PKCE: generate verifier + challenge for this flow
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const authUrl =
    AUTH_URL +
    "?" +
    new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: SCOPES,
      access_type: "offline",
      prompt: "consent",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

  return new Promise((resolve, reject) => {
    let authTabId = null;

    // Watch for the tab navigating to http://localhost?code=...
    function onTabUpdated(tabId, changeInfo, tab) {
      if (tabId !== authTabId) return;
      const url = changeInfo.url || tab.url || "";
      if (!url.startsWith("http://localhost")) return;

      // Got the redirect — clean up listener and close tab
      messenger.tabs.onUpdated.removeListener(onTabUpdated);
      messenger.tabs.remove(authTabId).catch(() => {});

      const params = new URL(url).searchParams;
      const code = params.get("code");
      const error = params.get("error");

      if (error) {
        reject(new Error(`OAuth error: ${error}`));
      } else if (code) {
        exchangeCodeForToken(code, codeVerifier).then(resolve).catch(reject);
      } else {
        reject(new Error("No code in redirect URL"));
      }
    }

    messenger.tabs.onUpdated.addListener(onTabUpdated);

    // Open the auth URL in a new tab
    messenger.tabs.create({ url: authUrl }).then((tab) => {
      authTabId = tab.id;
    });
  });
}

async function exchangeCodeForToken(authCode, codeVerifier) {
  const { CLIENT_ID, CLIENT_SECRET, TOKEN_URL, REDIRECT_URI } = CONFIG;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: authCode,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code_verifier: codeVerifier,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(
      `Token exchange failed: ${err.error_description || err.error}`
    );
  }

  const data = await response.json();
  await storeTokens(data);
  return data.access_token;
}

async function refreshAccessToken(refreshToken) {
  const { CLIENT_ID, CLIENT_SECRET, TOKEN_URL } = CONFIG;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    throw new Error("Refresh token invalid");
  }

  const data = await response.json();
  await storeTokens(data);
  return data.access_token;
}

async function storeTokens(tokenData) {
  const existing = await messenger.storage.local.get("refresh_token");
  await messenger.storage.local.set({
    access_token: tokenData.access_token,
    token_expiry: Date.now() + tokenData.expires_in * 1000 - 60000,
    refresh_token: tokenData.refresh_token || existing.refresh_token,
  });
}
