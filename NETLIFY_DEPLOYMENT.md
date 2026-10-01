# Mary Collections — GitHub → Netlify

Repository: https://github.com/dadlavinia/maryadmin

## What is deployment-ready

- Vite admin frontend builds to `admin/dist`.
- Express API runs through `netlify/functions/api.js`.
- `/api/*` and `/health` are rewritten to the Netlify Function.
- SPA fallback rewrites other routes to `index.html`.
- Supabase values are read from Netlify runtime environment variables.
- `backend/.env` is intentionally excluded from Git by `.gitignore`.

## 1. Push to GitHub from Windows CMD

Open CMD in the extracted `mary-collections` folder and run:

```bat
cd /d E:\mary-collections

git init
git branch -M main
git remote remove origin 2>nul
git remote add origin https://github.com/dadlavinia/maryadmin.git

git add .
git status
git commit -m "Prepare Mary Collections for Netlify deployment"
git push -u origin main
```

If GitHub rejects the push because the remote already has a commit, use this safer sequence instead of force-pushing:

```bat
git pull origin main --rebase
git push -u origin main
```

## 2. Create the Netlify site

In Netlify:

1. Add new project → Import an existing project.
2. Select GitHub and choose `dadlavinia/maryadmin`.
3. Netlify will read `netlify.toml`; do not replace its build settings.
4. Add the environment variables below before the production deploy.

## 3. Netlify environment variables

Set these in Netlify Project configuration → Environment variables:

- `SUPABASE_URL` = your Supabase project URL
- `SUPABASE_PUBLISHABLE_KEY` = your Supabase publishable/anon key
- `ALLOWED_ORIGINS` = optional comma-separated extra origins. The main Netlify production URL is automatically accepted through Netlify's `URL` runtime variable.

Do not add a Supabase service-role or secret key.

## 4. Supabase Auth URL

After Netlify gives you the production URL, open Supabase → Authentication → URL Configuration and add the Netlify production URL to the allowed redirect URLs. Set the Site URL appropriately if this is the production application. Mary uses `location.origin` for password recovery, so this is required for reset links to return to the deployed application.

This is an authenticated admin application, so `admin/public/robots.txt` intentionally blocks search-engine crawling and the HTML already uses `noindex,nofollow`. No public sitemap is needed.

## 5. Expected Netlify build settings

These are already defined in `netlify.toml`:

- Build command: `npm ci --prefix admin && npm ci --prefix backend && npm install --prefix netlify/functions --omit=dev --no-audit --no-fund && npm run build --prefix admin`
- Publish directory: `admin/dist`
- Functions directory: `netlify/functions`
- Node: 22

## 6. After deployment

Check:

- `/` loads the Mary Collections login/dashboard.
- `/health` returns the API health JSON.
- Sign-in reaches `/api/config` and Supabase successfully.
- Dashboard charts drill down to the invoice register.
- Imports and report downloads work from the deployed site.
