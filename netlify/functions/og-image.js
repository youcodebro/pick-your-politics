function esc(value) {
  return String(value || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const name = esc(q.name || 'PYP Profile');
  const top = esc(q.top || 'Political Profile');
  const mix = esc(q.mix || 'Democrat 38% · Republican 24% · Libertarian 22%');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#0d0d0f"/>
  <rect x="64" y="64" width="1072" height="502" rx="34" fill="#15151d" stroke="#2b2b38" stroke-width="2"/>
  <circle cx="980" cy="158" r="74" fill="#185FA5" opacity=".25"/>
  <circle cx="1036" cy="214" r="74" fill="#A32D2D" opacity=".22"/>
  <text x="104" y="138" fill="#85B7EB" font-family="Arial, sans-serif" font-size="28" font-weight="700">PYP · Pick Your Politics</text>
  <text x="104" y="250" fill="#fff" font-family="Arial, sans-serif" font-size="72" font-weight="800">${name}</text>
  <text x="104" y="324" fill="#d7d7df" font-family="Arial, sans-serif" font-size="38" font-weight="600">${top}</text>
  <rect x="104" y="386" width="780" height="28" rx="14" fill="#262633"/>
  <rect x="104" y="386" width="318" height="28" rx="14" fill="#185FA5"/>
  <rect x="422" y="386" width="202" height="28" fill="#A32D2D"/>
  <rect x="624" y="386" width="184" height="28" fill="#BA7517"/>
  <text x="104" y="474" fill="#b7b7c2" font-family="Arial, sans-serif" font-size="32">${mix}</text>
  <text x="104" y="526" fill="#6f7280" font-family="Arial, sans-serif" font-size="24">See how your views compare.</text>
</svg>`;

  return {
    statusCode: 200,
    headers: {
      'content-type': 'image/svg+xml',
      'cache-control': 'public, max-age=86400'
    },
    body: svg
  };
};
