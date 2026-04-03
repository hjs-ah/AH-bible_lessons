/**
 * /api/slides.js  — Vercel Serverless Function
 * Notion DB columns: "slide_key" (Title type), "content" (Text type)
 *
 * GET  /api/slides  → { [slide_key]: content, ... }
 * POST /api/slides  → upsert { slide_key, content }
 */

const NOTION_TOKEN   = process.env.NOTION_TOKEN;
const NOTION_DB_ID   = process.env.NOTION_DB_ID;
const NOTION_VERSION = '2022-06-28';

function headers() {
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
    return res.status(500).json({ error: 'Missing env vars NOTION_TOKEN or NOTION_DB_ID' });
  }

  try {
    if (req.method === 'GET')  return await getSlides(res);
    if (req.method === 'POST') return await saveSlide(req, res);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: err.message });
  }
};

// ── GET ───────────────────────────────────────────────────────────────────────
async function getSlides(res) {
  const r = await fetch(
    `https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`,
    { method: 'POST', headers: headers(), body: JSON.stringify({ page_size: 100 }) }
  );
  const raw = await r.text();
  if (!r.ok) {
    console.error('Notion GET error:', r.status, raw);
    return res.status(r.status).json({ error: raw });
  }
  const slides = {};
  for (const page of JSON.parse(raw).results) {
    const key     = page.properties?.slide_key?.title?.[0]?.plain_text;
    const content = page.properties?.content?.rich_text?.[0]?.plain_text ?? '';
    if (key) slides[key] = content;
  }
  return res.status(200).json(slides);
}

// ── POST — upsert ─────────────────────────────────────────────────────────────
async function saveSlide(req, res) {
  const { slide_key, content } = req.body ?? {};
  if (!slide_key) return res.status(400).json({ error: 'slide_key required' });

  // Find existing row
  const qr = await fetch(
    `https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`,
    {
      method:  'POST',
      headers: headers(),
      body: JSON.stringify({
        filter: { property: 'slide_key', title: { equals: slide_key } }
      }),
    }
  );
  const qraw = await qr.text();
  if (!qr.ok) {
    console.error('Notion query error:', qr.status, qraw);
    return res.status(qr.status).json({ error: qraw });
  }

  const existing = JSON.parse(qraw).results?.[0];
  const contentProp = {
    content: { rich_text: [{ type: 'text', text: { content: content ?? '' } }] }
  };

  if (existing) {
    // UPDATE
    const r = await fetch(`https://api.notion.com/v1/pages/${existing.id}`, {
      method: 'PATCH', headers: headers(),
      body: JSON.stringify({ properties: contentProp }),
    });
    const raw = await r.text();
    if (!r.ok) { console.error('Update error:', r.status, raw); return res.status(r.status).json({ error: raw }); }
    return res.status(200).json({ status: 'updated' });
  } else {
    // CREATE
    const r = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST', headers: headers(),
      body: JSON.stringify({
        parent: { database_id: NOTION_DB_ID },
        properties: {
          slide_key: { title: [{ type: 'text', text: { content: slide_key } }] },
          ...contentProp,
        },
      }),
    });
    const raw = await r.text();
    if (!r.ok) { console.error('Create error:', r.status, raw); return res.status(r.status).json({ error: raw }); }
    return res.status(201).json({ status: 'created' });
  }
}
