/**
 * API Route Logger Middleware
 * Automatically logs all API requests and responses
 */

import { NextRequest, NextResponse } from 'next/server';
import APILogger from './api-logger';
import { jsonResponse } from './apiResponse';

type RouteHandler = (request: NextRequest) => Promise<NextResponse>;

export function withLogging(endpoint: string, handler: RouteHandler): RouteHandler {
  return async (request: NextRequest) => {
    const startTime = Date.now();
    const method = request.method;

    try {
      // Log incoming request
      const requestBody = method !== 'GET' ? await request.clone().json().catch(() => ({})) : undefined;
      APILogger.request(endpoint, method, requestBody);

      // Execute handler
      const response = await handler(request);

      // Log successful response
      const duration = Date.now() - startTime;
      const responseData = response.status < 400 ? await response.clone().json().catch(() => ({})) : undefined;

      APILogger.response(endpoint, method, response.status, responseData, duration);
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      APILogger.error(endpoint, method, error, 500, duration);

      const msg = error instanceof Error ? error.message : String(error);
      return jsonResponse({ success: false, error: msg }, 500) as unknown as NextResponse;
    }
  };
}

export function withTypedLogging<T extends Record<string, unknown>>(
  endpoint: string,
  handler: (request: NextRequest) => Promise<NextResponse<T>>
): (request: NextRequest) => Promise<NextResponse<T>> {
  return async (request: NextRequest) => {
    const startTime = Date.now();
    const method = request.method;

    try {
      const requestBody = method !== 'GET' ? await request.clone().json().catch(() => ({})) : undefined;
      APILogger.request(endpoint, method, requestBody);

      const response = await handler(request);

      const duration = Date.now() - startTime;
      const responseData = response.status < 400 ? await response.clone().json().catch(() => ({})) : undefined;

      APILogger.response(endpoint, method, response.status, responseData, duration);
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      APILogger.error(endpoint, method, error, 500, duration);

      const msg = error instanceof Error ? error.message : String(error);
      return jsonResponse({ success: false, error: msg }, 500) as unknown as NextResponse<T>;
    }
  };
}
