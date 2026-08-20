import logger from '@/lib/logger';
import { getMpesaConfig } from '@/lib/integrations/tenant-integration-config.server';

/**
 * M-Pesa Payment Integration
 * Handles M-Pesa STK Push and payment processing
 */

interface MpesaConfig {
  consumerKey: string;
  consumerSecret: string;
  businessShortCode: string;
  passkey: string;
  environment: 'sandbox' | 'production';
  callbackUrl: string;
}

interface StkPushRequest {
  phoneNumber: string;
  amount: number;
  accountReference: string;
  transactionDescription: string;
}

interface StkPushResponse {
  success: boolean;
  checkoutRequestId?: string;
  requestId?: string;
  code?: string;
  message?: string;
  error?: string;
}

interface MpesaAuthResponse {
  access_token: string;
  expires_in: number;
}

class MpesaClient {
  private config: MpesaConfig;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(config: MpesaConfig) {
    this.config = config;
  }

  private getBaseUrl(): string {
    return this.config.environment === 'sandbox'
      ? 'https://sandbox.safaricom.co.ke'
      : 'https://api.safaricom.co.ke';
  }

  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      const auth = Buffer.from(
        `${this.config.consumerKey}:${this.config.consumerSecret}`
      ).toString('base64');

      const response = await fetch(
        `${this.getBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`,
        {
          method: 'GET',
          headers: {
            Authorization: `Basic ${auth}`,
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({} as Record<string, unknown>));
        const errMsg = String(errorData.errorMessage || errorData.Message || errorData.ResponseDescription || '');

        // Give a clearer, actionable message when credentials are wrong
        const baseUrl = this.getBaseUrl();
        if (response.status === 401 || /wrong credential/i.test(errMsg) || /invalid credentials/i.test(errMsg)) {
          logger.error('Wrong credentials when requesting M-Pesa access token', { baseUrl, status: response.status, errMsg });
          throw new Error(`Wrong credentials when requesting M-Pesa access token from ${baseUrl}. Check MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET, ensure MPESA_ENVIRONMENT matches (sandbox vs production), and avoid trailing whitespace. (${errMsg || '401 Unauthorized'})`);
        }

        logger.error('Failed to get access token from M-Pesa', { baseUrl, status: response.status, errMsg });
        throw new Error(`Failed to get access token from ${baseUrl}: ${errMsg} (HTTP ${response.status})`);
      }

      const data: MpesaAuthResponse = await response.json();

      this.accessToken = data.access_token;
      // Cache token for 50 minutes (expires in 1 hour)
      this.tokenExpiry = Date.now() + data.expires_in * 1000 - 10 * 60 * 1000;

      return data.access_token;
    } catch (error) {
      logger.error('Error getting M-Pesa access token', { error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
      throw error;
    }
  }

  private generatePassword(timestamp: string): string {
    const stringToEncode = `${this.config.businessShortCode}${this.config.passkey}${timestamp}`;

    // Using Node.js crypto for base64 encoding
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(stringToEncode).toString('base64');
    } else {
      // Fallback for browser environment (shouldn't be used)
      return btoa(stringToEncode);
    }
  }

  private formatPhoneNumber(phoneNumber: string): string {
    // Remove any non-digit characters
    let cleaned = phoneNumber.replace(/\D/g, '');

    // If starts with 0, replace with 254
    if (cleaned.startsWith('0')) {
      cleaned = '254' + cleaned.slice(1);
    } else if (!cleaned.startsWith('254')) {
      // If doesn't start with 254, assume Kenya
      cleaned = '254' + cleaned;
    }

    return cleaned;
  }

  private createAccountReference(orderNumber: string): string {
    // M-Pesa AccountReference requirement: alphanumeric, max 12 characters
    // Extract digits from order number and prepend with "ORD" for alphanumeric format
    const onlyNumbers = orderNumber.replace(/[^0-9]/g, '');
    // Take last 9 digits and prepend "ORD" = 12 characters total
    const lastNineDigits = onlyNumbers.slice(-9);
    return `ORD${lastNineDigits}`;
  }

  public async initiateStkPush(request: StkPushRequest): Promise<StkPushResponse> {
    try {
      const accessToken = await this.getAccessToken();
      const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, -3);
      const password = this.generatePassword(timestamp);
      const phoneNumber = this.formatPhoneNumber(request.phoneNumber);
      const amount = Math.round(request.amount);

      // Create account reference using new simple method (numbers only)
      const accountReference = this.createAccountReference(request.accountReference);
      // Sanitize transaction description
      const transactionDescription = sanitizeMpesaDescription(request.transactionDescription);

      // Log the account reference details
      logger.debug('M-Pesa Account Reference Details', {
        original: request.accountReference,
        simplified: accountReference,
        length: accountReference.length,
        format: 'alphanumeric (ORD + digits)',
      });

      logger.debug('M-Pesa Password Calculation', {
        businessShortCode: this.config.businessShortCode,
        passkey: '***REDACTED***',
        calcTimestamp: timestamp,
        stringToEncode: `${this.config.businessShortCode}${this.config.passkey}${timestamp}`.substring(0, 20) + '...',
        passwordLength: password.length,
        passwordPreview: password.substring(0, 20) + '...',
      });

      logger.debug('M-Pesa Transaction Description', { value: transactionDescription, length: transactionDescription.length });

      const payload = {
        BusinessShortCode: this.config.businessShortCode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: amount,
        PartyA: phoneNumber,
        PartyB: this.config.businessShortCode,
        PhoneNumber: phoneNumber,
        CallBackURL: this.config.callbackUrl,
        AccountReference: accountReference,
        // Safaricom expects 'TransactionDesc' (remarks/description) in the STK Push request
        TransactionDesc: transactionDescription,
      };

      // Log full payload BEFORE sending (mask phone/partyA)
      logger.debug('M-Pesa Full Payload Being Sent', {
        BusinessShortCode: payload.BusinessShortCode,
        Amount: payload.Amount,
        TransactionType: payload.TransactionType,
        PartyA: 'REDACTED',
        PartyB: payload.PartyB,
        PhoneNumber: 'REDACTED',
        CallBackURL: payload.CallBackURL,
        AccountReference: payload.AccountReference,
        TransactionDesc: payload.TransactionDesc,
        Timestamp: payload.Timestamp,
      });

      // Helper to perform the STK push request
      const doStkRequest = async (bodyPayload: Record<string, unknown>) => {
        const resp = await fetch(`${this.getBaseUrl()}/mpesa/stkpush/v1/processrequest`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(bodyPayload),
        });
        return resp;
      };

      let response = await doStkRequest(payload);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({} as Record<string, unknown>));
        logger.error('M-Pesa STK Push Error (attempt 1)', { errorData });

        const errMsg = String(errorData.errorMessage || errorData.Message || errorData.ResponseDescription || '');

        // If Safaricom complains about 'Invalid Remarks' (or errorCode 400.002.02),
        // retry once using AccountReference as TransactionDesc (which is strictly alphanumeric).
        if (errMsg === 'Invalid Remarks' || /invalid remarks/i.test(errMsg)) {
          logger.warn('Invalid Remarks detected — retrying STK push with AccountReference as TransactionDesc');
           const fallbackPayload = { ...payload, TransactionDesc: accountReference } as Record<string, unknown>;
          logger.debug('M-Pesa Fallback payload', { AccountReference: fallbackPayload.AccountReference, TransactionDesc: fallbackPayload.TransactionDesc });

          response = await doStkRequest(fallbackPayload);

          if (!response.ok) {
            const errorData2 = await response.json().catch(() => ({} as Record<string, unknown>));
            logger.error('M-Pesa STK Push Error (attempt 2)', { errorData2 });
            return {
              success: false,
              error: errorData2.errorMessage || errorData2.Message || errorData2.ResponseDescription || 'Failed to initiate M-Pesa payment',
            };
          }
        } else {
          return {
            success: false,
            error: errorData.errorMessage || 'Failed to initiate M-Pesa payment',
          };
        }
      }

      const data = await response.json();

      if (data.ResponseCode === '0') {
        return {
          success: true,
          checkoutRequestId: data.CheckoutRequestID,
          requestId: data.RequestId,
          code: data.ResponseCode,
          message: data.ResponseDescription,
        };
      } else {
        logger.warn('M-Pesa STK push responded with non-zero ResponseCode', { response: data });
        return { success: false, code: data.ResponseCode, message: data.ResponseDescription, error: data.ResponseDescription };
      }
    } catch (error) {
      logger.error('Error initiating M-Pesa STK Push', { error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  public async queryTransactionStatus(checkoutRequestId: string): Promise<Record<string, unknown>> {
    try {
      const accessToken = await this.getAccessToken();
      const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, -3);
      const password = this.generatePassword(timestamp);

      const payload = {
        BusinessShortCode: this.config.businessShortCode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId,
      };

      const response = await fetch(
        `${this.getBaseUrl()}/mpesa/stkpushquery/v1/query`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to query transaction status: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error querying M-Pesa transaction status:', error);
      throw error;
    }
  }
}

/**
 * Sanitize transaction description for M-Pesa API
 * M-Pesa requires max 13 characters, alphanumeric and spaces only
 */
function sanitizeMpesaDescription(input?: string): string {
  const fallback = 'OrderPayment';

  if (!input) return fallback;

  return input
    .replace(/[^a-zA-Z0-9 ]/g, '') // remove symbols, keep only letters, numbers, and spaces
    .trim()
    .substring(0, 13) || fallback; // max 13 characters
}

/**
 * Builds an MpesaClient from that organization's own stored, decrypted
 * credentials (src/lib/integrations/tenant-integration-config.server.ts) —
 * every tenant has their own paybill/till, so there is no global/env-var
 * fallback. Returns null if the org hasn't configured M-Pesa yet; callers
 * (a future checkout flow) decide how to handle that (e.g. hide M-Pesa as a
 * payment option).
 */
export async function getMpesaClientForOrganization(organizationId: string): Promise<MpesaClient | null> {
  const config = await getMpesaConfig(organizationId);
  if (!config) return null;
  return new MpesaClient(config);
}

export type { MpesaConfig, StkPushRequest, StkPushResponse, MpesaAuthResponse };

