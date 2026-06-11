// popup.js — dialog logic, Calendar API, Meet link generation

let messageData = null;
let accessToken = null;
let attendeesList = [];
let createdEventId = null;
let invitesSent = false;

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  setDefaultDateTime();
  initTimezonePicker();
  addNotificationRow("email", 10, "minutes");
  addNotificationRow("popup", 10, "minutes");
  setupEventListeners();
  await loadMessageData();
  await checkAuth();
});

// ── Date / Time ───────────────────────────────────────────────────────────────

function setDefaultDateTime() {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 1);
  document.getElementById("date").value = now.toISOString().slice(0, 10);
  document.getElementById("time").value = now.toTimeString().slice(0, 5);
}

// ── Timezone Picker ───────────────────────────────────────────────────────────

let tzEntries = [];          // all formatted {tz, display, offsetMin}
let filteredTzEntries = [];  // currently shown in list
let selectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
let tzActiveIndex = -1;

function getOffsetMinutes(tz, date) {
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    }).formatToParts(date);
    const str = parts.find((p) => p.type === "timeZoneName")?.value || "GMT";
    const m = str.match(/GMT([+-])(\d+)(?::(\d+))?/);
    if (!m) return 0;
    return (m[1] === "+" ? 1 : -1) * (parseInt(m[2], 10) * 60 + parseInt(m[3] || "0", 10));
  } catch (e) { return 0; }
}

function formatOffsetStr(min) {
  const sign = min >= 0 ? "+" : "-";
  const abs = Math.abs(min);
  return `GMT${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

function getLongTzName(tz, date) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "long",
    }).formatToParts(date);
    let name = parts.find((p) => p.type === "timeZoneName")?.value || tz;
    return name
      .replace(/\bStandard\b\s*/g, "")
      .replace(/\bDaylight\b\s*/g, "")
      .replace(/\bSummer\b\s*/g, "")
      .replace(/\bWinter\b\s*/g, "")
      .trim();
  } catch (e) {
    return tz.split("/").pop().replace(/_/g, " ");
  }
}

function initTimezonePicker() {
  const now = new Date();
  const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  let zones;
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch (e) {
    zones = [
      "Pacific/Midway","Pacific/Honolulu","America/Anchorage","America/Los_Angeles",
      "America/Denver","America/Chicago","America/New_York","America/Toronto",
      "America/Halifax","America/Sao_Paulo","Atlantic/Azores","Europe/London",
      "Europe/Paris","Europe/Berlin","Europe/Helsinki","Europe/Moscow",
      "Asia/Dubai","Asia/Karachi","Asia/Kolkata","Asia/Dhaka","Asia/Bangkok",
      "Asia/Shanghai","Asia/Tokyo","Australia/Sydney","Pacific/Auckland", userTz,
    ].filter((v, i, a) => a.indexOf(v) === i);
  }

  tzEntries = zones.map((tz) => {
    const offsetMin = getOffsetMinutes(tz, now);
    const city = tz.split("/").pop().replace(/_/g, " ");
    const longName = getLongTzName(tz, now);
    return {
      tz,
      display: `(${formatOffsetStr(offsetMin)}) ${longName} - ${city}`,
      offsetMin,
      city,
    };
  });

  tzEntries.sort((a, b) =>
    a.offsetMin !== b.offsetMin ? a.offsetMin - b.offsetMin : a.city.localeCompare(b.city)
  );

  // Set display to current timezone
  selectTz(userTz, false);
  setupTzPicker();
}

function setupTzPicker() {
  const displayBtn = document.getElementById("tz-display");
  const modal = document.getElementById("tz-modal");
  const searchInput = document.getElementById("tz-search");

  // Toggle modal on button click
  displayBtn.addEventListener("click", () => {
    modal.style.display === "none" ? openTzModal() : closeTzModal();
  });

  // Close when clicking outside the container
  document.addEventListener("mousedown", (e) => {
    if (!e.target.closest("#tz-container")) closeTzModal();
  });

  // Filter as you type
  searchInput.addEventListener("input", () => {
    tzActiveIndex = -1;
    renderTzList(searchInput.value.toLowerCase().trim());
  });

  // Keyboard navigation inside search
  searchInput.addEventListener("keydown", (e) => {
    const items = document.querySelectorAll(".tz-option");

    if (e.key === "ArrowDown") {
      e.preventDefault();
      tzActiveIndex = Math.min(tzActiveIndex + 1, filteredTzEntries.length - 1);
      highlightTzOption(tzActiveIndex);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      tzActiveIndex = Math.max(tzActiveIndex - 1, 0);
      highlightTzOption(tzActiveIndex);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const idx = tzActiveIndex >= 0 ? tzActiveIndex : 0;
      if (filteredTzEntries[idx]) selectTz(filteredTzEntries[idx].tz, true);
    } else if (e.key === "Escape") {
      closeTzModal();
    }
  });
}

function openTzModal() {
  const modal = document.getElementById("tz-modal");
  const displayBtn = document.getElementById("tz-display");
  const searchInput = document.getElementById("tz-search");

  modal.style.display = "block";
  displayBtn.classList.add("open");
  searchInput.value = "";
  tzActiveIndex = -1;
  renderTzList("");

  // Focus search and scroll selected item into view
  requestAnimationFrame(() => {
    searchInput.focus();
    const selected = document.querySelector(".tz-option.selected");
    if (selected) selected.scrollIntoView({ block: "center" });
  });
}

function closeTzModal() {
  document.getElementById("tz-modal").style.display = "none";
  document.getElementById("tz-display").classList.remove("open");
  tzActiveIndex = -1;
}

function renderTzList(query) {
  const list = document.getElementById("tz-list");
  list.innerHTML = "";

  filteredTzEntries = query
    ? tzEntries.filter((e) => e.display.toLowerCase().includes(query))
    : tzEntries;

  filteredTzEntries.forEach((entry, idx) => {
    const opt = document.createElement("div");
    opt.className = "tz-option" + (entry.tz === selectedTz ? " selected" : "");
    opt.textContent = entry.display;
    opt.dataset.idx = idx;

    opt.addEventListener("mousedown", (e) => {
      e.preventDefault(); // prevent modal close before selection
      selectTz(entry.tz, true);
    });

    list.appendChild(opt);
  });
}

function highlightTzOption(idx) {
  document.querySelectorAll(".tz-option").forEach((el, i) => {
    el.classList.toggle("active", i === idx);
    if (i === idx) el.scrollIntoView({ block: "nearest" });
  });
}

function selectTz(tz, closeModal = true) {
  selectedTz = tz;
  const entry = tzEntries.find((e) => e.tz === tz);
  document.getElementById("tz-current-text").textContent = entry?.display || tz;
  if (closeModal) closeTzModal();
}

// ── Message Data ──────────────────────────────────────────────────────────────

async function loadMessageData() {
  try {
    const response = await messenger.runtime.sendMessage({ type: "GET_MESSAGE_DATA" });
    messageData = response?.data;
    if (messageData) {
      document.getElementById("title").value = messageData.subject || "";
      if (messageData.body) document.getElementById("description").value = messageData.body;
      attendeesList = [...(messageData.attendees || [])];
      renderAttendees();
    }
  } catch (e) {
    console.error("Failed to load message data:", e);
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function checkAuth() {
  showStatus("Connecting to Google…", "loading");
  try {
    const response = await messenger.runtime.sendMessage({ type: "GET_TOKEN" });
    if (response?.token) {
      accessToken = response.token;
      showStatus("", "");
      document.getElementById("btn-submit").disabled = false;
      document.getElementById("btn-generate-link").disabled = false;
    } else {
      throw new Error(response?.error || "Authorization failed");
    }
  } catch (e) {
    showStatus(`Authorization failed: ${e.message}`, "error");
  }
}

// ── Attendees (editable chips) ────────────────────────────────────────────────

function renderAttendees() {
  const wrap = document.getElementById("attendees-wrap");
  const input = document.getElementById("attendee-input");
  wrap.querySelectorAll(".chip").forEach((c) => c.remove());

  attendeesList.forEach((email, idx) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.title = email;

    const label = document.createElement("span");
    label.textContent = email;

    const removeBtn = document.createElement("button");
    removeBtn.className = "chip-remove";
    removeBtn.textContent = "×";
    removeBtn.title = "Remove";
    removeBtn.addEventListener("click", () => {
      attendeesList.splice(idx, 1);
      renderAttendees();
    });

    chip.appendChild(label);
    chip.appendChild(removeBtn);
    wrap.insertBefore(chip, input);
  });
}

function addAttendeeEmail(email) {
  email = email.trim().toLowerCase();
  if (email && isValidEmail(email) && !attendeesList.includes(email)) {
    attendeesList.push(email);
    renderAttendees();
    return true;
  }
  return false;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── Contacts Autocomplete ─────────────────────────────────────────────────────

let acActiveIndex = -1;
let acResults = [];
let acSearchTimer = null;

async function searchContacts(query) {
  try {
    const contacts = await messenger.contacts.quickSearch(null, query);
    return contacts
      .map((c) => ({
        name: c.properties?.DisplayName || "",
        email: c.properties?.PrimaryEmail || c.properties?.SecondEmail || "",
      }))
      .filter((c) => c.email && isValidEmail(c.email))
      .slice(0, 8);
  } catch (e) {
    console.warn("Contact search unavailable:", e);
    return [];
  }
}

function showAutocomplete(results) {
  const dropdown = document.getElementById("ac-dropdown");
  acResults = results;
  acActiveIndex = -1;

  if (!results.length) {
    dropdown.classList.remove("open");
    dropdown.innerHTML = "";
    return;
  }

  dropdown.innerHTML = "";
  results.forEach((contact, idx) => {
    const item = document.createElement("div");
    item.className = "ac-item";

    const name = document.createElement("div");
    name.className = "ac-name";
    name.textContent = contact.name || contact.email;
    item.appendChild(name);

    if (contact.name) {
      const emailEl = document.createElement("div");
      emailEl.className = "ac-email";
      emailEl.textContent = contact.email;
      item.appendChild(emailEl);
    }

    item.addEventListener("mousedown", (e) => {
      e.preventDefault();
      selectAutocompleteItem(idx);
    });

    dropdown.appendChild(item);
  });

  dropdown.classList.add("open");
}

function hideAutocomplete() {
  document.getElementById("ac-dropdown").classList.remove("open");
  acActiveIndex = -1;
}

function selectAutocompleteItem(idx) {
  const contact = acResults[idx];
  if (!contact) return;
  addAttendeeEmail(contact.email);
  document.getElementById("attendee-input").value = "";
  hideAutocomplete();
}

function highlightAcItem(idx) {
  document.querySelectorAll(".ac-item").forEach((el, i) => {
    el.classList.toggle("active", i === idx);
    if (i === idx) el.scrollIntoView({ block: "nearest" });
  });
}

// ── Attendee Input Setup ──────────────────────────────────────────────────────

function setupAttendeeInput() {
  const input = document.getElementById("attendee-input");
  const wrap = document.getElementById("attendees-wrap");

  wrap.addEventListener("click", (e) => {
    if (!e.target.closest(".chip")) input.focus();
  });

  input.addEventListener("input", () => {
    const q = input.value.trim();
    clearTimeout(acSearchTimer);
    if (q.length < 2) { hideAutocomplete(); return; }
    acSearchTimer = setTimeout(async () => {
      showAutocomplete(await searchContacts(q));
    }, 200);
  });

  input.addEventListener("keydown", (e) => {
    const isOpen = document.getElementById("ac-dropdown").classList.contains("open");

    // ── Navigate / select autocomplete dropdown ──
    if (isOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        acActiveIndex = Math.min(acActiveIndex + 1, acResults.length - 1);
        highlightAcItem(acActiveIndex);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        acActiveIndex = Math.max(acActiveIndex - 1, -1);
        highlightAcItem(acActiveIndex);
        return;
      }
      // Tab or Enter selects highlighted item (or first if none highlighted)
      if (e.key === "Enter" || e.key === "Tab") {
        const idx = acActiveIndex >= 0 ? acActiveIndex : 0;
        if (acResults[idx]) {
          e.preventDefault();
          selectAutocompleteItem(idx);
          return;
        }
      }
      if (e.key === "Escape") {
        hideAutocomplete();
        return;
      }
    }

    // ── Add typed email on Enter / comma / Tab ──
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const email = input.value.trim().replace(/[,;]+$/, "");
      if (email) {
        if (!addAttendeeEmail(email)) {
          input.style.color = "#c5221f";
          setTimeout(() => (input.style.color = ""), 1000);
        } else {
          input.value = "";
        }
        hideAutocomplete();
      }
    }

    if (e.key === "Tab") {
      const email = input.value.trim();
      if (email && isValidEmail(email)) {
        e.preventDefault();
        addAttendeeEmail(email);
        input.value = "";
        hideAutocomplete();
      }
      // otherwise let Tab move focus naturally
    }

    if (e.key === "Backspace" && input.value === "" && attendeesList.length > 0) {
      attendeesList.pop();
      renderAttendees();
    }
  });

  input.addEventListener("blur", () => {
    setTimeout(() => {
      hideAutocomplete();
      const email = input.value.trim().replace(/[,;]+$/, "");
      if (email && isValidEmail(email)) {
        addAttendeeEmail(email);
        input.value = "";
      }
    }, 150);
  });

  input.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData("text");
    text.split(/[\s,;]+/).forEach((email) => addAttendeeEmail(email.trim()));
    input.value = "";
    hideAutocomplete();
  });
}

// ── Notifications ─────────────────────────────────────────────────────────────

function addNotificationRow(method = "popup", value = 10, unit = "minutes") {
  const list = document.getElementById("notifications-list");
  const row = document.createElement("div");
  row.className = "notification-row";

  const methodSel = document.createElement("select");
  methodSel.className = "notif-method";
  [["email", "Email"], ["popup", "Notification"]].forEach(([val, label]) => {
    const opt = document.createElement("option");
    opt.value = val; opt.textContent = label;
    if (val === method) opt.selected = true;
    methodSel.appendChild(opt);
  });

  const valueInput = document.createElement("input");
  valueInput.type = "number";
  valueInput.className = "notif-value";
  valueInput.value = value; valueInput.min = 1; valueInput.max = 40320;

  const unitSel = document.createElement("select");
  unitSel.className = "notif-unit";
  [["minutes","minutes"],["hours","hours"],["days","days"],["weeks","weeks"]].forEach(([val, label]) => {
    const opt = document.createElement("option");
    opt.value = val; opt.textContent = label;
    if (val === unit) opt.selected = true;
    unitSel.appendChild(opt);
  });

  const removeBtn = document.createElement("button");
  removeBtn.className = "btn-remove-notif";
  removeBtn.textContent = "×"; removeBtn.title = "Remove";
  removeBtn.addEventListener("click", () => row.remove());

  row.append(methodSel, valueInput, unitSel, removeBtn);
  list.appendChild(row);
}

function getNotificationsPayload() {
  const multipliers = { minutes: 1, hours: 60, days: 1440, weeks: 10080 };
  return Array.from(document.querySelectorAll(".notification-row")).map((row) => ({
    method: row.querySelector(".notif-method").value,
    minutes:
      (parseInt(row.querySelector(".notif-value").value, 10) || 10) *
      (multipliers[row.querySelector(".notif-unit").value] || 1),
  }));
}

// ── Event Listeners ───────────────────────────────────────────────────────────

function setupEventListeners() {
  setupAttendeeInput();

  document.getElementById("btn-add-notification").addEventListener("click", () => {
    addNotificationRow("popup", 10, "minutes");
  });

  document.getElementById("btn-cancel").addEventListener("click", async () => {
    await deleteDraftIfExists();
    messenger.runtime.sendMessage({ type: "POPUP_CLOSED" });
    window.close();
  });

  // Clean up draft if user closes the window with the X button
  window.addEventListener("unload", () => {
    if (createdEventId && !invitesSent && accessToken) {
      fetch(`${CONFIG.CALENDAR_API_BASE}/calendars/primary/events/${createdEventId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
        keepalive: true,
      });
    }
  });

  document.getElementById("btn-generate-link").addEventListener("click", handleGenerateLink);
  document.getElementById("btn-submit").addEventListener("click", handleSendInvites);

  document.getElementById("btn-copy-link").addEventListener("click", () => {
    const url = document.getElementById("meet-link-url").textContent;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(flashCopied).catch(() => execCopy(url));
    } else {
      execCopy(url);
    }
  });
}

function flashCopied() {
  const btn = document.getElementById("btn-copy-link");
  btn.textContent = "Copied ✓";
  setTimeout(() => (btn.textContent = "Copy"), 2000);
}

function execCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
  flashCopied();
}

// ── Build Event Payload ───────────────────────────────────────────────────────

function buildEventPayload({ withConference = false } = {}) {
  const title = document.getElementById("title").value.trim();
  const date = document.getElementById("date").value;
  const time = document.getElementById("time").value;
  const durationMins = parseInt(document.getElementById("duration").value, 10);
  const description = document.getElementById("description").value.trim();

  const startDateTime = new Date(`${date}T${time}:00`);
  const endDateTime = new Date(startDateTime.getTime() + durationMins * 60000);

  const payload = {
    summary: title || "(No title)",
    description: description || undefined,
    start: { dateTime: startDateTime.toISOString(), timeZone: selectedTz },
    end: { dateTime: endDateTime.toISOString(), timeZone: selectedTz },
    attendees: attendeesList.map((email) => ({ email })),
    reminders: { useDefault: false, overrides: getNotificationsPayload() },
  };

  if (withConference) {
    payload.conferenceData = {
      createRequest: {
        requestId: `thunderbird-${Date.now()}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  return payload;
}

// ── Draft Cleanup ─────────────────────────────────────────────────────────────

async function deleteDraftIfExists() {
  if (!createdEventId || invitesSent) return;
  try {
    await callCalendarAPI("DELETE", `/calendars/primary/events/${createdEventId}`);
    createdEventId = null;
  } catch (e) {
    console.warn("Could not delete draft event:", e);
  }
}

// ── Generate Meeting Link ─────────────────────────────────────────────────────

async function handleGenerateLink() {
  const btn = document.getElementById("btn-generate-link");
  btn.disabled = true;
  showStatus("Generating meeting link…", "loading");

  if (createdEventId) {
    try {
      await callCalendarAPI("DELETE", `/calendars/primary/events/${createdEventId}`);
    } catch (e) { console.warn("Could not delete previous draft:", e); }
    createdEventId = null;
  }

  try {
    const result = await callCalendarAPI(
      "POST",
      "/calendars/primary/events?conferenceDataVersion=1&sendUpdates=none",
      buildEventPayload({ withConference: true })
    );

    createdEventId = result.id;
    const meetLink = extractMeetLink(result);

    if (meetLink) {
      document.getElementById("meet-link-url").textContent = meetLink;
      document.getElementById("meet-link-url").href = meetLink;
      document.getElementById("meet-link-display").style.display = "flex";
      showStatus("", "");
      btn.textContent = "🔄 Regenerate Link";
    } else {
      showStatus("Event created but no Meet link returned — try Regenerate.", "error");
    }
  } catch (e) {
    showStatus(`Failed to generate link: ${e.message}`, "error");
  } finally {
    btn.disabled = false;
  }
}

// ── Send Invites ──────────────────────────────────────────────────────────────

async function handleSendInvites() {
  const title = document.getElementById("title").value.trim();
  if (!title) {
    showStatus("Please add a meeting title.", "error");
    document.getElementById("title").focus();
    return;
  }
  if (!document.getElementById("date").value || !document.getElementById("time").value) {
    showStatus("Please set a date and time.", "error");
    return;
  }

  const btn = document.getElementById("btn-submit");
  btn.disabled = true;
  showStatus("Sending invites…", "loading");

  try {
    let result;

    if (createdEventId) {
      result = await callCalendarAPI(
        "PATCH",
        `/calendars/primary/events/${createdEventId}?sendUpdates=all`,
        buildEventPayload({ withConference: false })
      );
    } else {
      result = await callCalendarAPI(
        "POST",
        "/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all",
        buildEventPayload({ withConference: true })
      );
      createdEventId = result.id;
    }

    const meetLink = extractMeetLink(result);
    const n = attendeesList.length;
    let msg = n > 0 ? `✅ Meeting created! Invites sent to ${n} guest(s).` : "✅ Meeting created.";
    if (meetLink) msg += `\n\n🔗 ${meetLink}`;

    invitesSent = true;
    showStatus(msg, "success");
    btn.textContent = "Done ✓";
    setTimeout(() => {
      messenger.runtime.sendMessage({ type: "POPUP_CLOSED" });
      window.close();
    }, 4000);
  } catch (e) {
    showStatus(`Failed: ${e.message}`, "error");
    btn.disabled = false;
  }
}

// ── Calendar API ──────────────────────────────────────────────────────────────

async function callCalendarAPI(method, path, body = null) {
  const opts = {
    method,
    headers: { Authorization: `Bearer ${accessToken}` },
  };
  if (body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  const response = await fetch(CONFIG.CALENDAR_API_BASE + path, opts);

  if (response.status === 204) return {};
  if (response.status === 401) {
    await messenger.storage.local.remove(["access_token", "token_expiry"]);
    accessToken = null;
    throw new Error("Session expired — close and reopen to re-authorize.");
  }
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${response.status}`);
  }
  return response.json();
}

function extractMeetLink(event) {
  const vid = (event.conferenceData?.entryPoints || []).find(
    (ep) => ep.entryPointType === "video"
  );
  return vid?.uri || event.hangoutLink || null;
}

// ── UI Helpers ────────────────────────────────────────────────────────────────

function showStatus(message, type) {
  const el = document.getElementById("status");
  el.textContent = message;
  el.className = type || "";
  el.style.display = message ? "block" : "none";
}
