import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import crypto from 'crypto';
import { config } from '../config';
import { logger } from '../utils/logger';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sign(timestamp: string, method: string, path: string, body: string): string {
  const message = timestamp + method.toUpperCase() + path + body;
  return crypto.createHmac('sha256', config.okx.apiSecret).update(message).digest('base64');
}

export class OKXClient {
  private http: AxiosInstance;
  private isDemo: boolean;
  private hasCredentials: boolean;

  constructor() {
    this.isDemo = config.okx.isDemo;
    this.hasCredentials = !!(config.okx.apiKey && config.okx.apiSecret && config.okx.passphrase);

    this.http = axios.create({
      baseURL: config.okx.baseUrl,
      timeout: 10_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private getHeaders(method: string, path: string, body = ''): Record<string, string> {
    const timestamp = new Date().toISOString();
    const headers: Record<string, string> = {
      'OK-ACCESS-KEY': config.okx.apiKey,
      'OK-ACCESS-SIGN': sign(timestamp, method, path, body),
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': config.okx.passphrase,
    };
    if (this.isDemo) {
      headers['x-simulated-trading'] = '1';
    }
    return headers;
  }

  async publicGet<T = any>(path: string, params?: Record<string, string>): Promise<T> {
    return this.withRetry(async () => {
      const url = new URL(path, config.okx.baseUrl);
      if (params) {
        Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
      }
      const res = await this.http.get<{ code: string; data: T; msg: string }>(url.pathname + url.search);
      if (res.data.code !== '0') {
        throw new Error(`OKX API error ${res.data.code}: ${res.data.msg}`);
      }
      return res.data.data;
    });
  }

  async privateGet<T = any>(path: string, params?: Record<string, string>): Promise<T> {
    if (!this.hasCredentials) throw new Error('OKX API credentials not configured');
    return this.withRetry(async () => {
      const url = new URL(path, config.okx.baseUrl);
      if (params) {
        Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
      }
      const fullPath = url.pathname + url.search;
      const headers = this.getHeaders('GET', fullPath);
      const res = await this.http.get<{ code: string; data: T; msg: string }>(fullPath, { headers });
      if (res.data.code !== '0') {
        throw new Error(`OKX API error ${res.data.code}: ${res.data.msg}`);
      }
      return res.data.data;
    });
  }

  async privatePost<T = any>(path: string, body: Record<string, unknown>): Promise<T> {
    if (!this.hasCredentials) throw new Error('OKX API credentials not configured');
    return this.withRetry(async () => {
      const bodyStr = JSON.stringify(body);
      const headers = this.getHeaders('POST', path, bodyStr);
      const res = await this.http.post<{ code: string; data: T; msg: string }>(path, body, { headers });
      if (res.data.code !== '0') {
        throw new Error(`OKX API error ${res.data.code}: ${res.data.msg}`);
      }
      return res.data.data;
    });
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error = new Error('Unknown error');
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastError = err;
        const isRetryable = err.response?.status === 429 || err.response?.status >= 500 || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT';
        if (!isRetryable || attempt === MAX_RETRIES) break;
        logger.warn(`OKX API retry ${attempt}/${MAX_RETRIES}: ${err.message}`);
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
    throw lastError;
  }
}

export const okxClient = new OKXClient();
