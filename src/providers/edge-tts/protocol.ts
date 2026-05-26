/**
 * @file Edge WebSocket 协议构建
 * @description 本文件实现了 Microsoft Edge "大声朗读"功能所使用的 WebSocket 协议，
 *   包括连接 URL 构建、请求头生成、消息格式封装和 Sec-MS-GEC 安全签名机制。
 *
 * 协议概述：
 * - WebSocket 端点：`wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1`
 * - 认证方式：URL 查询参数中携带 `TrustedClientToken` 和 `Sec-MS-GEC` 签名
 * - 消息格式：基于文本的自定义协议，以 `\r\n` 分隔的键值对头部 + 正文
 * - 消息类型：`speech.config`（语音配置）和 `ssml`（合成请求）
 *
 * Sec-MS-GEC 签名机制：
 * 1. 获取当前 Unix 时间戳（秒）；
 * 2. 加上 Windows Ticks 偏移量（11644473600 秒），将 Unix 时间戳转换为 Windows FileTime 的秒数；
 * 3. 向下取整到 300 秒（5 分钟）的整数倍；
 * 4. 乘以 10^7 转换为 Windows Ticks（100 纳秒单位）；
 * 5. 拼接 `TrustedClientToken` 后进行 SHA-256 哈希，得到签名值。
 */

import { sha256Hex } from '../../util/crypto';
import { randomHex32 } from '../../util/random';
import { USER_AGENT } from '../../config';

/**
 * Edge 大声朗读服务的受信客户端 Token
 * @description 从 Edge 浏览器中提取的固定 Token，用于 Sec-MS-GEC 签名计算。
 *   该 Token 是 Edge 浏览器与 Bing 语音服务通信时的身份标识。
 */
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';

/**
 * Sec-MS-GEC 签名的版本标识
 * @description 对应 Edge 浏览器特定版本的签名版本号。
 */
const SEC_MS_GEC_VERSION = '1-143.0.3650.75';

/**
 * Unix 时间戳到 Windows FileTime 的偏移量（秒）
 * @description Windows FileTime 的起始时间为 1601-01-01 UTC，
 *   而 Unix 时间戳的起始时间为 1970-01-01 UTC，
 *   两者之间的差值为 11644473600 秒。
 */
const WINDOWS_TICKS_OFFSET = 11644473600;

/**
 * 计算 Sec-MS-GEC 签名
 * @description 根据 Edge 浏览器的签名算法生成安全令牌。算法步骤：
 *   1. 将 Unix 时间戳加上 Windows Ticks 偏移量；
 *   2. 向下取整到 300 秒（5 分钟）的整数倍，实现签名的时间窗口化；
 *   3. 乘以 10^7 转换为 Windows Ticks（100 纳秒精度）；
 *   4. 将 Ticks 字符串与 {@link TRUSTED_CLIENT_TOKEN} 拼接后进行 SHA-256 哈希。
 *
 * @param unixTimestamp - 当前 Unix 时间戳（秒）
 * @returns SHA-256 哈希的十六进制字符串
 */
function getSecMsGec(unixTimestamp: number): string {
    const seconds = unixTimestamp + WINDOWS_TICKS_OFFSET;
    const roundedSeconds = seconds - (seconds % 300);
    const ticks = String(Math.floor(roundedSeconds)) + '0000000';
    return sha256Hex(ticks + TRUSTED_CLIENT_TOKEN);
}

/**
 * 生成随机连接 ID
 * @description 生成 32 位大写十六进制随机字符串，用作 WebSocket 连接的
 *   `ConnectionId`、`RequestId` 和 `MUID` 等标识符。
 *
 * @returns 32 位大写十六进制字符串，如 `'A1B2C3D4E5F6789012345678ABCDEF01'`
 */
export function createConnectionId(): string {
    return randomHex32();
}

/**
 * 构建 Edge 大声朗读 WebSocket 连接 URL
 * @description 拼接包含认证参数的完整 WebSocket URL。URL 查询参数包括：
 *   - `TrustedClientToken`：受信客户端 Token；
 *   - `Sec-MS-GEC`：基于当前时间戳计算的安全签名；
 *   - `Sec-MS-GEC-Version`：签名版本号；
 *   - `ConnectionId`：连接唯一标识符。
 *
 * @param connectionId - WebSocket 连接的唯一标识符，由 {@link createConnectionId} 生成
 * @returns 完整的 WebSocket 连接 URL
 */
export function buildWebSocketUrl(connectionId: string): string {
    const timestamp = Math.floor(Date.now() / 1000);
    return 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'
        + '?TrustedClientToken=' + TRUSTED_CLIENT_TOKEN
        + '&Sec-MS-GEC=' + getSecMsGec(timestamp)
        + '&Sec-MS-GEC-Version=' + SEC_MS_GEC_VERSION
        + '&ConnectionId=' + connectionId;
}

/**
 * 构建 WebSocket 连接请求头
 * @description 模拟 Edge 浏览器的 WebSocket 握手请求头，包括来源、User-Agent
 *   和 Cookie 等字段，以确保服务端接受连接。
 *
 * @param muid - Microsoft User ID，用于 Cookie 字段，由 {@link createConnectionId} 生成
 * @returns WebSocket 连接请求头键值对
 */
export function buildWebSocketHeaders(muid: string): Record<string, string> {
    return {
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
        'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'Sec-WebSocket-Version': '13',
        'User-Agent': USER_AGENT,
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': 'muid=' + muid + ';',
    };
}

/**
 * 生成 Edge 协议格式的日期时间字符串
 * @description 生成符合 Edge 大声朗读协议时间戳格式的 UTC 日期字符串，
 *   格式为 `'Day DD Mon YYYY HH:MM:SS GMT+0000 (Coordinated Universal Time)'`。
 *
 * @returns UTC 格式的时间戳字符串
 */
function edgeDateString(): string {
    const date = new Date();
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const pad = (value: number) => String(value).padStart(2, '0');

    return days[date.getUTCDay()] + ' '
        + months[date.getUTCMonth()] + ' '
        + pad(date.getUTCDate()) + ' '
        + date.getUTCFullYear() + ' '
        + pad(date.getUTCHours()) + ':'
        + pad(date.getUTCMinutes()) + ':'
        + pad(date.getUTCSeconds())
        + ' GMT+0000 (Coordinated Universal Time)';
}

/**
 * 构建 Edge 协议格式的消息
 * @description 按照 Edge 大声朗读 WebSocket 协议的消息格式封装消息。
 *   消息结构为以 `\r\n` 分隔的头部键值对 + 空行 + 正文：
 *   ```
 *   X-RequestId:<requestId>\r\n
 *   Content-Type:<contentType>\r\n
 *   X-Timestamp:<timestamp>\r\n
 *   Path:<path>\r\n
 *   \r\n
 *   <body>
 *   ```
 *
 * @param path - 消息路径，如 `'speech.config'` 或 `'ssml'`
 * @param requestId - 请求唯一标识符
 * @param contentType - 正文内容类型，如 `'application/json'` 或 `'application/ssml+xml'`
 * @param body - 消息正文内容
 * @param appendTimestampBugSuffix - 是否在时间戳末尾追加 `'Z'` 后缀；
 *   Edge 协议中 SSML 消息的时间戳需要追加 `'Z'`，这是一个协议兼容性处理
 * @returns 格式化后的协议消息字符串
 */
function makeMessage(path: string, requestId: string, contentType: string, body: string, appendTimestampBugSuffix?: boolean): string {
    const timestamp = edgeDateString() + (appendTimestampBugSuffix ? 'Z' : '');
    return 'X-RequestId:' + requestId + '\r\n'
        + 'Content-Type:' + contentType + '\r\n'
        + 'X-Timestamp:' + timestamp + '\r\n'
        + 'Path:' + path + '\r\n\r\n'
        + body;
}

/**
 * 构建语音配置消息
 * @description 生成 `Path:speech.config` 类型的消息，用于在 WebSocket 连接建立后
 *   首先发送，告知服务端所需的音频输出格式和元数据选项。
 *
 * @param requestId - 请求唯一标识符
 * @param outputFormat - 音频输出格式，如 `'audio-24khz-96kbitrate-mono-mp3'`
 * @returns 语音配置消息字符串
 */
export function buildSpeechConfig(requestId: string, outputFormat: string): string {
    return makeMessage('speech.config', requestId, 'application/json', JSON.stringify({
        context: {
            synthesis: {
                audio: {
                    metadataoptions: {
                        sentenceBoundaryEnabled: false,
                        wordBoundaryEnabled: false,
                    },
                    outputFormat: outputFormat,
                },
            },
        },
    }));
}

/**
 * 构建 SSML 合成请求消息
 * @description 生成 `Path:ssml` 类型的消息，包含待合成的 SSML 内容。
 *   此消息在语音配置消息之后发送，触发服务端开始语音合成。
 *
 * @param requestId - 请求唯一标识符
 * @param ssml - SSML 格式的语音合成标记语言字符串
 * @returns SSML 合成请求消息字符串
 *
 * @note 时间戳末尾会追加 `'Z'` 后缀，这是 Edge 协议对 SSML 消息的特殊要求
 *   （可能是协议实现中的一个 bug，但需要兼容）。
 */
export function makeSsmlMessage(requestId: string, ssml: string): string {
    return makeMessage('ssml', requestId, 'application/ssml+xml', ssml, true);
}
