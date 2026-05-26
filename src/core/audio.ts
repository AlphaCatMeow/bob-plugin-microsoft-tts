/**
 * @module core/audio
 * @description 音频格式转换和检测工具。
 *
 * 提供 PCM 原始音频数据到 WAV 格式的封装，以及基于文件头魔数（magic bytes）的
 * 音频格式快速检测。适用于 Bob 插件在 JavaScriptCore 环境中处理 TTS 返回的音频数据。
 */

/**
 * 向字节数组指定偏移位置写入 16 位无符号小端序（Little-Endian）整数。
 *
 * @param bytes - 目标字节数组
 * @param offset - 写入起始偏移量
 * @param value - 待写入的 16 位无符号整数值
 */
function setUInt16LE(bytes: number[], offset: number, value: number): void {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
}

/**
 * 向字节数组指定偏移位置写入 32 位无符号小端序（Little-Endian）整数。
 *
 * @param bytes - 目标字节数组
 * @param offset - 写入起始偏移量
 * @param value - 待写入的 32 位无符号整数值
 */
function setUInt32LE(bytes: number[], offset: number, value: number): void {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
    bytes[offset + 2] = (value >>> 16) & 0xff;
    bytes[offset + 3] = (value >>> 24) & 0xff;
}

/**
 * 向字节数组指定偏移位置写入 ASCII 字符串（逐字符写入字节值）。
 *
 * @param bytes - 目标字节数组
 * @param offset - 写入起始偏移量
 * @param value - 待写入的 ASCII 字符串
 */
function writeAscii(bytes: number[], offset: number, value: string): void {
    for (let i = 0; i < value.length; i++) {
        bytes[offset + i] = value.charCodeAt(i);
    }
}

/**
 * 将原始 PCM 音频数据封装为 WAV 格式字节数组。
 *
 * 生成的 WAV 文件参数固定为：
 * - 单声道（channels = 1）
 * - 16 位采样深度（bitsPerSample = 16）
 * - 采样率由参数 `sampleRate` 指定
 *
 * WAV 文件结构（共 44 字节头 + PCM 数据）：
 * - RIFF 头（12 字节）：`'RIFF'` + 文件大小 + `'WAVE'`
 * - fmt 子块（24 字节）：音频格式参数
 * - data 子块（8 字节头 + PCM 数据）：实际音频采样数据
 *
 * @param pcmBytes - 原始 PCM 音频采样数据（16 位有符号小端序字节序列）
 * @param sampleRate - 采样率（Hz），如 16000、24000、48000
 * @returns 完整的 WAV 格式字节数组，可直接写入文件或进行 Base64 编码
 *
 * @example
 * ```ts
 * const wavData = rawPcmToWavBytes(pcmBuffer, 24000);
 * ```
 */
export function rawPcmToWavBytes(pcmBytes: ArrayLike<number>, sampleRate: number): number[] {
    const channels = 1;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * channels * bitsPerSample) / 8;
    const blockAlign = (channels * bitsPerSample) / 8;
    const dataSize = pcmBytes.length;
    const bytes = new Array<number>(44 + dataSize);

    writeAscii(bytes, 0, 'RIFF');
    setUInt32LE(bytes, 4, 36 + dataSize);
    writeAscii(bytes, 8, 'WAVE');
    writeAscii(bytes, 12, 'fmt ');
    setUInt32LE(bytes, 16, 16);
    setUInt16LE(bytes, 20, 1);
    setUInt16LE(bytes, 22, channels);
    setUInt32LE(bytes, 24, sampleRate);
    setUInt32LE(bytes, 28, byteRate);
    setUInt16LE(bytes, 32, blockAlign);
    setUInt16LE(bytes, 34, bitsPerSample);
    writeAscii(bytes, 36, 'data');
    setUInt32LE(bytes, 40, dataSize);

    for (let i = 0; i < dataSize; i++) {
        bytes[44 + i] = pcmBytes[i] & 0xff;
    }

    return bytes;
}

/**
 * 通过文件头魔数（magic bytes）快速判断字节数据是否为已知音频格式。
 *
 * 支持检测的格式：
 * - **RIFF**（`0x52494646`）：WAV 音频
 * - **ID3**（`0x494433`）：MP3 音频（ID3 标签头）
 * - **0xFF 0xE0+**：MP3 音频帧同步字
 * - **OggS**（`0x4F676753`）：OGG 音频
 *
 * @param bytes - 待检测的字节数据
 * @returns 若为已知音频格式返回 `true`，否则返回 `false`
 *
 * @note 仅检查前 4 字节的魔数，不保证数据完整性和格式正确性。
 *       此函数适用于快速过滤，避免将非音频数据误传给音频解码器。
 */
export function looksLikeAudioBytes(bytes: ArrayLike<number>): boolean {
    if (!bytes || bytes.length < 4) {
        return false;
    }

    const b0 = bytes[0] & 0xff;
    const b1 = bytes[1] & 0xff;
    const b2 = bytes[2] & 0xff;
    const b3 = bytes[3] & 0xff;
    if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46) return true;
    if (b0 === 0x49 && b1 === 0x44 && b2 === 0x33) return true;
    if (b0 === 0xff && (b1 & 0xe0) === 0xe0) return true;
    if (b0 === 0x4f && b1 === 0x67 && b2 === 0x67 && b3 === 0x53) return true;
    return false;
}
