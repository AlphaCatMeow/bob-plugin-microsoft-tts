/**
 * @file Edge 大声朗读 Provider 主流程
 * @description 本文件实现了通过 Microsoft Edge 浏览器"大声朗读"功能的 WebSocket
 *   协议进行语音合成的 Provider。该方案无需 API Key，通过模拟 Edge 浏览器的
 *   WebSocket 连接获取合成音频。
 *
 * 核心流程：
 * 1. 校验 Bob 运行时是否支持 `$websocket` API（需 Bob 1.6.0+）；
 * 2. 解析输出格式（仅支持 MP3）；
 * 3. 建立 WebSocket 连接，发送语音配置和 SSML 请求；
 * 4. 接收二进制帧，提取音频数据；
 * 5. 收到 `turn.end` 信号后拼接所有音频块并返回。
 */

import type {SynthesisRequest} from '../../types';
import {makeError} from '../../util/error';
import {buildSsml} from '../../core/ssml';
import {
    buildSpeechConfig,
    buildWebSocketHeaders,
    buildWebSocketUrl,
    createConnectionId,
    makeSsmlMessage,
} from './protocol';
import {concatBytes} from '../../util/bytes';
import {extractAudioPayload} from './frame';

/**
 * 默认音频输出格式
 * @description Edge 大声朗读 WebSocket 协议支持的 MP3 输出格式。
 */
const DEFAULT_OUTPUT_FORMAT = 'audio-24khz-96kbitrate-mono-mp3';

/** WebSocket 合成全局超时时间（秒） */
const SYNTHESIS_TIMEOUT_SEC = 60;

/** WebSocket 合成全局超时时间（毫秒） */
const SYNTHESIS_TIMEOUT_MS = SYNTHESIS_TIMEOUT_SEC * 1000;

/**
 * 超时回调最小经过时间（秒）
 * @description 防止运行时定时器 shim 异常导致超时回调被提前触发。
 *   若回调触发时实际经过时间不足此阈值，则忽略本次超时。
 */
const MIN_ELAPSED_SEC = 5;

/**
 * 解析音频输出格式
 * @description 校验用户配置的输出格式，仅支持包含 `'mp3'` 的格式字符串，
 *   其他格式或空值均回退到 {@link DEFAULT_OUTPUT_FORMAT}。
 *
 * @param format - 用户配置的输出格式字符串，如 `'audio-24khz-96kbitrate-mono-mp3'`
 * @returns 有效的 MP3 输出格式字符串
 */
function resolveOutputFormat(format: string | undefined): string {
    if (!format) return DEFAULT_OUTPUT_FORMAT;
    if (format.indexOf('mp3') >= 0) return format;
    return DEFAULT_OUTPUT_FORMAT;
}

/**
 * 通过 Edge 大声朗读 WebSocket 协议进行语音合成
 * @description 使用 Bob 的 `$websocket` API 与 Microsoft Edge 大声朗读服务建立
 *   WebSocket 连接，发送 SSML 请求并接收合成音频数据。处理流程：
 *   1. 校验运行时是否支持 `$websocket` API；
 *   2. 解析输出格式并生成连接 ID；
 *   3. 建立 WebSocket 连接，设置请求头和 URL（含 Sec-MS-GEC 签名）；
 *   4. 连接建立后发送语音配置消息和 SSML 消息；
 *   5. 监听二进制数据，通过 {@link extractAudioPayload} 提取音频帧；
 *   6. 监听文本消息，收到 `Path:turn.end` 时拼接所有音频块并返回；
 *   7. 出错时关闭连接并通过 `reject` 返回错误。
 *
 * @param params - 语音合成请求参数
 * @returns MP3 格式的音频字节数组（`number[]`）
 * @throws 当运行时不支持 `$websocket`、WebSocket 连接失败、音频数据为空时抛出错误
 */
export async function synthesizeViaEdgeTts(params: SynthesisRequest): Promise<number[]> {
    if (typeof $websocket === 'undefined' || !$websocket || !$websocket.new) {
        throw makeError('api', 'Edge TTS 需要 Bob 1.6.0+ 的 $websocket API');
    }

    const outputFormat = resolveOutputFormat(params.outputFormat);

    return new Promise<number[]>((resolve, reject) => {
        const requestId = createConnectionId();
        const connectionId = createConnectionId();
        const muid = createConnectionId();
        const chunks: number[][] = [];
        let finished = false;
        let socket: BobWebSocket;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let openTime = 0;

        function cleanup(): void {
            if (timer != null) {
                clearTimeout(timer);
                timer = undefined;
            }
            if (socket && socket.close) {
                try { socket.close(); } catch (_) {}
            }
        }

        function done(err: Error | null, bytes?: number[]) {
            if (finished) return;
            finished = true;
            cleanup();
            if (err) {
                reject(err);
                return;
            }
            resolve(bytes!);
        }

        try {
            socket = $websocket!.new({
                url: buildWebSocketUrl(connectionId),
                allowSelfSignedSSLCertificates: true,
                timeoutInterval: 30,
                header: buildWebSocketHeaders(muid),
            });

            socket.listenOpen(function () {
                openTime = Date.now();
                timer = setTimeout(() => {
                    const elapsed = (Date.now() - openTime) / 1000;
                    if (elapsed < MIN_ELAPSED_SEC) return;
                    done(makeError('api', `Edge TTS 合成超时（${SYNTHESIS_TIMEOUT_SEC}s）`));
                }, SYNTHESIS_TIMEOUT_MS);
                socket.sendString(buildSpeechConfig(requestId, outputFormat));
                socket.sendString(makeSsmlMessage(requestId, buildSsml({ ...params, style: '' })));
            });

            socket.listenReceiveData(function (_, data) {
                try {
                    const payload = extractAudioPayload(data);
                    if (payload.length > 0) {
                        chunks.push(payload);
                    }
                } catch (err) {
                    done(err as Error);
                }
            });

            socket.listenReceiveString(function (_, message) {
                if (String(message).indexOf('Path:turn.end') >= 0) {
                    const bytes = concatBytes(chunks);
                    if (bytes.length === 0) {
                        done(makeError('api', 'Edge TTS 没有返回音频数据'));
                        return;
                    }
                    done(null, bytes);
                }
            });

            socket.listenError(function (_, error) {
                const detail = typeof error === 'string' ? error
                    : (error instanceof Error ? error.message : JSON.stringify(error));
                done(makeError('api', `Edge TTS WebSocket 连接失败：${detail}`, detail));
            });

            socket.open();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            done(makeError('api', `Edge TTS 合成失败：${msg}`, msg));
        }
    });
}
