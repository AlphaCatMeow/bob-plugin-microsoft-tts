/**
 * @file Azure 认知服务 Provider
 * @description 通过 Microsoft Translator 认证流程获取 Azure Cognitive Services TTS 端点令牌，
 *   调用 TTS API 完成语音合成。支持长文本自动分块、批量并发和自动重试。
 */

import type { SynthesisRequest } from '../types';
import { makeError } from '../util/error';
import { normalizeBytes, concatBytes } from '../util/bytes';
import { delay } from '../util/async';
import { buildSsml } from '../core/ssml';
import { getAzureEndpoint } from '../core/azure-token';
import { splitText } from '../core/text-split';
import { withRetry } from '../util/retry';
import { USER_AGENT } from '../config';

/** 单块文本最大字符数，超过此值自动分块 */
const MAX_CHUNK_SIZE = 1500;

/** 最大分块数量，超过此值拒绝合成 */
const MAX_CHUNKS = 40;

/** 批量并发数 */
const BATCH_SIZE = 3;

/** 批次间延迟（毫秒） */
const BATCH_DELAY_MS = 800;

/**
 * 请求单个音频块。
 *
 * @throws 当 HTTP 状态码异常时抛出错误
 */
async function fetchAudioChunk(params: SynthesisRequest): Promise<number[]> {
    const endpoint = await getAzureEndpoint();
    const url = `https://${endpoint.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
    const ssml = buildSsml(params);

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': endpoint.token,
            'Content-Type': 'application/ssml+xml',
            'User-Agent': USER_AGENT,
            'X-Microsoft-OutputFormat': params.outputFormat,
        },
        body: ssml,
    });

    if (!response.ok) {
        let detail = '';
        try { detail = await response.text(); } catch (_) {}
        throw makeError('api', detail ? `Azure 认知服务 ${response.status}：${detail}` : `Azure 认知服务 ${response.status} 无响应体`, detail, response.status);
    }

    return normalizeBytes(await response.blob());
}

/**
 * 请求单个音频块（带重试）。
 *
 * 对 429/5xx 等可恢复错误自动重试，最多 3 次，基础延迟 500ms，指数退避。
 */
async function fetchAudioChunkWithRetry(params: SynthesisRequest): Promise<number[]> {
    return withRetry(
        () => fetchAudioChunk(params),
        { maxRetries: 3, baseDelayMs: 500 },
    );
}

/**
 * 批量并发处理文本块。
 *
 * 每批最多 {@link BATCH_SIZE} 个并发请求，批内第 2 个起错开 200ms 发送，
 * 批次间等待 {@link BATCH_DELAY_MS} 毫秒，避免触发频率限制。
 */
async function processBatchedChunks(
    chunks: string[],
    params: SynthesisRequest,
): Promise<number[][]> {
    const results: number[][] = [];

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
            batch.map((chunk, index) => {
                const chunkParams: SynthesisRequest = { ...params, text: chunk };
                return index > 0
                    ? delay(index * 200).then(() => fetchAudioChunkWithRetry(chunkParams))
                    : fetchAudioChunkWithRetry(chunkParams);
            }),
        );
        results.push(...batchResults);

        if (i + BATCH_SIZE < chunks.length) {
            await delay(BATCH_DELAY_MS);
        }
    }

    return results;
}

/**
 * 通过 Azure 认知服务进行语音合成。
 *
 * 处理流程：
 * 1. 短文本（≤1500 字符）直接请求；
 * 2. 长文本按句子边界自动分块，批量并发请求后拼接；
 * 3. 每个请求带 3 次指数退避重试。
 *
 * @param params - 语音合成请求参数
 * @returns MP3 格式的音频字节数组
 * @throws 当文本为空、分块超限或 API 请求失败时抛出错误
 */
export async function synthesizeViaAzureCognitive(params: SynthesisRequest): Promise<number[]> {
    const cleanText = params.text.trim();
    if (!cleanText) {
        throw makeError('api', '文本内容为空');
    }

    if (cleanText.length <= MAX_CHUNK_SIZE) {
        return fetchAudioChunkWithRetry({ ...params, text: cleanText });
    }

    const chunks = splitText(cleanText, MAX_CHUNK_SIZE);
    if (chunks.length > MAX_CHUNKS) {
        throw makeError('api', `文本过长，分块数量(${chunks.length})超过限制(${MAX_CHUNKS})`);
    }

    const audioChunks = await processBatchedChunks(chunks, { ...params, text: cleanText });

    return concatBytes(audioChunks);
}
