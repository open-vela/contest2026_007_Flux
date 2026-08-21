# 信息台 InfoPlat

面向 800x600 方形屏开发板的 Xiaomi Vela JS quickapp 信息集散中心。

## 当前功能

- 新闻：接入 CurrentsAPI `latest-news`，默认中文/中国新闻。
- 天气：预留聚合数据全国天气预报 API 配置位。
- 快递：预留聚合数据全球快递物流查询 API 配置位。
- 语音呼叫：预留 openvela 原生能力入口。
- TTS 播报：当前用 toast 展示播报内容，等待板端 TTS 能力接入。

## API 配置

接口配置集中在 `src/common/services.js`：

- `CURRENTS_API_KEY`：CurrentsAPI key。
- `PROVIDERS.weather.key`：聚合数据天气 key。
- `PROVIDERS.express.key`：聚合数据快递 key。

天气和快递 key 为空时，界面会显示待配置提示，不阻塞新闻功能。

## 开发

```bash
npm install
npm run start
```

## 构建

```bash
npm run build
npm run release
```

## 参赛记录

本项目按 openvela AI 应用开发挑战赛方向准备，后续提交材料建议补齐：

- 作品简介与使用场景。
- 800x600 开发板运行截图或演示视频。
- 三方 API key 的安全说明与申请方式。
- TTS/语音唤醒的板端能力适配说明。
