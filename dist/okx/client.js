"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.okxClient = exports.OKXClient = void 0;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("../config");
const logger_1 = require("../utils/logger");
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function sign(timestamp, method, path, body) {
    const message = timestamp + method.toUpperCase() + path + body;
    return crypto_1.default.createHmac('sha256', config_1.config.okx.apiSecret).update(message).digest('base64');
}
class OKXClient {
    http;
    isDemo;
    hasCredentials;
    constructor() {
        this.isDemo = config_1.config.okx.isDemo;
        this.hasCredentials = !!(config_1.config.okx.apiKey && config_1.config.okx.apiSecret && config_1.config.okx.passphrase);
        this.http = axios_1.default.create({
            baseURL: config_1.config.okx.baseUrl,
            timeout: 10_000,
            headers: { 'Content-Type': 'application/json' },
        });
    }
    getHeaders(method, path, body = '') {
        const timestamp = new Date().toISOString();
        const headers = {
            'OK-ACCESS-KEY': config_1.config.okx.apiKey,
            'OK-ACCESS-SIGN': sign(timestamp, method, path, body),
            'OK-ACCESS-TIMESTAMP': timestamp,
            'OK-ACCESS-PASSPHRASE': config_1.config.okx.passphrase,
        };
        if (this.isDemo) {
            headers['x-simulated-trading'] = '1';
        }
        return headers;
    }
    async publicGet(path, params) {
        return this.withRetry(async () => {
            const url = new URL(path, config_1.config.okx.baseUrl);
            if (params) {
                Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
            }
            const res = await this.http.get(url.pathname + url.search);
            if (res.data.code !== '0') {
                throw new Error(`OKX API error ${res.data.code}: ${res.data.msg}`);
            }
            return res.data.data;
        });
    }
    async privateGet(path, params) {
        if (!this.hasCredentials)
            throw new Error('OKX API credentials not configured');
        return this.withRetry(async () => {
            const url = new URL(path, config_1.config.okx.baseUrl);
            if (params) {
                Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
            }
            const fullPath = url.pathname + url.search;
            const headers = this.getHeaders('GET', fullPath);
            const res = await this.http.get(fullPath, { headers });
            if (res.data.code !== '0') {
                throw new Error(`OKX API error ${res.data.code}: ${res.data.msg}`);
            }
            return res.data.data;
        });
    }
    async privatePost(path, body) {
        if (!this.hasCredentials)
            throw new Error('OKX API credentials not configured');
        return this.withRetry(async () => {
            const bodyStr = JSON.stringify(body);
            const headers = this.getHeaders('POST', path, bodyStr);
            const res = await this.http.post(path, body, { headers });
            if (res.data.code !== '0') {
                throw new Error(`OKX API error ${res.data.code}: ${res.data.msg}`);
            }
            return res.data.data;
        });
    }
    async withRetry(fn) {
        let lastError = new Error('Unknown error');
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                return await fn();
            }
            catch (err) {
                lastError = err;
                const isRetryable = err.response?.status === 429 || err.response?.status >= 500 || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT';
                if (!isRetryable || attempt === MAX_RETRIES)
                    break;
                logger_1.logger.warn(`OKX API retry ${attempt}/${MAX_RETRIES}: ${err.message}`);
                await sleep(RETRY_DELAY_MS * attempt);
            }
        }
        throw lastError;
    }
}
exports.OKXClient = OKXClient;
exports.okxClient = new OKXClient();
//# sourceMappingURL=client.js.map