# Postboard

Postboard is a local-first social media drafting and publishing app built with Node.js, Express, React, Vite, and Tailwind CSS. It supports local media storage, YouTube and Instagram OAuth, YouTube uploads, Instagram Content Publishing, optional video audio processing, generated thumbnails, and a combined “Post to All” flow. LinkedIn is displayed as coming soon because API access is pending.

## Prerequisites

- Node.js 18 or newer
- npm
- A Google Cloud project for YouTube OAuth
- A Meta Developer app for Instagram OAuth
- ngrok for local Instagram publishing

## Environment variables

Copy `.env.example` to `.env` in the project root:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:5000/api/auth/youtube/callback
META_APP_ID=
META_APP_SECRET=
META_REDIRECT_URI=http://localhost:5000/api/auth/instagram/callback
FRONTEND_URL=http://localhost:5173
PUBLIC_BASE_URL=https://your-ngrok-url.ngrok-free.app
```

`PUBLIC_BASE_URL` is required only when publishing to Instagram. It must be an HTTPS URL that can fetch `/uploads/...` from the running backend.

## Google Cloud and YouTube setup

1. Create or select a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable **YouTube Data API v3**.
3. Configure the OAuth consent screen and add your test account.
4. Create an OAuth **Web application** client.
5. Register `http://localhost:5000/api/auth/youtube/callback` as an authorized redirect URI.
6. Copy the client ID and secret into `.env`.

The app requests `https://www.googleapis.com/auth/youtube.upload`. YouTube uploads use the selected public, unlisted, or private visibility.

## Meta and Instagram setup

1. Create an app at [Meta for Developers](https://developers.facebook.com/).
2. Configure Facebook Login and the Instagram Graph API products.
3. Register `http://localhost:5000/api/auth/instagram/callback` as a valid OAuth redirect URI.
4. Add the Meta app ID and secret to `.env`.
5. Use a Business or Creator Instagram account linked to a Facebook Page.

The OAuth flow requests `instagram_content_publish` and `pages_read_engagement`. Meta may require tester roles or app review.

## ngrok setup for Instagram

Start the backend first, then run:

```powershell
ngrok http 5000
```

Copy the HTTPS forwarding URL into `PUBLIC_BASE_URL`, restart the backend, and make sure uploaded media is reachable at `https://your-url/uploads/<filename>`. The free ngrok URL changes every time ngrok restarts, so update `PUBLIC_BASE_URL` during every development session.

## Run the app

Backend terminal:

```powershell
cd backend
npm install
npm run dev
```

Frontend terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

End-to-end flow:

1. Connect YouTube and/or Instagram from **Connected accounts**.
2. Upload an image or video with a required caption.
3. Optionally add licensed background audio to a video.
4. Use the individual platform buttons or **Post to All Connected Platforms**.
5. Review per-platform success links or errors.
6. Delete the draft and its derived media when finished.

## Storage and processing

Original uploads are stored in `backend/uploads/`. Metadata is stored in `backend/data/posts.json`, and account tokens remain server-side in `backend/data/accounts.json`. The repository abstractions can later be replaced with PostgreSQL.

FFmpeg generates video thumbnails and can merge MP3/WAV audio up to 15MB. Processing can be CPU-intensive, so use test videos under roughly 30 seconds during development. Only use audio you own or have explicit rights to use, such as your own recordings or royalty-free libraries. Do not extract or reuse copyrighted/licensed music from other platforms; that can cause copyright claims or takedowns.

## Known limitations

- LinkedIn publishing is not implemented; it is shown as **Coming soon** until API access is approved.
- YouTube's default free quota is limited to roughly six uploads per day; test sparingly.
- Free ngrok URLs change after each restart and require a `PUBLIC_BASE_URL` update.
- Instagram requires public media URLs and a Business/Creator account linked to a Facebook Page.
- In-memory publishing locks reset when the backend restarts and are intended for this single-process local app.
- JSON files are a development store and are not suitable for concurrent production workloads.
