const { escapeHtml, getShareByToken } = require('./_share');

exports.handler = async (event) => {
  const token = event.queryStringParameters?.token || '';
  const share = await getShareByToken(token, event);
  if (!share) {
    return {
      statusCode: 404,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: '<!doctype html><title>PYP share not found</title><p>This PYP share link is unavailable.</p>'
    };
  }

  const title = `PYP Political Profile - ${share.top_party_label}`;
  const description = `${share.mix_label}. See how your views compare.`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}"/>
<meta property="og:type" content="website"/>
<meta property="og:title" content="${escapeHtml(title)}"/>
<meta property="og:description" content="${escapeHtml(description)}"/>
<meta property="og:image" content="${escapeHtml(share.og_image_url)}"/>
<meta property="og:url" content="${escapeHtml(share.url)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${escapeHtml(title)}"/>
<meta name="twitter:description" content="${escapeHtml(description)}"/>
<meta name="twitter:image" content="${escapeHtml(share.og_image_url)}"/>
<meta http-equiv="refresh" content="0;url=${escapeHtml(share.app_url)}"/>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#0d0d0f;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}a{color:#85B7EB}</style>
</head>
<body>
<main>
  <h1>${escapeHtml(share.top_party_label)}</h1>
  <p>${escapeHtml(description)}</p>
  <p><a href="${escapeHtml(share.app_url)}">Open PYP profile</a></p>
</main>
<script>location.replace(${JSON.stringify(share.app_url)});</script>
</body>
</html>`;

  return {
    statusCode: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300'
    },
    body: html
  };
};
