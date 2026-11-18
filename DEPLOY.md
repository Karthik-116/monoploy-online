# Put the game online (free) — share one link, play from phones

This puts the game on **Render's free plan** so you get a link like
`https://monopoly-online-abcd.onrender.com` that anyone can open on their phone — no app, no sign-up for your friends.
You need a computer for the setup (about 10 minutes, once). No coding or command line needed.

## 1. Put the code on GitHub

Use **monopoly-upload.zip** — it holds just 4 files and no folders, so nothing can go missing during the upload (the full project's folders are easy to lose with GitHub's web upload, which causes `Cannot find module .../server/index.js` on Render).

1. Unzip `monopoly-upload.zip`. You get `server.js`, `index.html`, `package.json` and `render.yaml`.
2. Go to <https://github.com> and sign up / log in.
3. Click **+** (top right) → **New repository**. Name it `monopoly-online`. Public or Private both work. Click **Create repository**.
4. On the next page click the link **"uploading an existing file"**.
5. Select or drag in the **4 files** (works with "choose your files" too, even on a phone).
6. Click **Commit changes**.

Check: the repository page lists exactly `index.html`, `package.json`, `render.yaml` and `server.js` at the top level.

**Already have a repository that failed?** Open it, click **Add file → Upload files**, upload the same 4 files (they replace the old `package.json` and `render.yaml`), and commit. Render redeploys by itself within a few minutes — no need to set it up again.

To rebuild these 4 files after changing the source code, run `npm run build:flat` in the full project; they appear in `upload/`.

## 2. Launch it on Render

1. Go to <https://render.com> → **Get Started** → **sign up with GitHub** (easiest).
2. In the Render dashboard click **New +** → **Blueprint**.
3. Connect your GitHub account if asked, and choose the `monopoly-online` repository (give Render access to it if it isn't listed).
4. Render reads `render.yaml` and shows one free web service. Click **Apply** / **Deploy Blueprint**.
5. Wait 2–5 minutes until the service shows **Live**. Your link is shown at the top of the service page (`https://….onrender.com`).

If you'd rather not use a Blueprint: **New +** → **Web Service** → pick the repo → Runtime **Node**, Build command `npm install`, Start command `npm start`, Instance type **Free** → **Create Web Service**.

## 3. Play

1. Open your link on your phone, type your name, tap **Create a room**.
2. Tap **Share** and send the invite to your friends (WhatsApp, Messages, etc.).
3. Friends open the link, type their name, tap **Join**. When everyone's in, tap **Start game**.

Tips for phones: the dice and buttons sit at the bottom of the screen; tap **🔍 Zoom board** to read the spaces; tap any space to see its card and to build, sell or mortgage.

## Good to know (free plan)

- **First open can be slow.** If nobody has used the game for 15 minutes, Render puts it to sleep. The next visit wakes it up, which can take up to about a minute — just wait on the loading page. Open the link a minute before you start.
- **A game in progress stays awake** — Render counts the players' live connection as activity.
- **Games aren't saved.** If the server sleeps or restarts (including when you upload changes), running games end and everyone starts a new room.
- **Updating the game:** run `npm run build:flat` in the full project, then upload the 4 files from `upload/` to the same GitHub repository (Add file → Upload files). Render redeploys automatically in a few minutes.
