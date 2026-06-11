// Google OAuth 2.0 Credentials
// Copy this file to config.js and fill in your credentials from Google Cloud Console:
// https://console.cloud.google.com/apis/credentials
//
// Create a project, enable the Google Calendar API, and create an OAuth 2.0
// Client ID of type "Desktop app". Then paste your Client ID and Secret below.

const CONFIG = {
  CLIENT_ID: "YOUR_CLIENT_ID.apps.googleusercontent.com",
  CLIENT_SECRET: "YOUR_CLIENT_SECRET",

  // OAuth scopes required
  SCOPES: [
    "https://www.googleapis.com/auth/calendar.events",
  ].join(" "),

  // Google OAuth endpoints
  AUTH_URL: "https://accounts.google.com/o/oauth2/v2/auth",
  TOKEN_URL: "https://oauth2.googleapis.com/token",

  // Google Calendar API
  CALENDAR_API_BASE: "https://www.googleapis.com/calendar/v3",

  // Redirect URI — Desktop OAuth clients allow http://localhost automatically
  REDIRECT_URI: "http://localhost",
};
