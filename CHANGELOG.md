
## v1.1.0 (2026-10-13)

### Fixes

- 更新 Edge TTS 合成端点
- 修复 Edge TTS 合成报 403 的问题：微软自 2026 年 10 月起下线旧合成端点，合成 WebSocket 迁移至 `api.msedgeservices.com/tts/cognitiveservices/websocket/v1`（Token 改以 `Ocp-Apim-Subscription-Key` 参数传递，签名与请求头不变，音频输出不变）。

## v1.0.0 (2026-05-26)

### Features

- 支持 Edge TTS、Azure 认知服务、Azure 体验服务和 OpenAI 兼容网关四种合成方案。
- 支持简体中文、繁体中文、英语、日语、韩语常用语音。
- 支持情感风格、语速、音调、音量和输出音质配置。
- 支持长文本自动分块、并发合成和音频拼接。
- 内置 429 限流和 5xx 服务端错误的指数退避重试。
