/**
 * @module util/async
 * @description 异步流程控制工具。
 */

/**
 * 返回一个在指定毫秒数后 resolve 的 Promise，用于异步延迟。
 *
 * @param ms - 延迟时间（毫秒）
 * @returns 在 `ms` 毫秒后 resolve 的 Promise
 */
export function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
