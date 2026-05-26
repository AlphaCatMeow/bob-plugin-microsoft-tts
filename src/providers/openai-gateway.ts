/**
 * @file OpenAI 兼容网关 Provider
 * @description 本文件实现了通过 OpenAI 兼容的 `/v1/audio/speech` 端点进行语音合成的
 *   Provider。适用于自建的 TTS 网关（如 Voicecraft、CosyVoice 等），这些网关实现了
 *   OpenAI TTS API 的接口规范。
 *
 * 核心功能：
 * - 将 Azure SSML 格式的语速/音调/音量参数转换为 OpenAI API 格式；
 * - 自动补全端点 URL 中的 `/v1/audio/speech` 路径；
 * - 内置重试机制（最多重试 2 次）。
 */

import type { SynthesisRequest } from '../types';
import { makeError } from '../util/error';
import { looksLikeAudioBytes } from '../core/audio';
import { normalizeBytes } from '../util/bytes';
import { withRetry } from '../util/retry';

/**
 * 将 Azure SSML 语速格式转换为 OpenAI speed 参数
 * @description Azure SSML 使用百分比字符串表示语速偏移（如 `'+50%'`、`'-20%'`），
 *   OpenAI API 使用浮点数倍率表示（如 `1.5`、`0.8`）。
 *   转换公式：`speed = 1 ± delta`，其中 `delta` 为百分比对应的小数值。
 *
 * @example
 *   `rateToSpeed('+50%')`  → `1.5`
 *   `rateToSpeed('-20%')`  → `0.8`
 *   `rateToSpeed('+0%')`   → `1.0`
 *   `rateToSpeed(undefined)` → `1.0`
 *
 * @param rate - Azure SSML 语速字符串，格式为 `'[+-]N%'`，N 为 0-999 的整数
 * @returns OpenAI speed 浮点数倍率，最小值为 `0.1`
 */
export function rateToSpeed(rate: string | undefined): number {
    if (typeof rate !== 'string') return 1.0;
    const match = rate.match(/^([+-])(\d{1,3})%$/);
    if (!match) return 1.0;
    const delta = parseInt(match[2], 10) / 100;
    return match[1] === '+' ? 1 + delta : Math.max(0.1, 1 - delta);
}

/**
 * 将 Azure SSML 音调格式转换为 OpenAI pitch 参数
 * @description Azure SSML 使用赫兹偏移字符串表示音调（如 `'+10Hz'`、`'-5Hz'`），
 *   OpenAI API 使用带符号的整数字符串表示赫兹偏移（如 `'10'`、`'-5'`）。
 *
 * @example
 *   `pitchToHz('+10Hz')`  → `'10'`
 *   `pitchToHz('-5Hz')`   → `'-5'`
 *   `pitchToHz('+0Hz')`   → `'0'`
 *   `pitchToHz(undefined)` → `'0'`
 *
 * @param pitch - Azure SSML 音调字符串，格式为 `'[+-]NHz'`，N 为 0-999 的整数
 * @returns OpenAI pitch 带符号整数字符串
 */
export function pitchToHz(pitch: string | undefined): string {
    if (typeof pitch !== 'string') return '0';
    const match = pitch.match(/^([+-])(\d{1,3})Hz$/);
    if (!match) return '0';
    return match[1] + match[2];
}

/**
 * 将 Azure SSML 音量格式转换为 Voicecraft 音量参数
 * @description Azure SSML 使用百分比字符串表示音量偏移（如 `'+50%'`、`'-30%'`），
 *   Voicecraft API 使用小数字符串表示音量偏移（如 `'0.5'`、`'-0.3'`）。
 *   转换公式：`volume = ±(pct / 100)`
 *
 * @example
 *   `volumeToVoicecraftVolume('+50%')`  → `'0.5'`
 *   `volumeToVoicecraftVolume('-30%')`  → `'-0.3'`
 *   `volumeToVoicecraftVolume('+0%')`   → `'0'`
 *   `volumeToVoicecraftVolume(undefined)` → `'0'`
 *
 * @param volume - Azure SSML 音量字符串，格式为 `'[+-]N%'`，N 为 0-999 的整数
 * @returns Voicecraft 音量小数字符串
 */
export function volumeToVoicecraftVolume(volume: string | undefined): string {
    if (typeof volume !== 'string') return '0';
    const match = volume.match(/^([+-])(\d{1,3})%$/);
    if (!match) return '0';
    const pct = parseInt(match[2], 10);
    if (pct === 0) return '0';
    const result = match[1] === '-' ? -(pct / 100) : pct / 100;
    return String(result);
}

/**
 * 解析并补全 OpenAI Speech API 端点 URL
 * @description 确保用户配置的端点 URL 指向 OpenAI 兼容的 `/v1/audio/speech` 路径。
 *   若 URL 已以 `/v1/audio/speech` 结尾则直接使用，否则去除末尾斜杠后追加该路径。
 *
 * @example
 *   `resolveOpenAiSpeechEndpoint('https://api.example.com')` → `'https://api.example.com/v1/audio/speech'`
 *   `resolveOpenAiSpeechEndpoint('https://api.example.com/v1/audio/speech')` → `'https://api.example.com/v1/audio/speech'`
 *   `resolveOpenAiSpeechEndpoint('https://api.example.com/')` → `'https://api.example.com/v1/audio/speech'`
 *
 * @param endpoint - 用户配置的网关地址
 * @returns 补全后的完整 API 端点 URL
 */
export function resolveOpenAiSpeechEndpoint(endpoint: string): string {
    const trimmed = endpoint.trim();
    if (trimmed.endsWith('/v1/audio/speech')) {
        return trimmed;
    }
    return trimmed.replace(/\/+$/, '') + '/v1/audio/speech';
}

/**
 * 通过 OpenAI 兼容网关进行语音合成
 * @description 向自建的 OpenAI 兼容 TTS 网关发送 POST 请求，获取合成音频数据。
 *   处理流程：
 *   1. 校验 `customEndpoint` 是否为有效的 HTTP(S) URL；
 *   2. 通过 {@link resolveOpenAiSpeechEndpoint} 补全端点路径；
 *   3. 将 Azure SSML 参数转换为 OpenAI API 格式（speed/pitch/volume）；
 *   4. 发送请求并通过 {@link withRetry} 进行最多 2 次重试；
 *   5. 校验响应数据是否为合法音频格式。
 *
 * @param params - 语音合成请求参数
 * @param params.customEndpoint - 自建网关地址，必须为 `http://` 或 `https://` 开头的 URL
 * @param params.text - 待合成的文本内容
 * @param params.voice - 发音人名称
 * @param params.rate - Azure SSML 语速，通过 {@link rateToSpeed} 转换
 * @param params.pitch - Azure SSML 音调，通过 {@link pitchToHz} 转换
 * @param params.volume - Azure SSML 音量，通过 {@link volumeToVoicecraftVolume} 转换
 * @param params.style - 语音风格，默认 `'general'`
 * @returns 音频字节数组（`number[]`）
 * @throws 当端点为空、请求失败、响应状态码异常或返回数据非音频格式时抛出错误
 */
export async function synthesizeViaOpenAiGateway(params: SynthesisRequest): Promise<number[]> {
    if (!params.customEndpoint || params.customEndpoint.indexOf('http') !== 0) {
        throw makeError('api', '自建网关地址为空或不是 http(s) URL');
    }

    const endpoint = resolveOpenAiSpeechEndpoint(params.customEndpoint);
    const payload = {
        input: params.text,
        voice: params.voice,
        speed: rateToSpeed(params.rate),
        pitch: pitchToHz(params.pitch),
        volume: volumeToVoicecraftVolume(params.volume),
        style: params.style || 'general',
    };

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };

    return withRetry(async () => {
        let response: Response;
        try {
            response = await fetch(endpoint, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload),
            });
        } catch (error) {
            throw makeError('api', '自建网关请求失败：' + (error instanceof Error ? error.message : String(error)));
        }

        if (!response.ok) {
            let msg = '';
            try {
                msg = await response.text();
            } catch (_) {
                // ignore response body parsing failures
            }
            throw makeError('api', `自建网关请求失败 ${response.status}：${msg}`, msg, response.status);
        }

        const bytes = await normalizeBytes(await response.blob());
        if (!looksLikeAudioBytes(bytes)) {
            const preview = Array.from(bytes.slice(0, 64), b => String.fromCharCode(b)).join('');
            throw makeError('api', `自建网关没有返回可播放音频：${preview || '<无响应体>'}`, preview);
        }
        return bytes;
    }, {
        maxRetries: 2,
        baseDelayMs: 1000,
    });
}
