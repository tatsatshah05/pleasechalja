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

## Deploy to Vercel

### Option A: Vercel CLI

1. Install the Vercel CLI:

```bash
npm i -g vercel
```

2. Deploy:

```bash
cd websimplify-cloud
vercel
```

3. Set the environment variable:

```bash
vercel env add OPENAI_API_KEY
```

Enter your OpenAI API key when prompted. Redeploy after adding the env var:

```bash
vercel --prod
```

### Option B: Vercel Dashboard

1. Push this repo to GitHub.
2. Go to [vercel.com](https://vercel.com) and import the repo.
3. Set the **Root Directory** to `websimplify-cloud`.
4. Add the environment variable `OPENAI_API_KEY` in **Settings → Environment Variables**.
5. Deploy.

## Security

- The OpenAI API key is stored ONLY in Vercel environment variables.
- The key is never exposed to the extension or the browser.
- User text content is not logged.
- Input sizes are validated and truncated.
