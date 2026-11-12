// Runs one of the daily jobs under /api/cron from inside the portal container.
// On the VPS these are Coolify scheduled tasks (vercel.json's crons only ran on
// Vercel), e.g. `node run-cron.mjs sync-exchange-rates`. Reads CRON_SECRET from
// the container's own environment, so the task command holds no secret, and
// exits non-zero on failure so Coolify shows the run as failed.

const JOBS = ['sync-exchange-rates', 'generate-recurring-expenses', 'paystack-renewals', 'daily-whatsapp-report'];

const job = process.argv[2];
if (!JOBS.includes(job)) {
  console.error(`Usage: node run-cron.mjs <${JOBS.join('|')}>`);
  process.exit(2);
}
if (!process.env.CRON_SECRET) {
  console.error('CRON_SECRET is not set in this container');
  process.exit(1);
}

const port = process.env.PORT || '3000';
try {
  const res = await fetch(`http://127.0.0.1:${port}/api/cron/${job}`, {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  const body = await res.text();
  console.log(`${job}: HTTP ${res.status} ${body.slice(0, 2000)}`);
  process.exit(res.ok ? 0 : 1);
} catch (err) {
  console.error(`${job}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
