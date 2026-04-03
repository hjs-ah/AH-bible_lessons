/**
 * /api/pin.js — Vercel Serverless Function
 * Validates presenter PIN against PRESENTER_PIN environment variable.
 * POST { pin: "1234" } → { valid: true/false }
 */

const PRESENTER_PIN = process.env.PRESENTER_PIN;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { pin } = req.body ?? {};

  // If env var not set, fall back to default so nothing breaks
  const correct = PRESENTER_PIN || '2408';

  return res.status(200).json({ valid: pin === correct });
};
