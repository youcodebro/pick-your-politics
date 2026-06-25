const { getShareByToken } = require('./_share');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method not allowed' };
  const token = event.queryStringParameters?.token || '';
  const share = await getShareByToken(token, event, { increment: true });
  if (!share) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Share link not found.' }) };
  }
  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=60'
    },
    body: JSON.stringify(share)
  };
};
