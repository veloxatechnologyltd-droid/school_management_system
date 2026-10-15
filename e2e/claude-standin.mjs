// A stand-in for the Claude Messages API for the browser tests: it answers a batch of questions with plain sums that have correct answers
// (numbers differ on every call so batches never repeat), and one deliberately wrong sum so the screens show a question being left out
// (set STANDIN_CLEAN=1 for a demo walkthrough where every batch is complete). It answers a lesson request with a lesson that names the
// topic it was given. It is started by playwright.config.ts and used only through ANTHROPIC_BASE_URL.
import http from 'node:http';
let calls = 0;
http.createServer((req, res) => {
  if (req.method === 'GET') { res.writeHead(200); return res.end('ok'); }
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    const reply = (text, output) => { res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg_e2e', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(text) }], usage: { input_tokens: 1500, output_tokens: output } })); };
    if (/short lesson/i.test(body.system ?? '')) {
      const topic = JSON.parse(/<indicator>\n([\s\S]*?)\n<\/indicator>/.exec(body.messages?.[0]?.content ?? '')?.[1] ?? '{}').indicator ?? 'this topic';
      return reply({ lesson: { goal: `You will learn this: ${topic}.`, steps: [
        { heading: 'Start with the idea', text: `Think about "${topic}" in your own life, for example when you share food at home or count money at the market.` },
        { heading: 'Try a small case', text: 'Take two small numbers or words and work through one step at a time. Say each step out loud.' },
        { heading: 'Check your work', text: 'Read your answer again and ask yourself if it makes sense. Fix it if it does not.' }],
        example: { problem: 'What is 2 + 3?', working: '2 plus 3 is 5.' }, recap: [`You can practise "${topic}" a little every day.`, 'Check each step before you move on.'] } }, 700);
    }
    const count = Number(/exactly (\d+) questions/.exec(body.system ?? '')?.[1] ?? 5);
    const base = 100 + (calls++) * 53;
    const questions = Array.from({ length: count }, (_, i) => {
      const a = base + i * 7, b = 3 + i, sum = a + b;
      const wrong = i === 1 && !process.env.STANDIN_CLEAN;
      return { type: 'choice', q: `What is ${a} + ${b}?`, options: [String(wrong ? sum + 1 : sum), String(sum + 10), String(sum - 1)], answer: String(wrong ? sum + 1 : sum), why: `${a} plus ${b} is ${sum}.` };
    });
    reply({ questions }, 400 + count * 100);
  });
}).listen(4466, '127.0.0.1');
