# 信息台 InfoPlat

面向 800x600 方形屏开发板的 Xiaomi Vela JS quickapp 信息集散中心。

## 作品简介

信息台 InfoPlat 是一款为小米 Vela 智能手表设计的快应用，提供新闻、天气、快递查询等实用信息聚合服务。采用简洁的卡片式 UI 设计，支持深色模式，适配 320x240 小屏设备。

## 功能特性

### 首页
- 大号时钟显示
- 天气摘要信息
- 今日头条新闻
- 历史上的今天

### 新闻页面
- 接入 CurrentsAPI 获取最新新闻
- 支持新闻列表浏览
- 点击查看详情页

### 天气页面
- 支持多城市管理（最多5个）
- 实时天气数据查询
- 天气预警信息展示
- 详细天气数据网格

### 快递页面
- 快递运单号查询
- 支持手机号后4位验证
- 物流时间线展示

### 详情页面
- 新闻全文解析
- 支持分页浏览
- 自动识别 SPA 页面

### 通用功能
- 深色/浅色模式切换
- 统一导航栏设计
- 响应式布局适配

## 项目结构

```
quickapp/hello_quickapp/
├── src/
│   ├── pages/
│   │   ├── index/          # 首页
│   │   ├── news/           # 新闻列表页
│   │   ├── detail/         # 新闻详情页
│   │   ├── weather/        # 天气查询页
│   │   └── express/        # 快递查询页
│   ├── common/
│   │   ├── services.js     # API 服务配置
│   │   ├── theme.js        # 主题管理
│   │   ├── cache.js        # 缓存工具
│   │   ├── cities.js       # 城市数据
│   │   └── tecko-r.js      # HTML 解析工具
│   ├── i18n/               # 国际化配置
│   ├── app.ux              # 应用入口
│   ├── config.js           # 应用配置
│   └── manifest.json       # 应用清单
├── package.json            # 项目依赖
└── README.md               # 项目说明
```

## API 配置

接口配置集中在 `src/common/services.js`：

- `CURRENTS_API_KEY`：CurrentsAPI key（已配置）
- `PROVIDERS.weather.key`：聚合数据天气 key（待配置）
- `PROVIDERS.express.key`：聚合数据快递 key（待配置）

天气和快递 key 为空时，界面会显示待配置提示，不阻塞新闻功能。

## 开发环境

### 依赖安装
```bash
npm install
```

### 开发调试
```bash
npm run start
```

### 构建打包
```bash
npm run build
npm run release
```

### 代码检查
```bash
npm run lint
```

## 技术栈

- **框架**：Xiaomi Vela JS QuickApp
- **构建工具**：aiot-toolkit
- **代码规范**：ESLint + Prettier + Stylelint
- **API 服务**：CurrentsAPI、UApiPro

## 适配说明

- **屏幕尺寸**：320x240 像素
- **设计宽度**：320px
- **设备类型**：watch（智能手表）
- **平台版本**：minPlatformVersion 1000

## 参赛信息

本项目参加 2026 首届 openvela AI 硬件开发者大赛，方向为快应用创新。

### 作品亮点
1. **信息聚合**：集成新闻、天气、快递三大信息服务
2. **小屏优化**：针对 320x240 手表屏幕深度优化
3. **主题切换**：支持深色/浅色模式，适应不同使用场景
4. **模块化设计**：清晰的代码结构，易于维护和扩展

## 开发日志

详细的 AI Coding 日志见 `logs/` 目录，记录了完整的开发过程。

## 许可证

本项目为参赛作品，遵循 openvela AI 应用开发挑战赛规则。