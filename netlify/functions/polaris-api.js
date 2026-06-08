// polaris-api.js
// ─────────────────────────────────────────────────────────────
// Drop this file in the same folder as polaris.html
// Add this to polaris.html just before </body>:
//   <script src="polaris-api.js"></script>
//
// Then set your two config values below.
// ─────────────────────────────────────────────────────────────

// ── CONFIG (fill these in after setup) ───────────────────────
var SUPABASE_URL  = 'https://xhettykfwzfbrqinpjyr.supabase.co/rest/v1/';  // from Supabase dashboard → Settings → API
var SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhoZXR0eWtmd3pmYnJxaW5wanlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MzExODAsImV4cCI6MjA5NjUwNzE4MH0.tFdALC1QWFHXbh8MB4NrybVGYA43gbqTY-SiAWuejRk';                 // from Supabase dashboard → Settings → API
var AI_PROXY_URL  = '/.netlify/functions/ai-proxy';         // works on Netlify automatically

// ─────────────────────────────────────────────────────────────
// SUPABASE HELPER
// ─────────────────────────────────────────────────────────────
function sbFetch(path, method, body) {
  return fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method: method || 'GET',
    headers: {
      'apikey':        SUPABASE_ANON,
      'Authorization': 'Bearer ' + SUPABASE_ANON,
      'Content-Type':  'application/json',
      'Prefer':        method === 'POST' ? 'return=representation' : ''
    },
    body: body ? JSON.stringify(body) : undefined
  }).then(function(r) { return r.json(); });
}

// ─────────────────────────────────────────────────────────────
// ISSUES
// ─────────────────────────────────────────────────────────────

// Load all issues for the trending feed (ordered by upvotes)
async function loadTrendingIssues() {
  try {
    var data = await sbFetch('issues?order=upvote_count.desc&limit=20&select=*');
    return Array.isArray(data) ? data : [];
  } catch(e) { console.error('loadTrendingIssues:', e); return []; }
}

// Load issues filed by a specific phone number
async function loadMyIssues(phone) {
  if (!phone) return [];
  try {
    var encoded = encodeURIComponent(phone);
    // Join through users table
    var data = await sbFetch('issues?select=*,users!inner(phone)&users.phone=eq.' + encoded + '&order=created_at.desc');
    return Array.isArray(data) ? data : [];
  } catch(e) { console.error('loadMyIssues:', e); return []; }
}

// File a new issue — registers user first if needed
async function fileIssue(form) {
  // form: { name, phone, email, city, area, ward, location, issue_type, description }
  try {
    // 1. Upsert user (insert if new phone, ignore if exists)
    await sbFetch('users?on_conflict=phone', 'POST', {
      name: form.name, phone: form.phone, email: form.email || null
    });

    // 2. Get user id
    var users = await sbFetch('users?phone=eq.' + encodeURIComponent(form.phone) + '&select=id');
    var userId = users?.[0]?.id || null;

    // 3. Generate ref
    var ref = 'POL/' + new Date().getFullYear() + '/' + Math.floor(Math.random() * 90000 + 10000);

    // 4. Insert issue
    var issues = await sbFetch('issues', 'POST', {
      ref:         ref,
      user_id:     userId,
      user_name:   form.name,
      city:        form.city,
      area:        form.area,
      ward:        form.ward || null,
      location:    form.location || null,
      issue_type:  form.issue_type,
      description: form.description,
      status:      'Filed'
    });

    return { success: true, ref: ref, issue: issues?.[0] };
  } catch(e) {
    console.error('fileIssue:', e);
    return { success: false, error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────
// UPVOTES
// ─────────────────────────────────────────────────────────────

async function upvoteIssue(issueId, userPhone) {
  try {
    await sbFetch('upvotes', 'POST', { issue_id: issueId, user_phone: userPhone });
    // Counter incremented by DB trigger
    return { success: true };
  } catch(e) {
    // Unique constraint = already upvoted
    return { success: false, alreadyVoted: true };
  }
}

async function hasUpvoted(issueId, userPhone) {
  try {
    var data = await sbFetch(
      'upvotes?issue_id=eq.' + issueId + '&user_phone=eq.' + encodeURIComponent(userPhone) + '&select=id'
    );
    return Array.isArray(data) && data.length > 0;
  } catch(e) { return false; }
}

// ─────────────────────────────────────────────────────────────
// COMMENTS
// ─────────────────────────────────────────────────────────────

async function loadComments(issueId) {
  try {
    var data = await sbFetch('comments?issue_id=eq.' + issueId + '&order=likes.desc,created_at.desc&select=*');
    return Array.isArray(data) ? data : [];
  } catch(e) { console.error('loadComments:', e); return []; }
}

async function postComment(issueId, userName, userPhone, body) {
  try {
    var data = await sbFetch('comments', 'POST', {
      issue_id:   issueId,
      user_name:  userName,
      user_phone: userPhone || null,
      body:       body
    });
    return { success: true, comment: data?.[0] };
  } catch(e) { return { success: false, error: e.message }; }
}

async function likeCommentDB(commentId) {
  // Increment via RPC — simpler than a trigger for this case
  try {
    await sbFetch('rpc/increment_comment_like', 'POST', { comment_id: commentId });
    return { success: true };
  } catch(e) { return { success: false }; }
}

// ─────────────────────────────────────────────────────────────
// AI PROXY CALLS
// ─────────────────────────────────────────────────────────────

async function aiCall(type, payload) {
  var res = await fetch(AI_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: type, payload: payload })
  });
  var data = await res.json();
  if (!res.ok) throw new Error(data.error || 'AI proxy error');
  return data.result; // raw text from Claude
}

async function decodeNewsViaProxy(headline, source) {
  var raw = await aiCall('decode_news', { headline, source });
  return JSON.parse(raw.replace(/```json|```/g, '').trim());
}

async function draftRTIViaProxy(problem, department) {
  var today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  return aiCall('draft_rti', { problem, department, date: today });
  // returns plain text RTI draft
}

async function loadNationalHeadlinesViaProxy() {
  var today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  var raw = await aiCall('national_headlines', { date: today });
  return JSON.parse(raw.replace(/```json|```/g, '').trim());
}

async function loadTrendingHeadlinesViaProxy() {
  var today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  var raw = await aiCall('trending_headlines', { date: today });
  return JSON.parse(raw.replace(/```json|```/g, '').trim());
}

// ─────────────────────────────────────────────────────────────
// SESSION (lightweight — phone stored in sessionStorage)
// ─────────────────────────────────────────────────────────────
var currentUser = (function() {
  try {
    var s = sessionStorage.getItem('polaris_user');
    return s ? JSON.parse(s) : null;
  } catch(e) { return null; }
})();

function saveUser(name, phone, email) {
  currentUser = { name, phone, email };
  try { sessionStorage.setItem('polaris_user', JSON.stringify(currentUser)); } catch(e) {}
}

function getUser() { return currentUser; }

console.log('[POLARIS API] loaded. User:', currentUser ? currentUser.name : 'none');
