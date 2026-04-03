/**
 * /api/slides.js  — Vercel Serverless Function
 * Proxies all Notion requests so the token never appears in frontend code.
 * Token is stored as NOTION_TOKEN in Vercel environment variables.
 * DB ID is stored as NOTION_DB_ID in Vercel environment variables.
 *
 * GET  /api/slides          → fetch all slide content from Notion
 * POST /api/slides          → save / update a slide field in Notion
 */

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DB_ID = process.env.NOTION_DB_ID;
const NOTION_VERSION = '2022-06-28';

const notionHeaders = {
  'Authorization': `Bearer ${NOTION_TOKEN}`,
  'Notion-Version': NOTION_VERSION,
  'Content-Type': 'application/json',
};

// ── CORS helper ──────────────────────────────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      return await getSlides(req, res);
    } else if (req.method === 'POST') {
      return await saveSlide(req, res);
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ── GET: fetch all slides from Notion ────────────────────────────────────────
async function getSlides(req, res) {
  const url = `https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`;
  const response = await fetch(url, {
    method: 'POST',
    headers: notionHeaders,
    body: JSON.stringify({ page_size: 100 }),
  });

  if (!response.ok) {
    const err = await response.text();
    return res.status(response.status).json({ error: err });
  }

  const data = await response.json();

  // Flatten to a simple { slide_key: content } map
  const slides = {};
  for (const page of data.results) {
    const key = page.properties?.slide_key?.title?.[0]?.plain_text;
    const content = page.properties?.content?.rich_text?.[0]?.plain_text ?? '';
    if (key) slides[key] = content;
  }

  return res.status(200).json(slides);
}

// ── POST: upsert a single slide field ────────────────────────────────────────
async function saveSlide(req, res) {
  const { slide_key, content } = req.body;
  if (!slide_key) return res.status(400).json({ error: 'slide_key required' });

  // Check if a page with this slide_key already exists
  const queryRes = await fetch(
    `https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`,
    {
      method: 'POST',
      headers: notionHeaders,
      body: JSON.stringify({
        filter: {
          property: 'slide_key',
          title: { equals: slide_key },
        },
      }),
    }
  );

  const queryData = await queryRes.json();
  const existing = queryData.results?.[0];

  if (existing) {
    // UPDATE existing page
    const updateRes = await fetch(
      `https://api.notion.com/v1/pages/${existing.id}`,
      {
        method: 'PATCH',
        headers: notionHeaders,
        body: JSON.stringify({
          properties: {
            content: {
              rich_text: [{ type: 'text', text: { content: content ?? '' } }],
            },
          },
        }),
      }
    );
    const updated = await updateRes.json();
    return res.status(200).json({ status: 'updated', id: updated.id });
  } else {
    // CREATE new page
    const createRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: notionHeaders,
      body: JSON.stringify({
        parent: { database_id: NOTION_DB_ID },
        properties: {
          slide_key: {
            title: [{ type: 'text', text: { content: slide_key } }],
          },
          content: {
            rich_text: [{ type: 'text', text: { content: content ?? '' } }],
          },
        },
      }),
    });
    const created = await createRes.json();
    return res.status(201).json({ status: 'created', id: created.id });
  }
}
