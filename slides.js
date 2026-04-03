/**
 * /api/slides.js  — Vercel Serverless Function
 * Proxies Notion API. Token never touches frontend code.
 *
 * Notion DB schema expected:
 *   "Title"   — Title property  (renamed from "Name")
 *   "content" — Text property
 *
 * GET  /api/slides  → returns { [Title_value]: content_value, ... }
 * POST /api/slides  → upserts a row  { slide_key, content }
 */

const NOTION_TOKEN   = process.env.NOTION_TOKEN;
const NOTION_DB_ID   = process.env.NOTION_DB_ID;
const NOTION_VERSION = '2022-06-28';

function notionHeaders() {
  return {
    'Authorization':  `Bearer ${NOTION_TOKEN}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type':   'application/json',
  };
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!NOTION_TOKEN || !NOTION_DB_ID) {
    console.error('Missing env vars');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  try {
    if (req.method === 'GET')       return await getSlides(res);
    if (req.method === 'POST')      return await saveSlide(req, res);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: err.message });
  }
};

async function getSlides(res) {
  const response = await fetch(
    `https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`,
    { method: 'POST', headers: notionHeaders(), body: JSON.stringify({ page_size: 100 }) }
  );
  const raw = await response.text();
  if (!response.ok) {
    console.error('Notion GET error:', response.status, raw);
    return res.status(response.status).json({ error: raw });
  }
  const data   = JSON.parse(raw);
  const slides = {};
  for (const page of data.results) {
    // Handles "Title", "slide_key", or "Name" — whichever your DB uses
    const titleProp =
      page.properties?.Title     ??
      page.properties?.slide_key ??
      page.properties?.Name      ?? null;
    const key = titleProp?.title?.[0]?.plain_text;
    if (!key) continue;
    slides[key] = page.properties?.content?.rich_text?.[0]?.plain_text ?? '';
  }
  return res.status(200).json(slides);
}

async function saveSlide(req, res) {
  const { slide_key, content } = req.body ?? {};
  if (!slide_key) return res.status(400).json({ error: 'slide_key required' });

  // Query for existing row
  const queryRes = await fetch(
    `https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`,
    {
      method: 'POST', headers: notionHeaders(),
      body: JSON.stringify({
        filter: { property: 'Title', title: { equals: slide_key } }
      }),
    }
  );
  const queryRaw  = await queryRes.text();
  if (!queryRes.ok) {
    console.error('Notion query error:', queryRes.status, queryRaw);
    return res.status(queryRes.status).json({ error: queryRaw });
  }
  const existing = JSON.parse(queryRaw).results?.[0];

  if (existing) {
    // UPDATE
    const r = await fetch(`https://api.notion.com/v1/pages/${existing.id}`, {
      method: 'PATCH', headers: notionHeaders(),
      body: JSON.stringify({
        properties: {
          content: { rich_text: [{ type: 'text', text: { content: content ?? '' } }] }
        }
      }),
    });
    const raw = await r.text();
    if (!r.ok) { console.error('Update error:', r.status, raw); return res.status(r.status).json({ error: raw }); }
    return res.status(200).json({ status: 'updated' });
  } else {
    // CREATE
    const r = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST', headers: notionHeaders(),
      body: JSON.stringify({
        parent: { database_id: NOTION_DB_ID },
        properties: {
          Title:   { title:     [{ type: 'text', text: { content: slide_key } }] },
          content: { rich_text: [{ type: 'text', text: { content: content ?? '' } }] },
        },
      }),
    });
    const raw = await r.text();
    if (!r.ok) { console.error('Create error:', r.status, raw); return res.status(r.status).json({ error: raw }); }
    return res.status(201).json({ status: 'created' });
  }
}
