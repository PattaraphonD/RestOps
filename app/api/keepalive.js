// Vercel Cron job: once a day, ask the shop's Supabase server to run a tiny database query, so a
// free Supabase project never counts as idle and pauses. Scheduled in app/vercel.json ("crons").
// Results show in Vercel → your project → Logs (filter: /api/keepalive).
const SERVER = process.env.SUPABASE_API_URL || 'https://ozjxwtczzyljibujvfek.supabase.co/functions/v1/api';

module.exports = async function keepalive(req, res) {
  const started = Date.now();
  try {
    const r = await fetch(SERVER + '?check=db', { headers: { 'User-Agent': 'restaurant-ops-keepalive' } });
    const body = await r.json().catch(() => null);
    const ok = r.ok && body && body.ok && body.data && body.data.databaseOk === true;
    const out = { ok: !!ok, status: r.status, ms: Date.now() - started, version: body && body.data ? body.data.version : null };
    console.log('keepalive', JSON.stringify(out));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(ok ? 200 : 502).json(out);
  } catch (e) {
    console.error('keepalive failed', e && e.message);
    return res.status(502).json({ ok: false, error: String(e && e.message) });
  }
};
