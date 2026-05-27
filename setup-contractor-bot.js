/**
 * ContractorBot Setup Script
 * - Reads .env from the project folder
 * - Executes schema.sql on Supabase
 * - Adds WEBHOOK_URL to Render via API
 * Run: node setup-contractor-bot.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ── Paths ─────────────────────────────────────────────────────────────────────
const ENV_PATH    = 'C:\\Users\\Drewlemon\\.verdent\\verdent-projects\\new-project\\.env';
const SCHEMA_PATH = 'C:\\Users\\Drewlemon\\.verdent\\verdent-projects\\new-project\\schema.sql';

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseEnv(filePath) {
  const result = {};
  if (!fs.existsSync(filePath)) { console.error('❌ .env not found at', filePath); return result; }
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    result[key] = val;
  }
  return result;
}

function httpsPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const opts = {
      hostname: u.hostname, path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers }
    };
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpsRequest(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const opts = {
      hostname: u.hostname, path: u.pathname + u.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers
      }
    };
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n=== ContractorBot Setup ===\n');

  // 1. Read .env
  const env = parseEnv(ENV_PATH);
  console.log('📄 Loaded .env keys:', Object.keys(env).join(', ') || '(none)');

  const SUPABASE_URL          = env.SUPABASE_URL || '';
  const SUPABASE_SERVICE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY || env.SUPABASE_ANON_KEY || '';
  const RENDER_API_KEY        = env.RENDER_API_KEY || '';
  const RENDER_SERVICE_ID     = env.RENDER_SERVICE_ID || '';

  // ── TASK 1: Run schema.sql on Supabase ──────────────────────────────────────
  console.log('\n── Task 1: Run schema.sql on Supabase ──');

  const schemaPath = fs.existsSync(SCHEMA_PATH) ? SCHEMA_PATH
    : fs.existsSync('schema.sql') ? 'schema.sql' : null;

  if (!schemaPath) {
    console.error('❌ schema.sql not found');
  } else if (!SUPABASE_URL) {
    console.error('❌ SUPABASE_URL missing from .env');
  } else if (!SUPABASE_SERVICE_KEY) {
    console.error('❌ No Supabase key found in .env');
  } else {
    const sql = fs.readFileSync(schemaPath, 'utf8');
    // Extract project ref from URL: https://xxxxx.supabase.co → xxxxx
    const projectRef = SUPABASE_URL.replace('https://', '').split('.')[0];
    console.log(`   Project ref: ${projectRef}`);
    console.log(`   Key type:    ${SUPABASE_SERVICE_KEY.startsWith('eyJ') ? 'JWT' : 'other'}`);

    // Try Supabase Management API (requires personal access token OR service role)
    // The "pg" approach via REST: POST to /rest/v1/rpc with service role
    // Actually try direct SQL via management API
    try {
      const mgmtUrl = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
      // This requires a personal access token, not service role key
      // Try with service role key anyway
      const result = await httpsPost(
        mgmtUrl,
        { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, apikey: SUPABASE_SERVICE_KEY },
        { query: sql }
      );
      if (result.status === 200 || result.status === 201) {
        console.log('✅ SQL executed via Management API');
        console.log('   Response:', JSON.stringify(result.body).slice(0, 200));
      } else {
        console.log(`   Management API returned ${result.status} — trying Edge Functions approach...`);

        // Try via pg (direct) — needs DATABASE_URL or DIRECT_URL
        const dbUrl = env.DATABASE_URL || env.DIRECT_URL || env.POSTGRES_URL || '';
        if (dbUrl) {
          console.log('   Found DATABASE_URL — attempting direct pg connection...');
          try {
            const { Client } = require('pg');
            const client = new Client({ connectionString: dbUrl });
            await client.connect();
            await client.query(sql);
            await client.end();
            console.log('✅ SQL executed via direct pg connection');
          } catch (pgErr) {
            console.error('❌ pg connection failed:', pgErr.message);
            printManualSupabaseInstructions(sql);
          }
        } else {
          console.log('   No DATABASE_URL found.');
          console.log('   Management API response:', JSON.stringify(result.body).slice(0, 300));
          printManualSupabaseInstructions(sql);
        }
      }
    } catch (err) {
      console.error('❌ Supabase request failed:', err.message);
      printManualSupabaseInstructions(sql);
    }
  }

  // ── TASK 2: Add WEBHOOK_URL to Render ──────────────────────────────────────
  console.log('\n── Task 2: Add WEBHOOK_URL to Render ──');

  const WEBHOOK_URL_VALUE = 'https://contractor-bot-zhfa.onrender.com/webhook';
  console.log(`   WEBHOOK_URL value: ${WEBHOOK_URL_VALUE}`);

  if (!RENDER_API_KEY) {
    console.log('⚠️  No RENDER_API_KEY in .env');
    printManualRenderInstructions(WEBHOOK_URL_VALUE);
  } else {
    // List services to find contractor-bot
    try {
      const servicesRes = await httpsRequest('GET',
        'https://api.render.com/v1/services?limit=20',
        { Authorization: `Bearer ${RENDER_API_KEY}`, Accept: 'application/json' }
      );

      if (servicesRes.status !== 200) {
        console.error('❌ Render API error:', servicesRes.status, JSON.stringify(servicesRes.body).slice(0, 200));
        printManualRenderInstructions(WEBHOOK_URL_VALUE);
      } else {
        const services = Array.isArray(servicesRes.body) ? servicesRes.body : servicesRes.body.services || [];
        const svc = services.find(s =>
          (s.service?.name || s.name || '').toLowerCase().includes('contractor')
        );

        const serviceId = svc?.service?.id || svc?.id || RENDER_SERVICE_ID;
        if (!serviceId) {
          console.log('⚠️  contractor-bot service not found in Render API response');
          console.log('   Services:', services.map(s => s.service?.name || s.name).join(', '));
          printManualRenderInstructions(WEBHOOK_URL_VALUE);
        } else {
          console.log(`   Service ID: ${serviceId}`);

          // Add/update env var
          const envRes = await httpsRequest('PUT',
            `https://api.render.com/v1/services/${serviceId}/env-vars`,
            { Authorization: `Bearer ${RENDER_API_KEY}`, Accept: 'application/json' },
            [{ key: 'WEBHOOK_URL', value: WEBHOOK_URL_VALUE }]
          );

          if (envRes.status === 200 || envRes.status === 201) {
            console.log('✅ WEBHOOK_URL added to Render');

            // Trigger deploy
            const deployRes = await httpsPost(
              `https://api.render.com/v1/services/${serviceId}/deploys`,
              { Authorization: `Bearer ${RENDER_API_KEY}`, Accept: 'application/json' },
              {}
            );
            if (deployRes.status === 201 || deployRes.status === 200) {
              console.log('🚀 Redeploy triggered! Deploy ID:', deployRes.body?.id || 'unknown');
            } else {
              console.log('⚠️  Deploy trigger returned:', deployRes.status, JSON.stringify(deployRes.body).slice(0, 200));
            }
          } else {
            console.error('❌ Failed to add env var:', envRes.status, JSON.stringify(envRes.body).slice(0, 200));
            printManualRenderInstructions(WEBHOOK_URL_VALUE);
          }
        }
      }
    } catch (err) {
      console.error('❌ Render API failed:', err.message);
      printManualRenderInstructions(WEBHOOK_URL_VALUE);
    }
  }

  console.log('\n=== Setup complete ===\n');
}

function printManualSupabaseInstructions(sql) {
  console.log('\n📋 MANUAL STEPS FOR SUPABASE:');
  console.log('   1. Go to https://supabase.com → your project → SQL Editor');
  console.log('   2. Paste and run this SQL:\n');
  console.log('---BEGIN SQL---');
  console.log(sql);
  console.log('---END SQL---\n');
}

function printManualRenderInstructions(webhookUrl) {
  console.log('\n📋 MANUAL STEPS FOR RENDER:');
  console.log('   1. Go to https://dashboard.render.com');
  console.log('   2. Click on contractor-bot service');
  console.log('   3. Go to Environment → Environment Variables');
  console.log('   4. Add: WEBHOOK_URL =', webhookUrl);
  console.log('   5. Click Save Changes');
  console.log('   6. Click Manual Deploy → Deploy latest commit');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
