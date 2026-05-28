# VIBE ✦

## Deploy to Railway (free, ~5 minutes)

### Step 1 — Free Postgres database (Neon)
1. Go to [neon.tech](https://neon.tech) → Sign up free (no credit card)
2. Create a project → copy the **Connection string** (looks like `postgresql://user:pass@host/dbname?sslmode=require`)

### Step 2 — Push to GitHub
```bash
git init
git add .
git commit -m "init"
git remote add origin https://github.com/YOUR_USERNAME/vibe.git
git push -u origin main
```

### Step 3 — Deploy on Railway
1. Go to [railway.app](https://railway.app) → New Project → **Deploy from GitHub repo**
2. Select your repo
3. Go to **Variables** tab → add these 3:

| Variable | Value |
|---|---|
| `DATABASE_URL` | your Neon connection string |
| `JWT_SECRET` | any random string e.g. `vibe_jwt_abc123xyz` |
| `JWT_REFRESH_SECRET` | any other random string e.g. `vibe_ref_xyz789abc` |

4. Railway auto-runs `npm run build` (migrates DB) then `npm start`
5. Click the generated URL — done ✦

### Local development
```bash
cp .env.example .env   # fill in your Neon DATABASE_URL
npm install
npx prisma migrate dev --name init
node server.js
# → http://localhost:3000
```

## What works out of the box
- Auth (register / login / JWT)
- Servers, channels, messages, DMs, polls, reactions, pins
- XP, levels, credits, shop (17 items), streaks
- Friends, notifications
- Avatar upload → local disk (or Cloudinary if configured)
- GIFs via Giphy
- 3 themes: dark / darker / neon
- No Redis required (in-memory fallback)
