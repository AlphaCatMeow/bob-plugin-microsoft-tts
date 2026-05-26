/**
 * @module config
 * @description 语言和默认语音配置。
 *
 * 定义 Bob 插件支持的语言列表及其与 Azure TTS 区域标识（locale）的映射关系，
 * 以及每种语言的默认语音名称。数组顺序直接影响 Bob 配置面板中语言选项的展示顺序。
 */

import type { BobLang, Locale } from './types';

/**
 * 统一的 HTTP 请求 User-Agent 字符串。
 *
 * 模拟 Windows 平台上最新版 Microsoft Edge 浏览器的 UA，
 * 用于所有对外 HTTP 请求（Azure 认知服务、Azure 体验端点、Edge TTS 协议等）。
 */
export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0';

/**
 * Bob 语种代码到 Azure SSML / Voice locale 的映射表。
 *
 * 每项为 `[BobLang, Locale]` 元组：
 * - 第一个元素是 Bob 输入源传入的语言代码（如 `'zh-Hans'`、`'en'`）；
 * - 第二个元素是对应的 Azure TTS 区域标识（如 `'zh-CN'`、`'en-US'`）。
 *
 * 数组顺序即为 `supportLanguages()` 输出顺序，影响 Bob 配置面板的语言展示。
 */
export const supportedLanguages: Array<[BobLang, Locale]> = [
    ['auto', 'zh-CN'],
    ['zh-Hans', 'zh-CN'],
    ['zh-Hant', 'zh-TW'],
    ['en', 'en-US'],
    ['ja', 'ja-JP'],
    ['ko', 'ko-KR'],
];

/**
 * 各语言的默认语音名称映射。
 *
 * 键为 Azure locale 标识，值为对应的 Neural 语音名称。
 * 当用户未在 Bob 配置面板中指定语音时，将使用此表中的默认值。
 */
export const defaultVoices: Record<Locale, string> = {
    'zh-CN': 'zh-CN-XiaoxiaoNeural',
    'zh-TW': 'zh-TW-HsiaoChenNeural',
    'en-US': 'en-US-JennyNeural',
    'ja-JP': 'ja-JP-NanamiNeural',
    'ko-KR': 'ko-KR-SunHiNeural',
};
