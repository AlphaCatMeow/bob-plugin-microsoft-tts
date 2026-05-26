/**
 * @module util/crypto
 * @description SHA-256 哈希及 HMAC-SHA256 签名的纯 JavaScript 实现。
 *
 * Bob 插件运行在 JavaScriptCore 环境中，该环境不提供 Web Crypto API
 * （即 `crypto.subtle`），因此需要无外部依赖的实现。
 * SHA-256 严格遵循 FIPS 180-4 规范；HMAC 遵循 RFC 2104。
 */

/**
 * 对 32 位无符号整数执行循环右移（circular right shift）。
 *
 * @param value - 待移位的 32 位无符号整数
 * @param bits - 右移位数（0–31）
 * @returns 循环右移后的 32 位无符号整数
 */
function rightRotate(value: number, bits: number): number {
    return (value >>> bits) | (value << (32 - bits));
}

/**
 * SHA-256 内部压缩函数，处理单个 512 位消息块。
 */
function sha256Compress(bytes: number[], offset: number, h: number[]): void {
    const k = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];

    const w = new Array<number>(64);
    for (let j = 0; j < 16; j++) {
        const o = offset + j * 4;
        w[j] = ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
    }
    for (let j = 16; j < 64; j++) {
        const s0 = (rightRotate(w[j - 15], 7) ^ rightRotate(w[j - 15], 18) ^ (w[j - 15] >>> 3)) >>> 0;
        const s1 = (rightRotate(w[j - 2], 17) ^ rightRotate(w[j - 2], 19) ^ (w[j - 2] >>> 10)) >>> 0;
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
    }

    let a = h[0], b = h[1], c = h[2], d = h[3];
    let e = h[4], f = h[5], g = h[6], hh = h[7];

    for (let j = 0; j < 64; j++) {
        const S1 = (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) >>> 0;
        const ch = ((e & f) ^ ((~e) & g)) >>> 0;
        const temp1 = (hh + S1 + ch + k[j] + w[j]) >>> 0;
        const S0 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) >>> 0;
        const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        const temp2 = (S0 + maj) >>> 0;
        hh = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
}

/**
 * 对字节数组计算 SHA-256 摘要，返回 32 字节数组。
 *
 * @param bytes - 待哈希的字节数组
 * @returns SHA-256 摘要，32 字节数组
 */
export function sha256Bytes(bytes: number[]): number[] {
    const bitLengthHigh = Math.floor((bytes.length * 8) / 0x100000000);
    const bitLengthLow = (bytes.length * 8) >>> 0;
    const padLen = bytes.length + 1;
    const totalLen = ((padLen + 8 + 63) >> 6) << 6;
    const padded = new Array<number>(totalLen);
    let idx = 0;
    for (let i = 0; i < bytes.length; i++) padded[idx++] = bytes[i];
    padded[idx++] = 0x80;
    while (idx < totalLen - 8) padded[idx++] = 0;
    padded[idx++] = (bitLengthHigh >>> 24) & 0xff;
    padded[idx++] = (bitLengthHigh >>> 16) & 0xff;
    padded[idx++] = (bitLengthHigh >>> 8) & 0xff;
    padded[idx++] = bitLengthHigh & 0xff;
    padded[idx++] = (bitLengthLow >>> 24) & 0xff;
    padded[idx++] = (bitLengthLow >>> 16) & 0xff;
    padded[idx++] = (bitLengthLow >>> 8) & 0xff;
    padded[idx++] = bitLengthLow & 0xff;

    const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    for (let i = 0; i < padded.length; i += 64) {
        sha256Compress(padded, i, h);
    }

    const result: number[] = [];
    for (let i = 0; i < 8; i++) {
        result.push((h[i] >>> 24) & 0xff);
        result.push((h[i] >>> 16) & 0xff);
        result.push((h[i] >>> 8) & 0xff);
        result.push(h[i] & 0xff);
    }
    return result;
}

/**
 * 计算字符串的 SHA-256 摘要，返回大写十六进制字符串。
 *
 * @param message - 待哈希的原始字符串（仅支持 Latin-1 范围，即码点 ≤ 0xFF）
 * @returns SHA-256 摘要，64 字符大写十六进制字符串
 */
export function sha256Hex(message: string): string {
    const bytes: number[] = [];
    for (let i = 0; i < message.length; i++) {
        bytes.push(message.charCodeAt(i) & 0xff);
    }
    const digest = sha256Bytes(bytes);
    return digest.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

(globalThis as Record<string, unknown>).__sha256Bytes = sha256Bytes;


