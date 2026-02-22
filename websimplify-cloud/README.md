# WebSimplify – Cloud Backend

Next.js API backend deployed to Vercel. Provides the `/api/rewrite` endpoint that rewrites text for readability using OpenAI.

## API

### `POST /api/rewrite`

**Request body:**

```json
{
  "items": [
    { "id": "0", "text": "Long paragraph of text to simplify..." },
    { "id": "1", "text": "Another block of text..." }
  ]
}
```

**Response:**

```json
{
  "items": [
    { "id": "0", "text": "Simplified version of the text..." },
    { "id": "1", "text": "Simplified version..." }
  ]
}
```

**Limits:**

| Limit | Value |
|---|---|
| Max items per request | 12 |
| Max chars per item | 1,200 |
| Max total chars | 5,000 |

## Local Development

1. Install dependencies:

```bash
cd websimplify-cloud
npm install
```

2. Create a `.env.local` file:

```bash
OPENAI_API_KEY=sk-your-key-here
```

3. Run the dev server:

```bash
npm run dev
```

The API will be available at `http://localhost:3000/api/rewrite`.

4. Update the extension's `background.js` to point to `http://localhost:3000/api/rewrite` for local testing.

## Deploy to Vercel (via Website)

### Step 1: Push this repo to GitHub

Make sure this repository is pushed to your GitHub account. If you're reading this on GitHub, you're already done with this step.

### Step 2: Import the project on Vercel

1. Go to [vercel.com](https://vercel.com) and sign in (or sign up) with your GitHub account.
2. From the dashboard, click the **"Add New..."** button (top right) and select **"Project"**.
3. You will see a list of your GitHub repositories. Find **this repo** and click **"Import"** next to it.
   - If you don't see it, click **"Adjust GitHub App Permissions"** and grant Vercel access to the repo.

### Step 3: Configure the project

On the "Configure Project" screen before deploying:

1. **Project Name** — leave as-is or change to something like `websimplify-cloud`.
2. **Framework Preset** — Vercel should auto-detect **Next.js**. If not, select it from the dropdown.
3. **Root Directory** — click **"Edit"** and type `websimplify-cloud`, then confirm. This is critical because the Next.js app is in a subfolder, not the repo root.
4. **Build and Output Settings** — leave all defaults. Vercel handles Next.js automatically.
5. **Environment Variables** — expand this section and add:
   - **Key:** `OPENAI_API_KEY`
   - **Value:** your OpenAI API key (starts with `sk-`)
   - Click **"Add"** to save it.

### Step 4: Deploy

Click the **"Deploy"** button. Vercel will build and deploy the project. This takes about 30–60 seconds.

When it's done you'll see a success screen with your deployment URL (e.g. `https://websimplify-cloud.vercel.app`).

### Step 5: Verify it works

Visit your deployment URL in a browser. You should see the "WebSimplify API" landing page. The rewrite endpoint is live at:

```
https://<your-project-name>.vercel.app/api/rewrite
```

### Step 6: Update the extension

Open `extension/background.js` and replace the `API_URL` value with your actual Vercel deployment URL:

```js
const API_URL = "https://<your-project-name>.vercel.app/api/rewrite";
```

Then reload the extension in `chrome://extensions/`.

### Updating after code changes

Any time you push new commits to the branch connected to Vercel, it will automatically rebuild and redeploy. No manual steps needed.

### Managing the environment variable later

If you need to change your OpenAI key after the initial deploy:

1. Go to your project on [vercel.com](https://vercel.com).
2. Click **"Settings"** (top nav).
3. Click **"Environment Variables"** (left sidebar).
4. Find `OPENAI_API_KEY`, click the three-dot menu, and select **"Edit"**.
5. Save the new value, then go to **"Deployments"** and click the three-dot menu on the latest deployment and select **"Redeploy"**.

## Security

- The OpenAI API key is stored ONLY in Vercel environment variables.
- The key is never exposed to the extension or the browser.
- User text content is not logged.
- Input sizes are validated and truncated.
