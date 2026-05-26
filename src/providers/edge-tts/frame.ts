/**
 * @file Edge WebSocket 二进制帧解析
 * @description 本文件实现了 Edge 大声朗读 WebSocket 协议返回的二进制帧的解析功能。
 *   服务端通过二进制消息流式推送合成音频数据，每条消息包含协议头部和音频负载，
 *   本文件负责从原始二进制数据中提取音频 payload。
 *
 * 二进制帧格式（Binary Frame Format）：
 * ```
 * ┌─────────────────────────────────────────────────────┐
 * │ Header Length (2 bytes, big-endian uint16)          │
 * ├─────────────────────────────────────────────────────┤
 * │ Header (Header Length bytes, text key-value pairs)  │
 * │   格式: "Path:audio\r\nContent-Type:audio/mpeg\r\n" │
 * ├─────────────────────────────────────────────────────┤
 * │ Payload (remaining bytes, audio data)               │
 * └─────────────────────────────────────────────────────┘
 * ```
 *
 * 解析流程：
 * 1. 读取前 2 字节作为 Header 长度（大端序 uint16）；
 * 2. 跳过 2 字节长度字段，读取后续 HeaderLength 字节的头部文本；
 * 3. 剩余字节即为音频 payload；
 * 4. 校验头部中的 `Path` 必须为 `'audio'`，`Content-Type` 必须为 `'audio/mpeg'`。
 */

import { makeError } from '../../util/error';
import { normalizeBytesSync } from '../../util/bytes';

/**
 * 解析帧头部的键值对文本
 * @description 将 Edge 协议的二进制帧头部字节序列解码为字符串后，
 *   按 `\r\n` 分割行，再按 `:` 分割键值对，构建为对象。
 *
 * @param headerBytes - 帧头部的字节数组（不含前 2 字节长度字段）
 * @returns 头部键值对映射表，所有键名转为小写
 */
function parseHeaders(headerBytes: number[]): Record<string, string> {
    const headers: Record<string, string> = {};
    let text = String.fromCharCode.apply(null, headerBytes);

    try {
        text = decodeURIComponent(escape(text));
    } catch (_) {
        // keep raw text if decoding fails
    }

    const lines = text.split('\r\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const index = line.indexOf(':');
        if (index < 0) continue;
        headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
    }

    return headers;
}

/**
 * 从 Edge TTS 二进制帧中提取音频 payload
 * @description 解析 Edge 大声朗读 WebSocket 返回的二进制消息帧，
 *   提取其中的音频数据部分。帧结构如下：
 *
 * ```
 * Offset  Size    Field           Description
 * ─────── ─────── ─────────────── ─────────────────────────────────
 * 0       2B      header_length   Header 区域的字节数（大端序 uint16）
 * 2       N B     header          文本格式的协议头部（N = header_length）
 * 2+N     M B     payload         音频数据（M = 总长度 - 2 - N）
 * ```
 *
 * 校验规则：
 * 1. 帧总长度必须 ≥ 2 字节（至少包含 header_length 字段）；
 * 2. `header_length + 2` 不能超过帧总长度；
 * 3. 头部中 `Path` 必须为 `'audio'`（非音频帧如元数据帧会被忽略或报错）；
 * 4. 头部中 `Content-Type` 必须存在且值为 `'audio/mpeg'`；
 * 5. 若 Content-Type 为 `'audio/mpeg'` 但 payload 为空则返回空数组（允许空帧）。
 *
 * @param frame - Bob WebSocket 接收到的原始二进制数据帧
 * @returns 音频 payload 的字节数组；若为非音频帧或空帧则返回空数组
 * @throws 当帧过短、Header 长度异常、Path 非 audio、Content-Type 缺失或不匹配时抛出错误
 */
export function extractAudioPayload(frame: unknown): number[] {
    const bytes = normalizeBytesSync(frame);
    if (bytes.length < 2) {
        throw makeError('api', 'Edge TTS 返回的二进制帧过短');
    }

    const headerLength = (bytes[0] << 8) | bytes[1];
    const headerEnd = 2 + headerLength;
    if (headerEnd > bytes.length) {
        throw makeError('api', 'Edge TTS 返回的二进制帧 header 长度异常');
    }

    const headers = parseHeaders(bytes.slice(2, headerEnd));
    const payload = bytes.slice(headerEnd);

    if (headers.path !== 'audio') {
        throw makeError('api', 'Edge TTS 返回的二进制帧不是音频帧');
    }

    if (!headers['content-type']) {
        if (payload.length === 0) {
            return [];
        }
        throw makeError('api', 'Edge TTS 返回了缺少 Content-Type 的音频数据');
    }

    if (headers['content-type'] !== 'audio/mpeg') {
        throw makeError('api', 'Edge TTS 返回了不支持的音频格式：' + headers['content-type']);
    }

    return payload;
}


