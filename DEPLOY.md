# Campex Deploy Guide

Campex is a Discord-style Node website. It runs locally with `data/db.json`, and it automatically uses PostgreSQL when a host provides `DATABASE_URL`.

## Local Preview

```powershell
cd C:\Users\eligt\Documents\Codex\2026-07-03\can\outputs\campex
C:\Users\eligt\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe server.js
```

Open:

`http://localhost:4173`

Owner login:

`owner@campex.local`

`campexowner`

## Deploy On Render Without A Credit Card

Render gives URLs like:

`https://campex.onrender.com`

The current `render.yaml` creates only the web app. It does not create a Render database, because that can cause billing/card prompts.

Use this setup:

1. Make a free PostgreSQL database somewhere like Supabase or Neon.
2. Copy its PostgreSQL connection string.
3. Upload this `campex` folder to GitHub.
4. In Render, create a new Blueprint or Web Service from the GitHub repo.
5. Add this environment variable in Render:

`DATABASE_URL`

Set it to your PostgreSQL connection string.

6. Deploy.

If the name `campex` is available, the public URL can be:

`https://campex.onrender.com`

If the name is taken, Render will use a slightly different URL.

## Deploy On Fly.io

Fly gives URLs like `https://campex.fly.dev`, but Fly may ask for a credit card.

The included `fly.toml` and `Dockerfile` are still ready if you decide to use Fly later.

## Production Notes

- Do not commit `data/db.json`; it is ignored by `.gitignore`.
- Keep `DATABASE_URL` secret.
- Campex Team is an official account in the app, not a real support inbox.
- The app includes a health check at `/api/health`.
