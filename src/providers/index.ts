/**
 * @file Provider 路由中心
 * @description TTS Provider 的注册、解析和调度。
 */

import type { ProviderId, SynthesisProvider, SynthesisRequest } from '../types';
import { VALID_PROVIDER_IDS } from '../types';
import { makeError } from '../util/error';
import { normalizeBytes } from '../util/bytes';
import { looksLikeAudioBytes } from '../core/audio';
import { synthesizeViaAzureCognitive } from './azure-cognitive';
import { synthesizeViaAzureTrial } from './azure-trial';
import { synthesizeViaEdgeTts } from './edge-tts';
import { synthesizeViaOpenAiGateway } from './openai-gateway';

/** Provider 映射表类型，用于测试注入自定义实现 */
export type ProviderMap = Partial<Record<ProviderId, SynthesisProvider>>;

/** 默认 Provider 注册表 */
const defaultProviders: Record<ProviderId, SynthesisProvider> = {
    'azure-cognitive': synthesizeViaAzureCognitive,
    'edge-tts': synthesizeViaEdgeTts,
    'azure-trial': synthesizeViaAzureTrial,
    'openai-gateway': synthesizeViaOpenAiGateway,
};

/** Provider 覆盖映射，供测试注入自定义实现 */
let _providerOverrides: ProviderMap = {};

/**
 * 设置 Provider 覆盖映射
 * @description 供测试注入自定义 Provider 实现，覆盖默认注册表中的 Provider。
 */
export function setProviderOverrides(overrides: ProviderMap): void {
    _providerOverrides = overrides;
}

/**
 * 解析最终使用的 Provider ID
 * @description 若 `providerId` 为空或未知则回退到 `'azure-cognitive'`；
 *   若为 `'openai-gateway'` 但未配置有效端点，也回退到 `'azure-cognitive'`。
 */
export function resolveProviderId(providerId: string | undefined, customEndpoint: string | undefined): ProviderId {
    if (!providerId || !VALID_PROVIDER_IDS.has(providerId as ProviderId)) {
        return 'azure-cognitive';
    }
    if (providerId === 'openai-gateway') {
        return customEndpoint && customEndpoint.trim().indexOf('http') === 0
            ? 'openai-gateway'
            : 'azure-cognitive';
    }
    return providerId as ProviderId;
}

/**
 * 通过 Provider 执行语音合成
 * @description 解析目标 Provider，调用其合成函数获取音频数据并校验。
 * @throws 当 Provider 未找到、音频数据为空或格式不合法时抛出错误
 */
export async function synthesizeWithProvider(
    request: SynthesisRequest,
): Promise<number[]> {
    const providerId = resolveProviderId(request.providerId, request.customEndpoint);
    const provider = _providerOverrides[providerId] || defaultProviders[providerId];
    if (!provider) {
        throw makeError('api', `未找到 TTS Provider：${providerId}`);
    }

    const bytes = await normalizeBytes(await provider({ ...request, providerId }));
    if (bytes.length === 0) {
        throw makeError('api', '后端返回的音频数据为空');
    }
    if (providerId === 'openai-gateway' && !looksLikeAudioBytes(bytes)) {
        throw makeError('api', '自建网关没有返回可播放音频，请确认填写的是 /v1/audio/speech 完整 URL');
    }
    return bytes;
}
