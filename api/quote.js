/* Jaymo Civil quote form: sends the request to the Jaymo Civil inbox via Resend,
   then sends the customer a short confirmation if they left an email.
   Needs RESEND_API_KEY set in the Vercel project. */

const TO = process.env.QUOTE_TO || 'info@jaymocivil.com.au';
const FROM = process.env.QUOTE_FROM || 'Jaymo Civil Website <website@jaymocivil.com.au>';
const FROM_CUSTOMER = process.env.QUOTE_FROM_CUSTOMER || 'Jaymo Civil <website@jaymocivil.com.au>';
const PHONE = '0450 503 180';
const SERVICES = ['Bulk excavation', 'Detail excavation', 'Shoring', 'Service trenches', 'Remediation works', 'Not sure yet'];

/* best effort limit per warm instance: 5 requests per IP per 10 minutes */
const hits = new Map();
function limited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000;
  const list = (hits.get(ip) || []).filter(t => now - t < win);
  list.push(now);
  hits.set(ip, list);
  return list.length > 5;
}

const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isEmail = s => /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]{2,}$/.test(s);

function row(label, value) {
  return `<tr><td style="padding:10px 14px;border-bottom:1px solid #eee;font:600 12px Arial,sans-serif;color:#777;text-transform:uppercase;letter-spacing:.08em;width:150px;vertical-align:top">${label}</td><td style="padding:10px 14px;border-bottom:1px solid #eee;font:15px/1.5 Arial,sans-serif;color:#111;white-space:pre-wrap">${value}</td></tr>`;
}

function shell(inner) {
  return `<!doctype html><html><body style="margin:0;background:#f4f3f0;padding:24px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;background:#fff;border-collapse:collapse"><tr><td style="background:#0b0b0a;padding:18px 22px;border-bottom:4px solid #ffd60a;font:800 18px Arial,sans-serif;letter-spacing:.12em;color:#ffd60a;text-transform:uppercase">Jaymo Civil</td></tr><tr><td style="padding:24px 22px">${inner}</td></tr></table></body></html>`;
}

async function send(key, payload) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Resend ${r.status}: ${t.slice(0, 300)}`);
  }
  return r.json();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: 'false', error: 'Method not allowed' });
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error('RESEND_API_KEY is not set');
    return res.status(500).json({ success: 'false', error: 'Not configured' });
  }

  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }

  /* bots fill the hidden field: pretend it worked, send nothing */
  if (clean(b._honey, 200)) return res.status(200).json({ success: 'true' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return res.status(429).json({ success: 'false', error: 'Too many requests' });

  const name = clean(b.name, 120);
  const phone = clean(b.phone, 40);
  const email = clean(b.email, 160).toLowerCase();
  const suburb = clean(b.suburb, 120);
  const job = SERVICES.includes(clean(b.job, 60)) ? clean(b.job, 60) : 'Not sure yet';
  const msg = clean(b.msg, 4000);

  if (!name || !phone || !/\d{6,}/.test(phone.replace(/\D/g, ''))) {
    return res.status(400).json({ success: 'false', error: 'Name and mobile are required' });
  }
  const goodEmail = email && isEmail(email);

  const subject = `Quote request: ${job}${suburb ? ', ' + suburb : ''} (${name})`;
  const telHref = phone.replace(/[^\d+]/g, '');

  const teamHtml = shell(
    `<p style="margin:0 0 6px;font:600 12px Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#777">New quote request from the website</p>` +
    `<h1 style="margin:0 0 18px;font:800 22px Arial,sans-serif;color:#111">${esc(job)}${suburb ? ' in ' + esc(suburb) : ''}</h1>` +
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border-top:1px solid #eee">` +
    row('Name', esc(name)) +
    row('Mobile', `<a href="tel:${esc(telHref)}" style="color:#111">${esc(phone)}</a>`) +
    row('Email', goodEmail ? `<a href="mailto:${esc(email)}" style="color:#111">${esc(email)}</a>` : 'Not given') +
    row('Site suburb', suburb ? esc(suburb) : 'Not given') +
    row('Service', esc(job)) +
    row('Project details', msg ? esc(msg) : 'Not given') +
    `</table>` +
    `<p style="margin:22px 0 0"><a href="tel:${esc(telHref)}" style="display:inline-block;background:#ffd60a;color:#0b0b0a;font:700 14px Arial,sans-serif;text-decoration:none;padding:12px 20px;letter-spacing:.06em;text-transform:uppercase">Call ${esc(name.split(/\s+/)[0])}</a></p>` +
    (goodEmail ? `<p style="margin:14px 0 0;font:13px Arial,sans-serif;color:#777">Hit reply to answer ${esc(name.split(/\s+/)[0])} by email.</p>` : '')
  );
  const teamText =
    `New quote request from the website\n\nName: ${name}\nMobile: ${phone}\nEmail: ${goodEmail ? email : 'Not given'}\n` +
    `Site suburb: ${suburb || 'Not given'}\nService: ${job}\nProject details: ${msg || 'Not given'}\n`;

  try {
    await send(key, {
      from: FROM,
      to: [TO],
      subject,
      html: teamHtml,
      text: teamText,
      ...(goodEmail ? { reply_to: email } : {})
    });
  } catch (err) {
    console.error('Team email failed', err.message);
    return res.status(502).json({ success: 'false', error: 'Send failed' });
  }

  /* customer copy: a failure here never blocks the request */
  if (goodEmail) {
    const first = esc(name.split(/\s+/)[0]);
    const custHtml = shell(
      `<h1 style="margin:0 0 14px;font:800 22px Arial,sans-serif;color:#111">Thanks ${first}, we have your request.</h1>` +
      `<p style="margin:0 0 14px;font:15px/1.6 Arial,sans-serif;color:#333">Your ${esc(job.toLowerCase())} request${suburb ? ' for ' + esc(suburb) : ''} is with our team now. We will give you a call on <b>${esc(phone)}</b> to go over the scope and ask for your plans, then send you a clear written quote.</p>` +
      `<p style="margin:0 0 20px;font:15px/1.6 Arial,sans-serif;color:#333">Need us sooner? Give us a call any time.</p>` +
      `<p style="margin:0 0 24px"><a href="tel:0450503180" style="display:inline-block;background:#ffd60a;color:#0b0b0a;font:700 14px Arial,sans-serif;text-decoration:none;padding:12px 20px;letter-spacing:.06em;text-transform:uppercase">Call ${PHONE}</a></p>` +
      `<p style="margin:0;font:13px/1.6 Arial,sans-serif;color:#777">Jaymo Civil Pty Ltd. Excavation and civil contractors, Sydney NSW.<br>${PHONE} &middot; <a href="mailto:${TO}" style="color:#777">${TO}</a></p>`
    );
    const custText =
      `Thanks ${name.split(/\s+/)[0]}, we have your request.\n\n` +
      `Your ${job.toLowerCase()} request${suburb ? ' for ' + suburb : ''} is with our team now. We will call you on ${phone} to go over the scope and ask for your plans, then send you a clear written quote.\n\n` +
      `Need us sooner? Call ${PHONE}.\n\nJaymo Civil Pty Ltd\n${TO}\n`;
    try {
      await send(key, {
        from: FROM_CUSTOMER,
        to: [email],
        reply_to: TO,
        subject: 'We have your quote request | Jaymo Civil',
        html: custHtml,
        text: custText
      });
    } catch (err) {
      console.error('Customer email failed', err.message);
    }
  }

  return res.status(200).json({ success: 'true' });
};
