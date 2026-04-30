import { NextResponse } from 'next/server';

const DEFAULT_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Allow-Credentials': 'true',
};

export function jsonResponse(payload: unknown, status = 200, extraHeaders?: Record<string,string>) {
  const headers = { 'Content-Type': 'application/json', ...DEFAULT_CORS, ...(extraHeaders || {}) };
  return NextResponse.json(payload, { status, headers });
}

export function optionsResponse(allowedMethods = 'GET,POST,PUT,PATCH,DELETE,OPTIONS') {
  const headers = {
    ...DEFAULT_CORS,
    'Access-Control-Allow-Methods': allowedMethods,
  };
  return new NextResponse(null, { status: 204, headers });
}
