/**
 * @module util/bytes
 * @description 字节操作工具。
 *
 * 提供跨运行时的字节数据归一化、Base64 编解码和字节数组拼接能力。
 * 由于 Bob 插件运行在 JavaScriptCore 环境中，二进制数据可能以多种形式存在
 * （Array、Buffer、Blob shim、ArrayBuffer 等），本模块将这些异构数据统一转换为 `number[]`。
 */

import { makeError } from './error';

/**
 * 将各种运行时中的二进制数据同步归一化为 `number[]`（每项为 0–255 的整数）。
 *
 * 与 {@link normalizeBytes} 功能相同，但不支持异步类型（Blob / ArrayBuffer），
 * 适用于已知输入为同步类型（Array、Buffer、toByteArray 对象等）的场景。
 *
 * @param value - 待归一化的二进制数据，类型不确定
 * @returns 0–255 整数数组
 */
export function normalizeBytesSync(value: unknown): number[] {
    if (!value) return [];
    if (Array.isArray(value)) return value as number[];
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return Array.from(value);
    if (typeof (value as any).toByteArray === 'function') return (value as any).toByteArray();
    if (typeof (value as any).length === 'number' && typeof (value as any)[0] === 'number') {
        return Array.prototype.slice.call(value);
    }
    return [];
}

/**
 * 将各种运行时中的二进制数据统一归一化为 `number[]`（每项为 0–255 的整数）。
 *
 * 支持的输入类型及处理优先级：
 * 1. `null` / `undefined` → 返回空数组
 * 2. `number[]` → 直接返回
 * 3. Node.js `Buffer` → 转为数组
 * 4. 带 `toByteArray()` 方法的对象（如某些 Bob 内部类型）→ 调用该方法
 * 5. 带 `_shimBlob` 标记的 Bob Blob shim → 读取其 `bytes` 属性
 * 6. 带 `arrayBuffer()` 方法的对象（如标准 Blob / File）→ 异步读取 ArrayBuffer 后转换
 * 7. 类数组对象（有 `length` 属性）→ 逐项拷贝
 * 8. 字符串 → 按 Latin-1 逐字符取低 8 位
 * 9. 其他 → 返回空数组
 *
 * @param value - 待归一化的二进制数据，类型不确定
 * @returns Promise，解析为 0–255 整数数组
 *
 * @note 返回 Promise 是因为 `arrayBuffer()` 方法为异步操作。
 *       对于同步类型（Array、Buffer 等），Promise 会立即 resolve。
 */
export function normalizeBytes(value: unknown): Promise<number[]> {
    if (!value) return Promise.resolve([]);
    if (Array.isArray(value)) return Promise.resolve(value as number[]);
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
        return Promise.resolve(Array.from(value));
    }
    if (typeof value === 'object' && value && typeof (value as { toByteArray?: () => number[] }).toByteArray === 'function') {
        return Promise.resolve((value as { toByteArray(): number[] }).toByteArray());
    }
    if (typeof value === 'object' && value && (value as { _shimBlob?: boolean })._shimBlob) {
        return Promise.resolve(((value as { bytes?: number[] }).bytes) || []);
    }
    if (typeof value === 'object' && value && typeof (value as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer === 'function') {
        return (value as { arrayBuffer(): Promise<ArrayBuffer> }).arrayBuffer()
            .then((buf) => Array.from(new Uint8Array(buf)));
    }
    if (typeof value === 'object' && value && typeof (value as { length?: number }).length === 'number') {
        return Promise.resolve(Array.prototype.slice.call(value as ArrayLike<number>));
    }
    if (typeof value === 'string') {
        const arr: number[] = [];
        for (let i = 0; i < value.length; i++) arr.push(value.charCodeAt(i) & 0xff);
        return Promise.resolve(arr);
    }
    return Promise.resolve([]);
}

/**
 * 将字节数组编码为 Base64 字符串。
 *
 * 优先使用 Bob 运行时提供的 `$data.fromByteArray()` 方法，
 * 其次回退到 Node.js 的 `Buffer.from().toString('base64')`。
 * 若两者均不可用，则抛出错误。
 *
 * @param bytes - 待编码的字节数组（每项为 0–255 的整数）
 * @returns Base64 编码字符串
 * @throws 当运行时既不支持 `$data` 也不支持 `Buffer` 时抛出错误
 *
 * @example
 * ```ts
 * bytesToBase64([72, 101, 108, 108, 111]); // 'SGVsbG8='
 * ```
 */
export function bytesToBase64(bytes: number[]): string {
    if (typeof $data !== 'undefined' && $data && $data.fromByteArray) {
        return $data.fromByteArray(bytes).toBase64();
    }
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(bytes).toString('base64');
    }
    throw makeError('api', '当前运行时无法将音频数据转换为 base64');
}

/**
 * 将 Base64 字符串解码为字节数组。
 *
 * 兼容标准 Base64 和 Base64url 编码（`-_` 替代 `+/`，可省略 padding）。
 * 优先使用全局 `atob`（由 bob-shim.js 注入），简化实现。
 *
 * @param b64 - Base64 或 Base64url 编码的字符串
 * @returns 解码后的字节数组（每项为 0–255 的整数）
 */
export function base64ToBytes(b64: string): number[] {
    const normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(normalized);
    const bytes: number[] = [];
    for (let i = 0; i < binary.length; i++) {
        bytes.push(binary.charCodeAt(i));
    }
    return bytes;
}

/**
 * 拼接多个字节数组为一个连续数组。
 *
 * 先计算总长度预分配结果数组，避免多次扩容带来的性能开销。
 *
 * @param chunks - 待拼接的二维字节数组，每个元素为一帧的音频 payload
 * @returns 拼接后的连续字节数组
 */
export function concatBytes(chunks: number[][]): number[] {
    let length = 0;
    for (let i = 0; i < chunks.length; i++) {
        length += chunks[i].length;
    }
    const bytes = new Array<number>(length);
    let offset = 0;
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        for (let j = 0; j < chunk.length; j++) {
            bytes[offset++] = chunk[j];
        }
    }
    return bytes;
}
