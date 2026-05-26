/**
 * @module types
 * @description Bob 插件全局类型定义。
 *
 * 集中定义所有跨模块共享的接口和类型别名，包括：
 * - Bob 运行时 HTTP 请求/响应类型
 * - Bob 查询输入类型
 * - 错误与结果回调类型
 * - TTS 合成参数与请求类型
 * - 语言和 Provider 标识类型
 */

/**
 * Bob `$http.request()` 的请求选项。
 *
 * @property method - HTTP 方法，如 `'GET'`、`'POST'`
 * @property url - 请求 URL
 * @property header - 可选的请求头键值对
 * @property body - 可选的请求体，支持字符串或 JSON 对象
 * @property timeout - 可选的超时时间（毫秒）
 * @property handler - 响应回调函数，接收 `BobHttpResponse` 参数
 */
export interface BobHttpRequestOptions {
    method: string;
    url: string;
    header?: Record<string, string>;
    body?: string | Record<string, unknown>;
    timeout?: number;
    handler: (resp: BobHttpResponse) => void;
}

/**
 * Bob `$http.request()` 的响应对象。
 *
 * @property response - 可选的响应元信息
 * @property response.statusCode - HTTP 状态码
 * @property response.headers - 响应头键值对
 * @property data - 可选的已解析响应数据（通常为 JSON 对象或字符串）
 * @property rawData - 可选的原始响应数据（Bob 内部类型，可能为 Blob shim 等）
 * @property error - 可选的请求错误信息
 */
export interface BobHttpResponse {
    response?: { statusCode?: number; headers?: Record<string, string> };
    data?: unknown;
    rawData?: unknown;
    error?: unknown;
}

/**
 * Bob 插件查询输入，由 Bob 主程序传入。
 *
 * @property text - 待翻译/合成的文本内容
 * @property lang - 源语言代码（Bob 语种标识，如 `'zh-Hans'`、`'en'`）
 */
export interface BobQuery {
    text: string;
    lang: string;
}

/**
 * Bob 插件错误格式。
 *
 * 遵循 Bob 插件规范，通过 `completion({ error: BobError })` 返回。
 *
 * @property type - 错误类型标识，常见值：`'api'`、`'network'`、`'languages'`、`'unknown'`
 * @property message - 错误描述信息，将展示给用户
 * @property addtion - 可选的附加调试信息（如原始错误对象、HTTP 响应体等）
 */
export interface BobError {
    type: string;
    message: string;
    addtion?: unknown;
}

/**
 * Bob 插件成功结果格式。
 *
 * 遵循 Bob 插件规范，通过 `completion({ result: BobResult })` 返回。
 *
 * @property type - 结果类型，TTS 插件固定为 `'base64'`（Base64 编码的音频数据）
 * @property value - Base64 编码的音频数据字符串
 * @property raw - 原始数据记录，可携带额外调试信息
 */
export interface BobResult {
    type: 'base64';
    value: string;
    raw: Record<string, unknown>;
}

/**
 * Bob 插件完成回调的载荷类型。
 *
 * 成功时包含 `result`，失败时包含 `error`，二者互斥。
 */
export interface CompletionPayload {
    result?: BobResult;
    error?: BobError;
}

/**
 * Bob 插件的完成回调函数类型。
 *
 * @param payload - 结果载荷，包含 `result`（成功）或 `error`（失败）
 */
export type Completion = (payload: CompletionPayload) => void;

/**
 * Azure TTS 支持的区域标识（locale）。
 *
 * 与 Azure 语音服务 API 和 SSML `xml:lang` 属性保持一致。
 */
export type Locale = 'zh-CN' | 'zh-TW' | 'en-US' | 'ja-JP' | 'ko-KR';

/**
 * Bob 输入源传入的语种代码。
 *
 * - `'auto'`：自动检测（默认回退到中文）
 * - `'zh-Hans'`：简体中文
 * - `'zh-Hant'`：繁体中文
 * - `'en'`：英语
 * - `'ja'`：日语
 * - `'ko'`：韩语
 */
export type BobLang = 'auto' | 'zh-Hans' | 'zh-Hant' | 'en' | 'ja' | 'ko';

/**
 * TTS 服务提供商标识（单一数据源）。
 *
 * - `'azure-cognitive'`：Azure 认知服务（需 API Key）
 * - `'edge-tts'`：Edge 在线朗读（免费，无需 Key）
 * - `'azure-trial'`：Azure 试用接口
 * - `'openai-gateway'`：OpenAI 兼容网关
 */
export const PROVIDER_IDS = ['azure-cognitive', 'edge-tts', 'azure-trial', 'openai-gateway'] as const;

/** TTS 服务提供商标识类型，由 {@link PROVIDER_IDS} 自动派生 */
export type ProviderId = typeof PROVIDER_IDS[number];

/** 所有合法的 Provider ID 集合，由 {@link PROVIDER_IDS} 自动派生 */
export const VALID_PROVIDER_IDS: Set<ProviderId> = new Set(PROVIDER_IDS);

/**
 * 语音合成核心参数。
 *
 * @property text - 待合成的文本内容
 * @property voice - 语音名称，如 `'zh-CN-XiaoxiaoNeural'`
 * @property locale - 区域标识，如 `'zh-CN'`
 * @property rate - 语速调整值，如 `'+0%'`、`'+50%'`
 * @property pitch - 音调调整值，如 `'+0Hz'`、`'+50Hz'`
 * @property volume - 音量调整值，如 `'+0%'`、`'+50%'`
 * @property style - 情感风格，如 `'general'`、`'cheerful'`、`'sad'`
 * @property outputFormat - 音频输出格式，如 `'audio-16khz-128kbitrate-mono-mp3'`
 */
export interface SynthesisParams {
    text: string;
    voice: string;
    locale: Locale;
    rate: string;
    pitch: string;
    volume: string;
    style: string;
    outputFormat: string;
}

/**
 * 完整的语音合成请求，包含服务提供商连接参数。
 *
 * 继承 `SynthesisParams` 的所有字段，并附加：
 * @property providerId - TTS 服务提供商标识
 * @property customEndpoint - 自定义 API 端点 URL（仅 Azure 类服务使用）
 */
export interface SynthesisRequest extends SynthesisParams {
    providerId: ProviderId;
    customEndpoint: string;
}

/**
 * 语音合成提供者函数类型。
 *
 * 接收合成请求参数，返回异步结果（通常为音频数据）。
 *
 * @param params - 完整的语音合成请求参数
 * @returns 异步解析的合成结果
 */
export type SynthesisProvider = (params: SynthesisRequest) => Promise<number[]>;

