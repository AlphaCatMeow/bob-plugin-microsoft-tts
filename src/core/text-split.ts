/**
 * @module core/text-split
 * @description 长文本分块工具。
 *
 * 将超长文本按句子边界拆分为适合 TTS API 限制的块，
 * 避免单次请求超过服务端字符数上限。
 */

/**
 * 将文本按句子边界拆分为不超过 `maxChunkSize` 字符的块。
 *
 * 拆分规则：
 * - 以中文句号、感叹号、问号、换行符为句子边界；
 * - 单句超过 `maxChunkSize` 时强制按长度截断；
 * - 相邻短句合并直到接近上限。
 *
 * @param text - 待拆分的文本
 * @param maxChunkSize - 每块最大字符数，默认 1500
 * @returns 文本块数组，每块长度 ≤ maxChunkSize
 */
export function splitText(text: string, maxChunkSize: number = 1500): string[] {
    const chunks: string[] = [];
    const sentences = text.split(/[。！？\n]/);
    let currentChunk = '';

    for (let i = 0; i < sentences.length; i++) {
        const trimmed = sentences[i].trim();
        if (!trimmed) continue;

        if (trimmed.length > maxChunkSize) {
            if (currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = '';
            }
            for (let j = 0; j < trimmed.length; j += maxChunkSize) {
                chunks.push(trimmed.slice(j, j + maxChunkSize));
            }
        } else if ((currentChunk + trimmed).length > maxChunkSize) {
            if (currentChunk) {
                chunks.push(currentChunk.trim());
            }
            currentChunk = trimmed;
        } else {
            currentChunk += (currentChunk ? '。' : '') + trimmed;
        }
    }

    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }

    return chunks.filter((chunk) => chunk.length > 0);
}
