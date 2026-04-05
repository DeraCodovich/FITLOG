// Vercel Serverless Function — проксі до Claude API
// Верифікує Firebase ID токен, потім пересилає запит до Anthropic
//
// Змінні середовища (задаються у Vercel Dashboard → Settings → Environment Variables):
//   ANTHROPIC_API_KEY       — ключ Anthropic
//   FIREBASE_PROJECT_ID     — з Firebase Console (напр. fitlog-app-be1d4)
//   FIREBASE_CLIENT_EMAIL   — з service account JSON (поле client_email)
//   FIREBASE_PRIVATE_KEY    — з service account JSON (поле private_key, з переносами \n)

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

// Ініціалізуємо Firebase Admin один раз (Vercel може переюзати контейнер)
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Vercel зберігає \n як буквальний рядок — розгортаємо назад
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

module.exports = async function handler(req, res) {
  // --- CORS ---
  // Дозволяємо запити з GitHub Pages і localhost для розробки
  const allowedOrigins = [
    'https://deracodovich.github.io',
    'http://localhost:3000',
    'http://127.0.0.1:5500', // Live Server у VS Code
  ];
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- Верифікація Firebase ID токену ---
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  const idToken = authHeader.slice(7); // відрізаємо "Bearer "
  let decodedToken;
  try {
    decodedToken = await getAuth().verifyIdToken(idToken);
  } catch (err) {
    console.error('Token verification failed:', err.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // decodedToken.uid доступний тут — можна логувати або rate-limit по uid
  const uid = decodedToken.uid;
  console.log(`Request from uid: ${uid}`);

  // --- Валідація тіла запиту ---
  const { messages, system, model, max_tokens } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  // Захист: обмежуємо max_tokens щоб не спалити бюджет
  const safeMaxTokens = Math.min(max_tokens || 1000, 2000);
  const safeModel = model || 'claude-sonnet-4-20250514';

  // --- Проксі до Anthropic API ---
  let anthropicResponse;
  try {
    anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: safeModel,
        max_tokens: safeMaxTokens,
        ...(system && { system }),
        messages,
      }),
    });
  } catch (err) {
    console.error('Anthropic fetch error:', err.message);
    return res.status(502).json({ error: 'Failed to reach Claude API' });
  }

  const data = await anthropicResponse.json();

  // Якщо Anthropic повернув помилку — пробрасуємо її зі статусом
  if (!anthropicResponse.ok) {
    console.error('Anthropic error:', data);
    return res.status(anthropicResponse.status).json(data);
  }

  return res.status(200).json(data);
};
