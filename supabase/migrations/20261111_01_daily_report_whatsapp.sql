-- Owner's end-of-day sales summary on WhatsApp (GET /api/cron/daily-whatsapp-report).
--   dailyReportWhatsapp   : the number to send to, international digits without "+"
--                           (e.g. 254712345678); null = report off.
--   dailyReportLastSentOn : the Kenya-time day last sent, so a re-run never sends twice.
-- Until this runs, the setting reads as off and saving it returns a clear error.
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "dailyReportWhatsapp" text;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "dailyReportLastSentOn" date;
