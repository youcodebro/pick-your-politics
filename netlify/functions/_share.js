const { supabaseRest } = require('./_supabase');

const PARTY_META = {
  D: { name: 'Democrat', color: '#185FA5' },
  R: { name: 'Republican', color: '#A32D2D' },
  L: { name: 'Libertarian', color: '#BA7517' },
  G: { name: 'Green', color: '#3B6D11' },
  I: { name: 'Independent', color: '#534AB7' },
  democrat: { name: 'Democrat', color: '#185FA5' },
  republican: { name: 'Republican', color: '#A32D2D' },
  libertarian: { name: 'Libertarian', color: '#BA7517' },
  green: { name: 'Green', color: '#3B6D11' },
  independent: { name: 'Independent', color: '#534AB7' }
};

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function appOrigin(event) {
  return process.env.URL || process.env.DEPLOY_PRIME_URL || event.headers.origin || '';
}

function publicShareUrl(event, token) {
  return `${appOrigin(event)}/.netlify/functions/share?token=${encodeURIComponent(token)}`;
}

function shareAppUrl(event, token) {
  return `${appOrigin(event)}/share.html?token=${encodeURIComponent(token)}`;
}

function ogImageUrl(event, token) {
  return `${appOrigin(event)}/.netlify/functions/og-image?token=${encodeURIComponent(token)}`;
}

function normalizeScores(scores = {}) {
  const normalized = {};
  Object.entries(scores || {}).forEach(([key, value]) => {
    const meta = PARTY_META[key];
    if (meta) normalized[meta.name] = Number(value) || 0;
  });
  return normalized;
}

function partyEntries(scores = {}) {
  const entries = Object.entries(normalizeScores(scores))
    .map(([name, value]) => ({ name, value: Math.max(0, Number(value) || 0) }))
    .sort((a, b) => b.value - a.value);
  const total = entries.reduce((sum, item) => sum + item.value, 0) || 1;
  return entries.map(item => ({ ...item, pct: Math.round(item.value / total * 100) }));
}

function topPartyLabel(scores = {}) {
  const top = partyEntries(scores)[0];
  return top?.pct ? `${top.name}-leaning mix` : 'Political profile';
}

function mixLabel(scores = {}) {
  return partyEntries(scores)
    .filter(item => item.pct > 0)
    .slice(0, 3)
    .map(item => `${item.name} ${item.pct}%`)
    .join(' · ') || 'Party mix loading';
}

function publicSharePayload(row, event) {
  return {
    token: row.token,
    url: publicShareUrl(event, row.token),
    app_url: shareAppUrl(event, row.token),
    og_image_url: row.og_image_url || ogImageUrl(event, row.token),
    scores_snapshot: row.scores_snapshot || {},
    party_entries: partyEntries(row.scores_snapshot || {}),
    top_party_label: topPartyLabel(row.scores_snapshot || {}),
    mix_label: mixLabel(row.scores_snapshot || {}),
    top_issues: row.top_issues || [],
    view_count: row.view_count || 0,
    created_at: row.created_at,
    expires_at: row.expires_at
  };
}

async function getShareByToken(token, event, { increment = false } = {}) {
  if (!token) return null;
  const rows = await supabaseRest(
    `share_links?token=eq.${encodeURIComponent(token)}&select=*`,
    { headers: { accept: 'application/json' } }
  );
  const row = rows?.[0];
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
  if (increment) {
    await supabaseRest(`share_links?id=eq.${row.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ view_count: (row.view_count || 0) + 1 })
    }).catch(() => null);
  }
  return publicSharePayload(row, event);
}

module.exports = {
  PARTY_META,
  appOrigin,
  escapeHtml,
  getShareByToken,
  mixLabel,
  ogImageUrl,
  partyEntries,
  publicSharePayload,
  publicShareUrl,
  shareAppUrl,
  topPartyLabel
};
