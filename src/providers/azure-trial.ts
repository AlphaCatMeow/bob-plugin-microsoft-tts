/**
 * @file Azure 免费体验 Provider
 * @description 本文件实现了 Azure Speech Service 免费体验端点的语音合成 Provider。
 *   该端点（`accfreetrial`）是 Azure 官网提供的在线体验接口，无需 API Key，
 *   通过模拟浏览器请求方式调用，返回 raw PCM 音频数据后转换为 WAV 格式。
 *
 * 注意事项：
 * - 使用运行时提供的 `fetch`（由 bob-shim.js 注入）发起请求；
 * - 返回的音频为 raw PCM 格式（24kHz 16bit 单声道），需通过 {@link rawPcmToWavBytes}
 *   添加 WAV 文件头后才能被 Bob 正确播放；
 * - 该端点可能存在频率限制或不稳定的情况。
 */

import type { SynthesisRequest } from '../types';
import { makeError } from '../util/error';
import { normalizeBytes } from '../util/bytes';
import { rawPcmToWavBytes } from '../core/audio';
import { buildSsml } from '../core/ssml';
import { withRetry } from '../util/retry';
import { USER_AGENT } from '../config';

/**
 * Azure 免费体验 TTS API 端点
 * @description 东南亚区域的 Azure Speech Service 免费体验接口，
 *   模拟 Azure 官网在线体验页面的请求方式。
 */
const ACC_FREE_TRIAL_URL = 'https://southeastasia.api.speech.microsoft.com/accfreetrial/texttospeech/acc/v3.0-beta1/vcg/speak';

/**
 * 通过 Azure 免费体验端点进行语音合成
 * @description 调用 Azure Speech Service 免费体验 API 获取 raw PCM 音频数据，
 *   并将其转换为带 WAV 文件头的完整音频字节数组。处理流程：
 *   1. 构建 SSML 并通过 `fetch` 发起 POST 请求；
 *   2. 校验 HTTP 状态码和 Content-Type；
 *   3. 提取响应中的原始音频数据；
 *   4. 将 raw PCM 数据转换为 WAV 格式（24kHz 采样率）。
 *
 * @param params - 语音合成请求参数
 * @returns WAV 格式的音频字节数组（`number[]`，每个元素为 0-255 的字节值）
 * @throws 当 HTTP 状态码异常、响应非音频格式或音频数据为空时抛出错误
 */
export async function synthesizeViaAzureTrial(params: SynthesisRequest): Promise<number[]> {
    return withRetry(async () => {
        const ssml = buildSsml(params);

        const response = await fetch(ACC_FREE_TRIAL_URL, {
            method: 'POST',
            headers: {
                'Authority': 'southeastasia.api.speech.microsoft.com',
                'Accept': '*/*',
                'Accept-Language': 'zh-CN,zh;q=0.9',
                'Cache-Control': 'no-cache',
                'Content-Type': 'application/json',
                'Origin': 'https://azure.microsoft.com',
                'Pragma': 'no-cache',
                'Referer': 'https://azure.microsoft.com/',
                'User-Agent': USER_AGENT,
            },
            body: JSON.stringify({
                ttsAudioFormat: 'raw-24khz-16bit-mono-pcm',
                ssml: ssml,
            }),
        });

        if (!response.ok) {
            let detail = '';
            try { detail = await response.text(); } catch (_) {}
            throw makeError('api', detail ? `Azure 体验服务 ${response.status}：${detail}` : `Azure 体验服务 ${response.status} 无响应体`, detail, response.status);
        }

        const contentType = response.headers.get('content-type');
        if (contentType && !/^audio\//i.test(contentType)) {
            let detail = '';
            try { detail = await response.text(); } catch (_) {}
            throw makeError('api', detail ? `Azure 体验服务没有返回音频：${detail}` : 'Azure 体验服务没有返回音频', detail);
        }

        const rawBytes = await normalizeBytes(await response.blob());
        return rawPcmToWavBytes(rawBytes, 24000);
    }, {
        maxRetries: 2,
        baseDelayMs: 1000,
    });
}
