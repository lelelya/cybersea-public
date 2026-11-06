require('dotenv').config();
const port = process.env.PORT || 3000;
const headers = {};
if (process.env.CYBERSEA_AUTH_USER && process.env.CYBERSEA_AUTH_PASSWORD) {
  headers.authorization = 'Basic ' + Buffer.from(`${process.env.CYBERSEA_AUTH_USER}:${process.env.CYBERSEA_AUTH_PASSWORD}`).toString('base64');
}
async function main() {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { headers, signal: AbortSignal.timeout(2000) });
      if (response.ok && (await response.json()).status === 'ok') return console.log('CyberSea health check passed');
    } catch { /* service may still be starting */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('CyberSea health check failed');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
