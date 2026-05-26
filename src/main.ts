/**
 * @file Bob 插件入口文件
 * @description 本文件是 Microsoft TTS Bob 插件的入口模块，负责暴露 Bob 所需的
 *   {@link supportLanguages} 和 {@link tts} 两个导出函数。Bob 运行时会调用这两个
 *   函数来完成语种声明和语音合成。
 *
 * 工作流程：
 * 1. Bob 调用 `supportLanguages()` 获取插件支持的语言列表；
 * 2. 用户触发朗读时，Bob 调用 `tts(query, completion)`；
 * 3. `tts` 内部将 Bob 查询参数转换为 {@link SynthesisRequest}，交由对应 Provider 合成音频；
 * 4. 合成完成后通过 `completion` 回调将 Base64 音频数据返回给 Bob。
 */

require('../vendor/bob-shim.js');

import {synthesizeWithProvider} from './providers';
import {getRuntimeOptions} from './runtime/bob-options';
import {createSynthesisRequest, supportLanguages as listSupportLanguages} from './service/synthesis-request';
import {bytesToBase64} from './util/bytes';
import {completeError} from './util/error';
import type {BobLang, BobQuery, Completion,} from './types';

/**
 * 返回插件支持的语言列表
 * @description Bob 运行时通过此函数获取插件支持的语言，用于在 Bob 配置面板中展示
 *   可选语种。实际逻辑委托给 `synthesis-request.ts` 中的同名函数。
 * @returns Bob 标准语种代码数组，如 `['auto', 'zh-Hans', 'en', ...]`
 */
export function supportLanguages(): BobLang[] {
    return listSupportLanguages();
}

/**
 * Bob TTS 合成入口函数
 * @description Bob 运行时在用户触发朗读时调用此函数。内部流程：
 *   1. 从 Bob 运行时选项中读取用户配置；
 *   2. 将 Bob 查询参数转换为 {@link SynthesisRequest}；
 *   3. 通过 Provider 路由中心选择并调用对应的 TTS 后端；
 *   4. 将返回的音频字节数组转为 Base64 后通过 `completion` 回调返回给 Bob。
 *
 * @param query - Bob 传入的查询对象，包含待合成文本 `text` 和语种 `lang`
 * @param completion - Bob 提供的结果回调函数，接收 {@link CompletionPayload} 对象；
 *   成功时传入 `{ result: { type: 'base64', value: '...', raw: {} } }`，
 *   失败时传入 `{ error: { type: '...', message: '...' } }`
 *
 * @note 此函数使用 `async IIFE` + `.catch()` 模式，因为 Bob 的 `tts` 入口
 *   不支持直接返回 Promise，必须通过 `completion` 回调返回结果。
 */
export function tts(query: BobQuery, completion: Completion): void {
    void (async () => {
        const request = createSynthesisRequest(query, getRuntimeOptions());
        const bytes = await synthesizeWithProvider(request);

        completion({
            result: {
                type: 'base64',
                value: bytesToBase64(bytes),
                raw: {},
            },
        });
    })().catch((err: Error) => {
        completeError(completion, err);
    });
}
