/**
 * @module core/azure-token
 * @description Azure Cognitive Services Token 获取与请求签名。
 *
 * 通过模拟 Microsoft Translator Android 客户端的认证流程获取 TTS 端点令牌，
 * 使用运行时提供的 `crypto.subtle`（由 bob-shim.js 注入）执行 HMAC-SHA256 签名。
 */

import { makeError } from '../util/error';
import { base64ToBytes, bytesToBase64 } from '../util/bytes';
import { randomHex32 } from '../util/random';
import { USER_AGENT } from '../config';

/** Token 过期前提前刷新的时间（秒） */
const TOKEN_REFRESH_BEFORE_EXPIRY = 3 * 60;

/** Microsoft Translator 端点获取 URL */
const ENDPOINT_URL = 'https://dev.microsofttranslator.com/apps/endpoint?api-version=1.0';

/** HMAC 签名密钥（Base64 编码），从 Microsoft Translator Android 客户端提取 */
const HMAC_KEY_B64 = 'oik6PdDdMnOXemTbwvMn9de/h9lFnfBaCWbGMMZqqoSaQaqUOqjVGm5NqsmjcBI1x+sS9ugjB55HEJWRiFXYFw==';

interface TokenEndpoint {
    r: string;
    t: string;
}

interface CachedToken {
    endpoint: TokenEndpoint | null;
    token: string | null;
    expiredAt: number | null;
}

let tokenCache: CachedToken = { endpoint: null, token: null, expiredAt: null };

/**
 * 生成 Microsoft Translator 签名格式的 UTC 日期字符串。
 *
 * @returns 格式如 `'thu, 01 jan 2026 00:00:00 gmt'`（全小写）
 */
function dateFormat(): string {
    return (new Date()).toUTCString().replace(/GMT/, '').trim() + ' GMT';
}

/**
 * 使用 HMAC-SHA256 对数据进行签名，返回 Base64 编码的签名值。
 *
 * 通过运行时提供的 `crypto.subtle`（由 bob-shim.js 注入到 globalThis）执行签名，
 * 无需项目自行实现 HMAC 算法。
 *
 * @param keyBytes - HMAC 密钥字节数组
 * @param dataBytes - 待签名数据字节数组
 * @returns Base64 编码的 HMAC-SHA256 签名
 */
async function hmacSign(keyBytes: number[], dataBytes: number[]): Promise<string> {
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        new Uint8Array(keyBytes),
        { name: 'HMAC', hash: { name: 'SHA-256' } },
        false,
        ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, new Uint8Array(dataBytes));
    const sigBytes = Array.from(new Uint8Array(signature));
    return bytesToBase64(sigBytes);
}

/**
 * 生成 Microsoft Translator 端点请求的 X-MT-Signature 签名。
 *
 * 签名算法：
 * 1. 拼接 `MSTranslatorAndroidApp` + URL 编码路径 + 日期 + UUID，全小写；
 * 2. 对拼接字符串进行 HMAC-SHA256 签名（密钥为硬编码的 Base64 密钥）；
 * 3. 返回 `MSTranslatorAndroidApp::签名::日期::UUID` 格式。
 *
 * @param urlStr - 请求 URL
 * @returns 完整的签名头值
 */
async function sign(urlStr: string): Promise<string> {
    const url = urlStr.split('://')[1];
    const encodedUrl = encodeURIComponent(url);
    const uuidStr = randomHex32();
    const formattedDate = dateFormat();
    const bytesToSignStr = `MSTranslatorAndroidApp${encodedUrl}${formattedDate}${uuidStr}`.toLowerCase();
    const bytesToSign = Array.from(new TextEncoder().encode(bytesToSignStr));
    const key = base64ToBytes(HMAC_KEY_B64);
    const sigBase64 = await hmacSign(key, bytesToSign);
    return `MSTranslatorAndroidApp::${sigBase64}::${formattedDate}::${uuidStr}`;
}

/**
 * 解码 JWT payload 部分。
 *
 * 兼容 Base64url 编码（`-_` 替代 `+/`，可省略 padding）。
 *
 * @param jwt - 完整的 JWT 字符串
 * @returns 解码后的 payload 对象
 * @throws 当 JWT 格式无效时抛出错误
 */
function decodeJwtPayload(jwt: string): Record<string, unknown> {
    const parts = jwt.split('.');
    if (parts.length < 2) throw makeError('api', 'Azure 认证 JWT 格式无效');
    const bytes = base64ToBytes(parts[1]);
    let text = '';
    for (let i = 0; i < bytes.length; i++) {
        text += String.fromCharCode(bytes[i]);
    }
    return JSON.parse(text) as Record<string, unknown>;
}

/** Azure TTS 端点信息 */
export interface AzureEndpoint {
    /** 区域标识，如 `'southeastasia'` */
    region: string;
    /** 认证令牌（JWT） */
    token: string;
}

/**
 * 获取 Azure Cognitive Services TTS 端点信息。
 *
 * 通过 Microsoft Translator 认证流程获取端点区域和令牌。
 * 令牌会自动缓存，在过期前 3 分钟自动刷新；若获取失败但缓存中仍有令牌，
 * 即使过期也会尝试使用缓存。
 *
 * @returns Azure 端点区域和认证令牌
 * @throws 当获取端点失败且无缓存可用时抛出错误
 */
export async function getAzureEndpoint(): Promise<AzureEndpoint> {
    const now = Date.now() / 1000;

    if (tokenCache.token && tokenCache.expiredAt && now < tokenCache.expiredAt - TOKEN_REFRESH_BEFORE_EXPIRY) {
        return { region: tokenCache.endpoint!.r, token: tokenCache.token };
    }

    const signature = await sign(ENDPOINT_URL);
    const clientId = randomHex32();

    const response = await fetch(ENDPOINT_URL, {
        method: 'POST',
        headers: {
            'Accept-Language': 'zh-Hans',
            'X-ClientVersion': '4.0.530a 5fe1dc6c',
            'X-UserId': '0f04d16a175c411e',
            'X-HomeGeographicRegion': 'zh-Hans-CN',
            'X-ClientTraceId': clientId,
            'X-MT-Signature': signature,
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': '0',
            'Accept-Encoding': 'gzip',
        },
    });

    if (!response.ok) {
        if (tokenCache.token) {
            console.warn(`Azure 认证端点刷新失败(${response.status})，使用缓存 Token`);
            return { region: tokenCache.endpoint!.r, token: tokenCache.token };
        }
        resetTokenCache();
        throw makeError('api', `Azure 认证端点获取失败：${response.status}`, undefined, response.status);
    }

    const data = await response.json() as { r: string; t: string };
    const decoded = decodeJwtPayload(data.t);
    const exp = typeof decoded.exp === 'number' ? decoded.exp : 0;

    tokenCache = { endpoint: data, token: data.t, expiredAt: exp };
    return { region: data.r, token: data.t };
}

/** 重置 Token 缓存，供异常恢复使用 */
export function resetTokenCache(): void {
    tokenCache = { endpoint: null, token: null, expiredAt: null };
}
