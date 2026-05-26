/**
 * @module util/random
 * @description 随机标识符生成工具。
 */

/**
 * 生成 32 位大写十六进制随机字符串。
 *
 * 用于生成 WebSocket 连接 ID、请求 ID、客户端追踪 ID 等标识符。
 *
 * @returns 32 字符大写十六进制字符串，如 `'A1B2C3D4E5F6789012345678ABCDEF01'`
 */
export function randomHex32(): string {
    const chars = '0123456789ABCDEF';
    const parts: string[] = [];
    for (let i = 0; i < 32; i++) {
        parts.push(chars[Math.floor(Math.random() * 16)]);
    }
    return parts.join('');
}
