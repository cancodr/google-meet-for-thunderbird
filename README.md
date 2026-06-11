# GMeet Scheduler for Thunderbird

Schedule Google Meet meetings directly from Mozilla Thunderbird — right-click any email and go.

**[🌐 Website](https://cancodr.github.io/google-meet-for-thunderbird)** &nbsp;·&nbsp; **[📋 Privacy Policy](https://cancodr.github.io/google-meet-for-thunderbird/privacy.html)**

---

## Features

- **One right-click** — context menu on any message opens the scheduling dialog
- **Auto-populated attendees** — From, To, and CC pulled from the email automatically
- **Generate Meet link first** — get a Google Meet URL before sending calendar invites
- **Contacts autocomplete** — search your Thunderbird address book when adding guests
- **Full timezone support** — searchable picker with GMT offsets, defaults to your local timezone
- **Notification settings** — email and popup reminders, configurable per event
- **Free & open source** — no subscription, no tracking, no ads

## Installation

Install from the [Thunderbird Add-ons store](https://addons.thunderbird.net) *(link coming soon)*, or load it manually:

1. Download or clone this repository
2. In Thunderbird: **Tools → Developer Tools → Debug Add-ons**
3. Click **"Load Temporary Add-on"** and select `manifest.json`

## Setup (first use)

The extension uses Google OAuth to create calendar events on your behalf:

1. Right-click any email → **Schedule Google Meet**
2. A Google sign-in tab opens automatically
3. Sign in and grant calendar access
4. The tab closes and you're ready to go — tokens are stored locally and refreshed automatically

## Usage

1. Right-click a message → **Schedule Google Meet**
2. Review/edit the pre-filled title, attendees, date, time, and timezone
3. Optionally click **Generate Meeting Link** to get a Meet URL to share in chat
4. Click **Send Invites** to create the event and email all attendees

## Development

```
google-meet-for-thunderbird/
├── manifest.json      # Extension manifest (Thunderbird MV2)
├── config.js          # OAuth credentials and API endpoints
├── background.js      # Context menu, OAuth flow, message listener
├── popup.html         # Scheduling dialog UI
├── popup.js           # Dialog logic and Calendar API calls
├── icons/
│   └── icon-64.png
├── index.html         # GitHub Pages landing page
└── privacy.html       # Privacy policy
```

Requires Thunderbird 78+. Uses `messenger.*` WebExtension APIs (Thunderbird-specific).

## Privacy

The extension accesses email metadata and calls the Google Calendar API directly from your computer. No data is sent to any developer-operated server. See the full [Privacy Policy](https://cancodr.github.io/google-meet-for-thunderbird/privacy.html).

## License

MIT
