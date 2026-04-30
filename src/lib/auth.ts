// Public auth entrypoint: re-export client-safe helpers by default so existing
// client imports (`import { verifyToken } from '@/lib/auth'`) remain safe.
//
// Server code should import directly from '@/lib/auth.server' when it needs
// Node APIs like jsonwebtoken, bcryptjs, otplib, or qrcode.
export * from './auth.client';


