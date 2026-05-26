import { delay } from '../util/async';

/**
 * @module util/retry
 * @description 通用异步重试策略，支持指数退避（Exponential Backoff）。
 *
 * 在网络请求等不稳定操作中，通过自动重试和递增延迟来提高成功率。
 * 可自定义重试条件，默认对常见可恢复错误（HTTP 429/5xx、超时、连接重置）进行重试。
 */

/**
 * 重试配置选项。
 */
export interface RetryOptions {
    /** 最大重试次数（不含首次执行），如设为 2 则最多执行 3 次（1 次原始 + 2 次重试） */
    maxRetries: number;
    /** 基础延迟（毫秒），实际延迟 = baseDelayMs × 2^attempt（指数退避） */
    baseDelayMs: number;
    /**
     * 自定义重试条件判断函数。接收捕获到的错误，返回 `true` 表示应重试，`false` 表示立即抛出。
     * 若不提供，则使用内置默认策略：对 HTTP 429、5xx、超时、ECONNRESET 等错误进行重试。
     *
     * @param error - 被捕获的错误对象
     * @returns 是否应该重试
     */
    retryOn?: (error: unknown) => boolean;
}

/**
 * 默认重试条件：判断错误是否属于可恢复类型。
 *
 * 优先检查结构化属性 `statusCode`（由 `makeError` 设置），
 * 若不存在则回退到错误消息字符串匹配。
 *
 * 以下情况视为可重试：
 * - 错误对象携带 `statusCode` 且为 429 或 5xx；
 * - 错误消息中包含 HTTP 状态码：429（限流）、500、502、503、504；
 * - 错误消息中包含 `'timeout'`（请求超时）；
 * - 错误消息中包含 `'ECONNRESET'`（连接被对端重置）；
 * - 非 Error 实例的异常（可能是网络层原始错误）。
 *
 * @param error - 捕获到的错误
 * @returns 是否应该重试
 */
const DEFAULT_RETRY_ON = (error: unknown): boolean => {
    if (!(error instanceof Error)) return true;
    const err = error as Error & { statusCode?: number };
    if (typeof err.statusCode === 'number') {
        return err.statusCode === 429 || (err.statusCode >= 500 && err.statusCode < 600);
    }
    const msg = error.message || '';
    return /(?:^|\D)(429)(?:\D|$)/.test(msg)
        || /(?:^|\D)(5\d{2})(?:\D|$)/.test(msg)
        || msg.indexOf('timeout') >= 0
        || msg.indexOf('ECONNRESET') >= 0;
};

/**
 * 带指数退避的异步重试执行器。
 *
 * 执行流程：
 * 1. 调用 `fn()` 执行目标异步操作；
 * 2. 若成功则直接返回结果；
 * 3. 若失败且满足重试条件，等待 `baseDelayMs × 2^attempt` 毫秒后重试；
 * 4. 若达到最大重试次数或不满足重试条件，则抛出最后一次的错误。
 *
 * @typeParam T - 异步操作的返回值类型
 * @param fn - 待执行的异步函数（无参数，返回 Promise）
 * @param options - 重试配置选项
 * @returns 异步操作的成功返回值
 * @throws 重试耗尽后抛出最后一次捕获的错误，或不满足重试条件时立即抛出
 *
 * @example
 * ```ts
 * const data = await withRetry(
 *   () => fetchAudioFromServer(params),
 *   { maxRetries: 3, baseDelayMs: 500 },
 * );
 * ```
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions,
): Promise<T> {
    const retryOn = options.retryOn || DEFAULT_RETRY_ON;
    let lastError: unknown;

    for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt < options.maxRetries && retryOn(error)) {
                const waitMs = options.baseDelayMs * Math.pow(2, attempt);
                await delay(waitMs);
                continue;
            }
            throw error;
        }
    }

    throw lastError;
}
