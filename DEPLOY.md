# Put the game online (free) — share one link, play from phones

This puts the game on **Render's free plan** so you get a link like
`https://monopoly-online-abcd.onrender.com` that anyone can open on their phone — no app, no sign-up for your friends.
You need a computer for the setup (about 10 minutes, once). No coding or command line needed.

## 1. Put the code on GitHub

1. Unzip `monopoly-online.zip`.
2. Go to <https://github.com> and sign up / log in.
3. Click **+** (top right) → **New repository**. Name it `monopoly-online`. Public or Private both work. Click **Create repository**.
4. On the next page click the link **"uploading an existing file"**.
5. Open the unzipped `monopoly-online` folder, select **everything inside it** (the `engine`, `maps`, `public`, `server`, `test` folders and files like `package.json` and `render.yaml`) and drag it onto the GitHub page.
   Use Chrome, Edge or Firefox on a computer — dragging folders works there.
6. Wait for the files to finish uploading, then click **Commit changes**.

Check: your repository page should show `package.json` and `render.yaml` at the top level (not inside another folder).

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
- **Updating the game:** upload changed files to the same GitHub repository (Add file → Upload files). Render redeploys automatically in a few minutes.
