// A stand-in for the Claude Messages API for the browser tests: it answers the content library's batch prompt with plain sums that
// have correct answers (numbers differ on every call so batches never repeat), and one deliberately wrong sum so the drafting screen
// shows a question being left out. It is started by playwright.config.ts and used only through ANTHROPIC_BASE_URL.
import http from 'node:http';
let calls = 0;
http.createServer((req, res) => {
  if (req.method === 'GET') { res.writeHead(200); return res.end('ok'); }
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    const count = Number(/exactly (\d+) questions/.exec(body.system ?? '')?.[1] ?? 5);
    const base = 100 + (calls++) * 53;
    const questions = Array.from({ length: count }, (_, i) => {
      const a = base + i * 7, b = 3 + i, sum = a + b;
      return { type: 'choice', q: `What is ${a} + ${b}?`, options: [String(i === 1 ? sum + 1 : sum), String(sum + 10), String(sum - 1)], answer: String(i === 1 ? sum + 1 : sum), why: `${a} plus ${b} is ${sum}.` };
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'msg_e2e', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ questions }) }], usage: { input_tokens: 1500, output_tokens: 400 + count * 100 } }));
  });
}).listen(4466, '127.0.0.1');
