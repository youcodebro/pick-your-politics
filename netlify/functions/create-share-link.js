const { getBearerUser, supabaseRest } = require('./_supabase');
const { ogImageUrl, publicShareUrl, shareAppUrl } = require('./_share');

function moduleBreakdown(responses = []) {
  const modules = new Map();
  responses.forEach(row => {
    const title = row.questions?.module_title || row.questions?.module_id || 'Questions';
    const deltas = row.score_delta || {};
    const total = Object.values(deltas).reduce((sum, value) => sum + Math.abs(Number(value) || 0), 0);
    const current = modules.get(title) || 0;
    modules.set(title, current + total);
  });
  return [...modules.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat, score]) => ({ cat, score: Math.round(Math.min(100, score)) }));
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const user = await getBearerUser(event);
    if (!user) return { statusCode: 401, body: JSON.stringify({ error: 'Sign in required.' }) };

    const input = JSON.parse(event.body || '{}');
    let session = null;
    if (input.session_id) {
      const rows = await supabaseRest(
        `sessions?id=eq.${encodeURIComponent(input.session_id)}&user_id=eq.${user.id}&select=*`,
        { headers: { accept: 'application/json' } }
      );
      session = rows?.[0] || null;
    } else {
      const rows = await supabaseRest(
        `sessions?user_id=eq.${user.id}&select=*&order=started_at.desc&limit=1`,
        { headers: { accept: 'application/json' } }
      );
      session = rows?.[0] || null;
    }
    if (!session) throw new Error('No saved session found to share.');

    const responses = await supabaseRest(
      `responses?session_id=eq.${session.id}&select=score_delta,questions(module_id,module_title)`,
      { headers: { accept: 'application/json' } }
    );
    const topIssues = moduleBreakdown(responses || []);

    const existing = await supabaseRest(
      `share_links?session_id=eq.${session.id}&user_id=eq.${user.id}&select=*&order=created_at.desc&limit=1`,
      { headers: { accept: 'application/json' } }
    );
    const existingActive = existing?.[0] && (!existing[0].expires_at || new Date(existing[0].expires_at).getTime() > Date.now())
      ? existing[0]
      : null;

    let row = existingActive;
    if (!row) {
      const inserted = await supabaseRest('share_links', {
        method: 'POST',
        headers: { prefer: 'return=representation' },
        body: JSON.stringify({
          user_id: user.id,
          session_id: session.id,
          scores_snapshot: session.scores || {},
          top_issues: topIssues,
          og_image_url: null
        })
      });
      row = inserted?.[0];
    } else {
      const updated = await supabaseRest(`share_links?id=eq.${row.id}`, {
        method: 'PATCH',
        headers: { prefer: 'return=representation' },
        body: JSON.stringify({
          scores_snapshot: session.scores || {},
          top_issues: topIssues
        })
      });
      row = updated?.[0] || row;
    }

    const og = ogImageUrl(event, row.token);
    await supabaseRest(`share_links?id=eq.${row.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ og_image_url: og })
    }).catch(() => null);

    return {
      statusCode: 200,
      body: JSON.stringify({
        token: row.token,
        url: publicShareUrl(event, row.token),
        app_url: shareAppUrl(event, row.token),
        og_image_url: og
      })
    };
  } catch (error) {
    return { statusCode: 400, body: JSON.stringify({ error: error.message }) };
  }
};
