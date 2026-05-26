/**
 * @module util/error
 * @description 错误处理工具。
 *
 * 提供 Bob 插件规范的错误构造与回调封装。Bob 插件要求通过 `completion({ error: {...} })`
 * 格式返回错误信息，本模块将标准 Error 对象与 Bob 错误格式之间的转换进行了统一封装。
 */

import type { BobError } from '../types';

/**
 * 构造 Bob 风格错误的内部选项结构。
 */
interface MakeErrorOptions {
    /** 错误类型标识，Bob 规范中常见的有 `'api'`、`'network'`、`'languages'` 等 */
    type: string;
    /** 错误描述信息，将展示给用户 */
    message: string;
    /** 附加调试信息（注意：字段名 `addtion` 为 Bob 插件规范拼写，非 typo） */
    addtion?: unknown;
    /** HTTP 状态码，用于重试策略等结构化判断 */
    statusCode?: number;
}

/**
 * 构造一个同时兼容标准 Error 和 Bob 错误格式的错误对象。
 *
 * 创建的 Error 实例同时携带以下属性：
 * - `type` / `_type` — 错误类型标识
 * - `message` / `_message` — 错误描述信息
 * - `addtion` / `_addtion` — 附加调试信息
 * - `statusCode` / `_statusCode` — 可选的 HTTP 状态码
 *
 * 其中以 `_` 前缀的属性用于 `completeError` 函数读取，
 * 不带前缀的属性便于在标准 Error 上下文中使用。
 *
 * @param type - 错误类型标识，如 `'api'`、`'network'`、`'languages'`
 * @param message - 错误描述信息
 * @param addtion - 可选的附加信息（如原始错误对象、HTTP 响应体等）
 * @param statusCode - 可选的 HTTP 状态码，用于重试策略等结构化判断
 * @returns 兼容 Bob 格式的 Error 实例
 *
 * @example
 * ```ts
 * throw makeError('api', '语音合成请求失败', { statusCode: 503 }, 503);
 * ```
 */
export function makeError(type: string, message: string, addtion?: unknown, statusCode?: number): Error & MakeErrorOptions {
    const err = new Error(message) as Error & MakeErrorOptions;
    err.type = type;
    err.message = message;
    err.addtion = addtion;
    err.statusCode = statusCode;
    (err as unknown as Record<string, unknown>)._type = type;
    (err as unknown as Record<string, unknown>)._message = message;
    (err as unknown as Record<string, unknown>)._addtion = addtion;
    (err as unknown as Record<string, unknown>)._statusCode = statusCode;
    return err;
}

/**
 * 将错误对象转换为 Bob 规范格式并通过 completion 回调返回。
 *
 * Bob 插件要求错误通过 `completion({ error: { type, message, addtion } })` 格式返回。
 * 本函数从 Error 实例中提取 `_type`、`_message`、`_addtion` 属性（由 `makeError` 设置），
 * 若这些属性不存在则使用合理的默认值。
 *
 * @param completion - Bob 插件的完成回调函数，接收 `{ error: BobError }` 格式的参数
 * @param err - 捕获到的错误对象，通常由 `makeError` 构造或为标准 Error
 *
 * @example
 * ```ts
 * try {
 *   await doSomething();
 *   completion({ result: { ... } });
 * } catch (err) {
 *   completeError(completion, err);
 * }
 * ```
 */
export function completeError(
    completion: (payload: { error: BobError }) => void,
    err: Error & Partial<{ _type: string; _message: string; _addtion: unknown; _statusCode?: number }>,
): void {
    completion({
        error: {
            type: err._type || 'unknown',
            message: err._message || err.message || '未知错误',
            addtion: err._addtion,
        },
    });
}
