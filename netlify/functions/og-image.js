const { escapeHtml, getShareByToken, partyEntries } = require('./_share');

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  let name = q.name || 'PYP Profile';
  let top = q.top || 'Political Profile';
  let mix = q.mix || 'Democrat 38% · Republican 24% · Libertarian 22%';
  let entries = [
    { name: 'Democrat', pct: 38 },
    { name: 'Republican', pct: 24 },
    { name: 'Libertarian', pct: 22 },
    { name: 'Green', pct: 11 },
    { name: 'Independent', pct: 5 }
  ];

  if (q.token) {
    const share = await getShareByToken(q.token, event).catch(() => null);
    if (share) {
      name = 'PYP Political Profile';
      top = share.top_party_label;
      mix = share.mix_label;
      entries = partyEntries(share.scores_snapshot);
    }
  }

  const colors = {
    Democrat: '#185FA5',
    Republican: '#A32D2D',
    Libertarian: '#BA7517',
    Green: '#3B6D11',
    Independent: '#534AB7'
  };

  let x = 104;
  const bars = entries.filter(item => item.pct > 0).slice(0, 5).map((item, index, arr) => {
    const width = Math.max(10, Math.round(item.pct / 100 * 780));
    const rx = arr.length === 1 || index === 0 ? ' rx="14"' : '';
    const rect = `<rect x="${x}" y="386" width="${width}" height="28"${rx} fill="${colors[item.name] || '#534AB7'}"/>`;
    x += width;
    return rect;
  }).join('\n  ');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#0d0d0f"/>
  <rect x="64" y="64" width="1072" height="502" rx="34" fill="#15151d" stroke="#2b2b38" stroke-width="2"/>
  <circle cx="980" cy="158" r="74" fill="#185FA5" opacity=".25"/>
  <circle cx="1036" cy="214" r="74" fill="#A32D2D" opacity=".22"/>
  <text x="104" y="138" fill="#85B7EB" font-family="Arial, sans-serif" font-size="28" font-weight="700">PYP - Pick Your Politics</text>
  <text x="104" y="250" fill="#fff" font-family="Arial, sans-serif" font-size="72" font-weight="800">${escapeHtml(name)}</text>
  <text x="104" y="324" fill="#d7d7df" font-family="Arial, sans-serif" font-size="38" font-weight="600">${escapeHtml(top)}</text>
  <rect x="104" y="386" width="780" height="28" rx="14" fill="#262633"/>
  ${bars}
  <text x="104" y="474" fill="#b7b7c2" font-family="Arial, sans-serif" font-size="32">${escapeHtml(mix)}</text>
  <text x="104" y="526" fill="#6f7280" font-family="Arial, sans-serif" font-size="24">See how your views compare.</text>
</svg>`;

  return {
    statusCode: 200,
    headers: {
      'content-type': 'image/svg+xml',
      'cache-control': 'public, max-age=300'
    },
    body: svg
  };
};
