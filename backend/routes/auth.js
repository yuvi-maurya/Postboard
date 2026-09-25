import { randomBytes } from "node:crypto";
import express from "express";
import { google } from "googleapis";
import { accountRepository, toPublicAccount } from "../repositories/accountRepository.js";

const router = express.Router();
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
const stateLifetimeMs = 10 * 60 * 1000;
const pendingStates = new Map();
const platforms = ["youtube", "instagram"];

function createState(platform) {
  const state = randomBytes(32).toString("hex");
  pendingStates.set(state, { platform, expiresAt: Date.now() + stateLifetimeMs });
  return state;
}

function consumeState(state, platform) {
  if (!state) return false;
  const pending = pendingStates.get(state);
  pendingStates.delete(state);
  if (!pending || pending.platform !== platform || pending.expiresAt < Date.now()) return false;
  return true;
}

function redirectWithResult(res, platform, result) {
  const redirect = new URL(frontendUrl);
  redirect.searchParams.set("oauth", platform);
  redirect.searchParams.set("result", result);
  return res.redirect(redirect.toString());
}

function requireEnv(names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) {
    const error = new Error(`OAuth is not configured. Missing: ${missing.join(", ")}`);
    error.status = 503;
    throw error;
  }
}

function createGoogleClient() {
  requireEnv(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"]);
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

async function getYoutubeAccessToken() {
  const client = await getYoutubeAuthClient();
  return client.credentials.access_token;
}

async function getYoutubeAuthClient() {
  const account = await accountRepository.findByPlatform("youtube");
  if (!account?.connected || !account.refreshToken) {
    const error = new Error("YouTube not connected.");
    error.status = 401;
    throw error;
  }

  const client = createGoogleClient();
  client.setCredentials({
    access_token: account.accessToken,
    refresh_token: account.refreshToken,
    expiry_date: account.expiresAt
  });

  if (account.expiresAt && account.expiresAt > Date.now() + 60_000) {
    return client;
  }

  const { credentials } = await client.refreshAccessToken();
  await accountRepository.upsert({
    ...account,
    accessToken: credentials.access_token,
    expiresAt: credentials.expiry_date ?? Date.now() + 3600_000
  });
  client.setCredentials(credentials);
  return client;
}

router.get("/youtube", (req, res, next) => {
  try {
    const client = createGoogleClient();
    const state = createState("youtube");
    const url = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/youtube.upload"],
      state
    });
    return res.redirect(url);
  } catch (error) {
    return next(error);
  }
});

router.get("/youtube/callback", async (req, res, next) => {
  try {
    if (!consumeState(req.query.state, "youtube")) return redirectWithResult(res, "youtube", "error");
    if (req.query.error) return redirectWithResult(res, "youtube", "error");

    const client = createGoogleClient();
    const { tokens } = await client.getToken(req.query.code);
    client.setCredentials(tokens);
    const youtube = google.youtube({ version: "v3", auth: client });
    const response = await youtube.channels.list({ part: ["snippet"], mine: true });
    const channel = response.data.items?.[0];
    if (!channel) throw new Error("No YouTube channel was found for this account.");

    const previous = await accountRepository.findByPlatform("youtube");
    await accountRepository.upsert({
      platform: "youtube",
      connected: true,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? previous?.refreshToken,
      expiresAt: tokens.expiry_date ?? Date.now() + 3600_000,
      accountName: channel.snippet?.title ?? "YouTube channel"
    });
    return redirectWithResult(res, "youtube", "success");
  } catch (error) {
    return next(error);
  }
});

async function graphRequest(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(body.error?.message || "Meta OAuth request failed.");
  }
  return body;
}

router.get("/instagram", (req, res, next) => {
  try {
    requireEnv(["META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI"]);
    const state = createState("instagram");
    const params = new URLSearchParams({
      client_id: process.env.META_APP_ID,
      redirect_uri: process.env.META_REDIRECT_URI,
      response_type: "code",
      scope: "instagram_content_publish,pages_read_engagement",
      state
    });
    return res.redirect(`https://www.facebook.com/v20.0/dialog/oauth?${params}`);
  } catch (error) {
    return next(error);
  }
});

router.get("/instagram/callback", async (req, res, next) => {
  try {
    if (!consumeState(req.query.state, "instagram")) return redirectWithResult(res, "instagram", "error");
    if (req.query.error) return redirectWithResult(res, "instagram", "error");
    requireEnv(["META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI"]);

    const graphBase = "https://graph.facebook.com/v20.0";
    const shortTokenParams = new URLSearchParams({
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      redirect_uri: process.env.META_REDIRECT_URI,
      code: req.query.code
    });
    const shortToken = await graphRequest(`${graphBase}/oauth/access_token?${shortTokenParams}`);
    const longTokenParams = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      fb_exchange_token: shortToken.access_token
    });
    const longToken = await graphRequest(`${graphBase}/oauth/access_token?${longTokenParams}`);
    // This only works for an Instagram Business/Creator account linked to a Facebook Page.
    const pages = await graphRequest(`${graphBase}/me/accounts?fields=id,name,instagram_business_account&access_token=${encodeURIComponent(longToken.access_token)}`);
    const page = pages.data?.find((item) => item.instagram_business_account?.id);
    if (!page) throw new Error("No linked Instagram Business or Creator account was found.");
    const instagram = await graphRequest(`${graphBase}/${page.instagram_business_account.id}?fields=id,username&access_token=${encodeURIComponent(longToken.access_token)}`);

    await accountRepository.upsert({
      platform: "instagram",
      connected: true,
      accountId: instagram.id,
      accessToken: longToken.access_token,
      refreshToken: null,
      expiresAt: Date.now() + (longToken.expires_in ?? 5_184_000) * 1000,
      accountName: instagram.username ?? page.name
    });
    return redirectWithResult(res, "instagram", "success");
  } catch (error) {
    return next(error);
  }
});

router.get("/status", async (_req, res, next) => {
  try {
    const accounts = await accountRepository.findAll();
    return res.json(platforms.map((platform) => toPublicAccount(accounts.find((account) => account.platform === platform) ?? {
      platform,
      connected: false,
      accountName: null
    })));
  } catch (error) {
    return next(error);
  }
});

router.post("/logout/:platform", async (req, res, next) => {
  try {
    if (!platforms.includes(req.params.platform)) return res.status(400).json({ message: "Unsupported platform." });
    await accountRepository.disconnect(req.params.platform);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

export { getYoutubeAccessToken };
export { getYoutubeAuthClient };
export default router;
