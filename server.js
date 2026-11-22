require("dotenv").config();
const express = require("express");
const session = require("express-session");
const { google } = require("googleapis");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;

const downloads = [
  {
    id: "original64",
    title: "Original Version — 64-Bit",
    url: "https://drive.usercontent.google.com/download?id=1DwjJb13cWts9dUu_rn8sGR-kKRP9mj54&export=download&authuser=0"
  },
  {
    id: "original32",
    title: "Original Version — 32-Bit",
    url: "https://drive.usercontent.google.com/download?id=1lf5mK4R27ffOtUeYVKUW7mxIQzwJjs7f&export=download&authuser=0"
  },
  {
    id: "original64x86",
    title: "Original Version — 64 + x86",
    url: "https://drive.usercontent.google.com/download?id=1DwjJb13cWts9dUu_rn8sGR-kKRP9mj54&export=download&authuser=0"
  },
  {
    id: "patch",
    title: "Patch Version",
    url: "https://drive.usercontent.google.com/download?id=1A7amhJkUHuRsdx8JqcX1MYop4NlABH4K&export=download&authuser=0"
  }
];

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${BASE_URL}/auth/google/callback`
);

app.use(session({
  secret: process.env.SESSION_SECRET || "development-only-change-this",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: BASE_URL.startsWith("https://"),
    maxAge: 60 * 60 * 1000
  }
}));

app.use(express.static(path.join(__dirname, "public")));

app.get("/auth/google", (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).send("Google OAuth is not configured yet.");
  }
  const url = oauth2Client.generateAuthUrl({
    access_type: "online",
    scope: ["https://www.googleapis.com/auth/youtube.readonly"],
    include_granted_scopes: true,
    state: "easyfix-subscription-check"
  });
  res.redirect(url);
});

app.get("/auth/google/callback", async (req, res) => {
  try {
    if (!req.query.code) return res.redirect("/?error=google_login_cancelled");
    const { tokens } = await oauth2Client.getToken(req.query.code);
    req.session.tokens = tokens;
    res.redirect("/");
  } catch (err) {
    console.error("OAuth callback failed:", err.message);
    res.redirect("/?error=google_login_failed");
  }
});

app.get("/api/status", async (req, res) => {
  if (!req.session.tokens) {
    return res.json({ signedIn: false, verified: false });
  }
  if (!CHANNEL_ID || CHANNEL_ID.includes("PUT_YOUR")) {
    return res.status(503).json({
      signedIn: true,
      verified: false,
      setupNeeded: true,
      message: "The channel owner still needs to configure the YouTube channel ID."
    });
  }

  try {
    oauth2Client.setCredentials(req.session.tokens);
    const youtube = google.youtube({ version: "v3", auth: oauth2Client });

    let pageToken;
    let subscribed = false;
    do {
      const result = await youtube.subscriptions.list({
        part: ["snippet"],
        mine: true,
        maxResults: 50,
        pageToken
      });
      const items = result.data.items || [];
      subscribed = items.some(item =>
        item.snippet?.resourceId?.kind === "youtube#channel" &&
        item.snippet?.resourceId?.channelId === CHANNEL_ID
      );
      pageToken = result.data.nextPageToken;
    } while (!subscribed && pageToken);

    req.session.verified = subscribed;
    res.json({ signedIn: true, verified: subscribed });
  } catch (err) {
    console.error("YouTube verification failed:", err.message);
    res.status(502).json({
      signedIn: true,
      verified: false,
      error: "Could not verify this account right now. Please try again."
    });
  }
});

app.get("/api/downloads", (req, res) => {
  if (!req.session.verified) {
    return res.status(403).json({ error: "Subscription verification required." });
  }
  res.json({ downloads });
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

app.listen(PORT, () => {
  console.log(`Easy Fix portal running at ${BASE_URL}`);
});