/**
 * @module bob-options
 * @description Bob 运行时选项读取工具。
 *
 * 封装对 Bob 注入的全局变量 `$option` 的安全访问，
 * 提供类型安全的选项读取接口。
 */

/**
 * 选项键值对类型，值可能为字符串或 `undefined`（未配置时）。
 */
export type OptionBag = Record<string, string | undefined>;

/**
 * 获取 Bob 运行时注入的配置选项。
 *
 * 从 Bob 全局变量 `$option` 中读取用户在配置面板中设置的选项。
 * 若 `$option` 未定义（如非 Bob 运行环境），则返回空对象。
 *
 * @returns 选项键值对，键为配置项名称，值为配置值字符串
 */
export function getRuntimeOptions(): OptionBag {
    if (typeof $option === 'undefined' || !$option) {
        return {};
    }
    return $option;
}

/**
 * 从选项集合中安全读取指定键的值。
 *
 * @param options - 选项键值对集合
 * @param key - 待读取的配置项键名
 * @returns 配置值字符串；若键不存在或值非字符串类型，返回 `undefined`
 */
export function readOption(options: OptionBag, key: string): string | undefined {
    const value = options[key];
    return typeof value === 'string' ? value : undefined;
}
