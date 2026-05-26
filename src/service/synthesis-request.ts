/**
 * @file 语音合成请求参数构建
 * @description 将 Bob 运行时传入的查询参数和选项转换为标准化的 SynthesisRequest 对象。
 */

import {defaultVoices, supportedLanguages} from '../config';
import type {BobLang, BobQuery, Locale, ProviderId, SynthesisRequest} from '../types';
import {makeError} from '../util/error';
import type {OptionBag} from '../runtime/bob-options';
import {readOption} from '../runtime/bob-options';
import {resolveProviderId} from '../providers';

/** Bob 语种代码到 Azure Locale 的映射表 */
const langMap = new Map<BobLang, Locale>(supportedLanguages);

/** 返回插件支持的语言列表 */
export function supportLanguages(): BobLang[] {
    return supportedLanguages.map(([standardLang]) => standardLang);
}

/** 将 Bob 语种代码解析为 Azure Locale，不支持时抛出错误 */
export function resolveLocale(lang: string): Locale {
    const locale = langMap.get(lang as BobLang);
    if (!locale) {
        throw makeError('unsupportLanguage', '不支持该语种');
    }
    return locale;
}

/** 从 Bob 选项中读取 Provider 标识，未知值回退到 `'azure-cognitive'` */
export function readProviderOption(options: OptionBag): ProviderId {
    const raw = readOption(options, 'provider') || undefined;
    const customEndpoint = (readOption(options, 'ttsEndpoint') || '').trim();
    return resolveProviderId(raw, customEndpoint);
}

/**
 * 构建语音合成请求参数
 * @description 将 Bob 查询参数和运行时选项组装为标准化的 {@link SynthesisRequest} 对象。
 *   各字段读取逻辑：
 *   - `providerId`：通过 {@link readProviderOption} 从选项中读取；
 *   - `text`：直接取自 Bob 查询的 `text` 字段；
 *   - `locale`：通过 {@link resolveLocale} 将 Bob 语种代码转换为 Azure Locale；
 *   - `voice`：优先读取 `"<locale>-speaker"` 选项（如 `"zh-CN-speaker"`），
 *     为空时使用 `config.ts` 中的默认发音人；
 *   - `rate` / `pitch` / `volume`：从选项中读取，默认值分别为 `'+0%'` / `'+0Hz'` / `'+0%'`；
 *   - `style`：从选项中读取，默认为 `'general'`；
 *   - `outputFormat`：从选项中读取，默认为 `'audio-24khz-48kbitrate-mono-mp3'`；
 *   - `customEndpoint`：从 `'ttsEndpoint'` 选项中读取并去除首尾空白；
 *   - `apiKey`：从 `'apiKey'` 选项中读取并去除首尾空白。
 *
 * @param query - Bob 传入的查询对象，包含待合成文本和语种
 * @param options - Bob 运行时选项包，提供用户配置项的读取能力
 * @returns 完整的语音合成请求参数对象
 */
export function createSynthesisRequest(query: BobQuery, options: OptionBag): SynthesisRequest {
    const locale = resolveLocale(query.lang);
    return {
        providerId: readProviderOption(options),
        text: query.text,
        locale,
        voice: readOption(options, `${locale}-speaker`) || defaultVoices[locale],
        rate: readOption(options, 'rate') || '+0%',
        pitch: readOption(options, 'pitch') || '+0Hz',
        volume: readOption(options, 'volume') || '+0%',
        style: readOption(options, 'style') || 'general',
        outputFormat: readOption(options, 'outputFormat') || 'audio-24khz-48kbitrate-mono-mp3',
        customEndpoint: (readOption(options, 'ttsEndpoint') || '').trim(),
    };
}
