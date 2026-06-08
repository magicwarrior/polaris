// netlify/functions/ai-proxy.js
// Proxies Anthropic API calls so the key never touches the browser.
// Handles: news decoder + RTI drafter

exports.handler = async function(event) {
  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { type, payload } = body;

  // ── Route to correct prompt ──────────────────────────────────
  let prompt;

  if (type === 'decode_news') {
    // payload: { headline, source }
    prompt = `Analyse this Indian news article for a civic literacy app.
Article: "${payload.headline}"
Source: ${payload.source}

Return a JSON object with these exact fields:
- verdict: string (2-3 sentences: what the story got right and what it missed)
- bias: number 0-100 (0=far left, 50=centre, 100=far right)
- biasLabel: string (e.g. "Centre-Left")
- flags: array of objects, each with { type: "red"|"gold"|"blue"|"green", label: string (short, e.g. "🚩 Propaganda signal") }
- missing: string (2-3 sentences: what this story leaves out)
- benefit: string (1-2 sentences: who benefits from this framing)
- action: string (1 sentence: what a citizen can do)

Return ONLY the JSON object. No markdown, no explanation, no backticks.`;

  } else if (type === 'draft_rti') {
    // payload: { problem, department, date }
    prompt = `You are an RTI expert for Tamil Nadu, India.
Draft a legally precise RTI application based on this problem:
"${payload.problem}"
Department: ${payload.department || 'relevant Tamil Nadu department'}
Date: ${payload.date || new Date().toLocaleDateString('en-IN')}
Location: Chennai, Tamil Nadu

Rules:
- Start with "To: The Public Information Officer"
- Name the correct department
- Ask 3-5 specific, factual questions (not vague)
- Cite relevant sections where applicable
- Note correct filing portal (rtionline.tn.gov.in for TN state, rtionline.gov.in for central)
- End with "Yours truly, [Your Name]"
- Under 280 words
- Plain English

Return ONLY the RTI application text. No explanation, no metadata.`;

  } else if (type === 'national_headlines') {
    const today = payload.date || new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
    prompt = `Today is ${today}. List 6 major current Indian national news headlines across politics, economy, judiciary, and social issues.

For each return a JSON object with:
- id: string (n1 to n6)
- headline: string
- source: string (e.g. "The Hindu")
- category: string (Politics|Economy|Judiciary|Social|Security|Environment)
- emoji: string (one relevant emoji)
- url: string (the news source's search URL for this topic)
- bias: number 0-100
- biasLabel: string
- summary: string (2 sentences, plain facts only)

Return a JSON array only. No markdown, no backticks, no preamble.`;

  } else if (type === 'trending_headlines') {
    const today = payload.date || new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
    prompt = `Today is ${today}. List 8 trending Indian news stories getting the most social media and newsroom attention — include controversies, viral stories, government decisions, court orders, protests.

For each return a JSON object with:
- id: string (t1 to t8)
- headline: string
- source: string
- emoji: string
- url: string (source search URL for this topic)
- trendScore: number 1-100
- trendReason: string (one line why it's trending)
- bias: number 0-100
- biasLabel: string

Return a JSON array only. No markdown, no backticks, no preamble.`;

  } else {
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown type: ' + type }) };
  }

  // ── Call Anthropic ───────────────────────────────────────────
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: data.error?.message || 'Anthropic API error' })
      };
    }

    const text = data.content?.[0]?.text || '';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ result: text })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Proxy error: ' + err.message })
    };
  }
};
