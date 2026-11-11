-- RoyalTrack's WhatsApp sending account, set from the /platform console
-- (WhatsApp section) instead of server env vars. One account for the whole
-- platform; the access token is stored encrypted (CREDENTIALS_ENCRYPTION_KEY).
-- Until this runs, the console shows the section as unavailable and the
-- WHATSAPP_* env vars, if any, are used.
ALTER TABLE "PlatformSettings" ADD COLUMN IF NOT EXISTS "whatsappPhoneNumberId" text;
ALTER TABLE "PlatformSettings" ADD COLUMN IF NOT EXISTS "whatsappAccessTokenEnc" text;
ALTER TABLE "PlatformSettings" ADD COLUMN IF NOT EXISTS "whatsappTemplate" text;
ALTER TABLE "PlatformSettings" ADD COLUMN IF NOT EXISTS "whatsappTemplateLang" text;
