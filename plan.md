# Plan: 收集 NeurIPS 2026 所有 Workshop 介绍图

## 阶段1 — 获取 Workshop 完整清单
- 来源：https://danyaljj.github.io/neurips2026-workshops/ 与 OpenReview NeurIPS 2026 Workshop 组
- 产出：workshop 名称 + 官网 URL 列表

## 阶段2 — 批量发现与下载介绍图（加载 batch-download 技能）
- 对每个 workshop 官网抓取 logo / banner / og:image 等代表性图片
- 多子代理并行下载并验证
- 产出：/mnt/agents/output/neurips2026_workshop_images/ 下的图片 + manifest

## 阶段3 — 交付
- 打包图片文件夹
- 生成展示网页（website_version_manager 保存版本）
- 附清单（名称、官网、图片文件、来源URL）
# Plan v2: NeurIPS 2026 Workshop 3D 漫游展厅

## 阶段1 — 核实官网最新 workshop 列表
- 检查 neurips.cc 官方 workshop 页面，与已有清单（69个+图片81张）比对合并

## 阶段2 — 构建 3D 可漫游展厅（加载 vibecoding-webapp-swarm 技能）
- Three.js 第一人称漫游（WASD + 鼠标 / 移动端触控）
- 每个 workshop 一个展位：悬挂介绍图（已有81张）+ 名称 + 简介 + 官网链接
- 展馆式布局，可在场景中 traverse
- 委托 coder 子代理实现

## 阶段3 — 验证与交付
- 浏览器截图验证渲染与导航
- website_version_manager 保存版本
