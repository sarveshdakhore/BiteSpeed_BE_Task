import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

process.env.APP_ENV ??= 'test';
process.env.NODE_ENV ??= 'test';
process.env.PORT ??= '3001';
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/bitespeed?schema=public';
process.env.CORS_ORIGIN ??= 'http://localhost:3001';
process.env.LOG_LEVEL ??= 'silent';
process.env.RATE_LIMIT_WINDOW_MS ??= '60000';
process.env.RATE_LIMIT_MAX ??= '1000';
