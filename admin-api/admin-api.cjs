// NOVA admin API — user management for the Settings panel.
// Runs server-side on the VPS only. Every route requires a valid Supabase
// access token whose email equals ADMIN_EMAIL. DB + Gmail creds live in this
// process's env, never in the browser bundle.
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
let nodemailer = null;
try { nodemailer = require("nodemailer"); } catch (_) {}

// Load .env ourselves so values with spaces (Gmail app password) survive.
try {
  const p = path.join(__dirname, ".env");
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  }
} catch (_) {}

const {
  PORT = 8055,
  PGHOST, PGUSER = "postgres", PGDATABASE = "postgres", PGPASSWORD,
  SUPABASE_URL, SUPABASE_ANON, ADMIN_EMAIL,
  GMAIL_USER, GMAIL_APP_PASS, APP_URL = "https://nassphx.com",
} = process.env;

const pool = new Pool({
  host: PGHOST, user: PGUSER, database: PGDATABASE, password: PGPASSWORD,
  port: 5432, ssl: { rejectUnauthorized: false }, max: 4,
});

const mailer = nodemailer && GMAIL_USER && GMAIL_APP_PASS
  ? nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASS.replace(/\s+/g, "") },
    })
  : null;

const app = express();
app.use(express.json());

// Same-origin (nassphx.com/admin-api) so no CORS needed, but be permissive to our app.
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && /^https:\/\/(www\.)?nassphx\.com$/.test(o)) {
    res.setHeader("Access-Control-Allow-Origin", o);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ---- admin gate: verify the Supabase token → must be the admin email ----
async function requireAdmin(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return res.status(401).json({ error: "No token" });
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return res.status(401).json({ error: "Invalid session" });
    const u = await r.json();
    if ((u.email || "").toLowerCase() !== (ADMIN_EMAIL || "").toLowerCase()) {
      return res.status(403).json({ error: "Admin only" });
    }
    req.adminEmail = u.email;
    next();
  } catch (e) {
    res.status(500).json({ error: "Auth check failed" });
  }
}

app.get("/health", (_req, res) => res.json({ ok: true }));

// ---- OTP: create/edit/delete require a code emailed to the TARGET user's
// address (the email in the form / the user being edited), proving that inbox
// is reachable before the account changes. Keyed by that target email. ----
const otpStore = new Map(); // targetEmail -> { code, expires }

app.post("/otp/request", requireAdmin, async (req, res) => {
  if (!mailer) return res.status(500).json({ error: "Email is not configured on the server" });
  const to = String(req.body?.email || "").trim().toLowerCase();
  if (!to || !/^\S+@\S+\.\S+$/.test(to)) return res.status(400).json({ error: "Valid target email required" });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  otpStore.set(to, { code, expires: Date.now() + 5 * 60 * 1000 });
  try {
    await mailer.sendMail({
      from: `NOVA Terminal <${GMAIL_USER}>`,
      to,
      subject: `NOVA verification code: ${code}`,
      text: `Your NOVA Terminal verification code is ${code}.\nIt expires in 5 minutes.\nAction: ${req.body?.action || "account setup"}.\nIf you didn't expect this, ignore this email.`,
    });
    res.json({ ok: true, sentTo: to });
  } catch (e) {
    res.status(500).json({ error: "Could not send the code: " + e.message });
  }
});

// One-time verify of the code that was emailed to `target`.
function verifyOtp(target, otp) {
  const key = String(target || "").toLowerCase();
  const rec = otpStore.get(key);
  const code = String(otp || "").trim();
  if (!rec || !code || rec.code !== code || Date.now() > rec.expires) return false;
  otpStore.delete(key); // single use
  return true;
}

// List users
app.get("/users", requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `select id, email, (email_confirmed_at is not null) as confirmed,
              created_at, last_sign_in_at
       from auth.users order by created_at asc`
    );
    res.json({ users: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Create user by inserting directly into GoTrue's tables (no Supabase signup →
// no Supabase confirmation email → no "email rate limit exceeded"). Our own
// Gmail credential email is separate and unaffected.
app.post("/users", requireAdmin, async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const sendEmail = !!req.body.sendEmail;
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: "Email + password (min 6 chars) required" });
  }
  // Verify the code that was emailed to the NEW user's own address.
  if (!verifyOtp(email, req.headers["x-otp"] || req.body.otp)) {
    return res.status(401).json({ error: `Invalid or expired code — request a fresh one sent to ${email}` });
  }
  const client = await pool.connect();
  try {
    const dup = await client.query(`select 1 from auth.users where email = $1`, [email]);
    if (dup.rowCount) return res.status(409).json({ error: "A user with that email already exists" });

    const id = crypto.randomUUID();
    await client.query("begin");
    await client.query(
      `insert into auth.users
        (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
         created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous)
       values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         $2::text, extensions.crypt($3::text, extensions.gen_salt('bf', 10)), now(),
         now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, false)`,
      [id, email, password]
    );
    // token columns: match what signup produces ('' not NULL) — best effort
    await client.query(
      `update auth.users set confirmation_token='', recovery_token='',
        email_change_token_new='', email_change='' where id=$1`, [id]
    ).catch(() => {});
    await client.query(
      `insert into auth.identities
        (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       values (gen_random_uuid(), $1::text, $2::uuid,
         jsonb_build_object('sub', $1::text, 'email', $3::text, 'email_verified', true, 'phone_verified', false),
         'email', now(), now(), now())`,
      [id, id, email]
    );
    await client.query("commit");
    let emailed = false;
    if (sendEmail && mailer) {
      await mailer.sendMail({
        from: `NOVA Terminal <${GMAIL_USER}>`,
        to: email,
        subject: "Your NOVA Terminal login",
        text: `Welcome to NOVA Terminal.\n\nLogin: ${APP_URL}\nEmail: ${email}\nPassword: ${password}\n\nPlease change your password after first login. Trading involves risk.`,
      }).then(() => { emailed = true; }).catch(() => {});
    }
    res.json({ ok: true, email, emailed });
  } catch (e) {
    await client.query("rollback").catch(() => {});
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Update email and/or password
app.patch("/users/:id", requireAdmin, async (req, res) => {
  const id = String(req.params.id);
  const newEmail = req.body.email ? String(req.body.email).trim().toLowerCase() : null;
  const newPass = req.body.password ? String(req.body.password) : null;
  if (!newEmail && !newPass) return res.status(400).json({ error: "Nothing to update" });
  if (newPass && newPass.length < 6) return res.status(400).json({ error: "Password too short" });
  try {
    // Code was emailed to this user's CURRENT address — look it up and verify.
    const cur = await pool.query(`select email from auth.users where id = $1`, [id]);
    if (!cur.rowCount) return res.status(404).json({ error: "User not found" });
    if (!verifyOtp(cur.rows[0].email, req.headers["x-otp"] || req.body.otp)) {
      return res.status(401).json({ error: `Invalid or expired code — request a fresh one sent to ${cur.rows[0].email}` });
    }
    if (newPass) {
      await pool.query(
        `update auth.users set encrypted_password = extensions.crypt($1, extensions.gen_salt('bf', 10)),
          updated_at = now() where id = $2`, [newPass, id]
      );
    }
    if (newEmail) {
      await pool.query(
        `update auth.users set email = $1, updated_at = now() where id = $2`, [newEmail, id]
      );
      // keep the email identity in sync (best-effort across schema versions)
      await pool.query(
        `update auth.identities
         set identity_data = jsonb_set(coalesce(identity_data,'{}'::jsonb), '{email}', to_jsonb($1::text))
         where user_id = $2 and provider = 'email'`, [newEmail, id]
      ).catch(() => {});
      await pool.query(
        `update auth.identities set provider_id = $1 where user_id = $2 and provider = 'email'`, [newEmail, id]
      ).catch(() => {});
      await pool.query(`update public.profiles set email = $1 where id = $2`, [newEmail, id]).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete user
app.delete("/users/:id", requireAdmin, async (req, res) => {
  try {
    // Code was emailed to this user's own address — verify before deleting.
    const cur = await pool.query(`select email from auth.users where id = $1`, [req.params.id]);
    if (!cur.rowCount) return res.status(404).json({ error: "User not found" });
    if (!verifyOtp(cur.rows[0].email, req.headers["x-otp"] || req.body.otp)) {
      return res.status(401).json({ error: `Invalid or expired code — request a fresh one sent to ${cur.rows[0].email}` });
    }
    await pool.query(`delete from auth.users where id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, "127.0.0.1", () => console.log(`admin-api on 127.0.0.1:${PORT}`));
