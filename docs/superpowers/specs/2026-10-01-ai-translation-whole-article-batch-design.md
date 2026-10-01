# AI 翻译改为整篇一次请求（标记保序）设计

日期：2026-10-01
范围：`src/features/translation/{prompts,openai,providers}.ts`，仅影响 OpenAI 兼容（「AI 翻译」）provider。

## 问题

大模型翻译原本**每段一次请求**：一篇 40 段的文章 = 40 次往返，默认并发 2，
总耗时被往返次数与上游延迟主导；译文之间也拿不到全文上下文。

## 方案

整篇原文打包进**一次** completion，用 ASCII 标记 `[[n]]` 保序：

1. `prompts.ts`：`openAiTranslationBatchSystemPrompt`（在既有单段规则上追加
   「保留 `[[n]]`、不合并/不重排/不跳段」的协议）与 `openAiTranslationBatchUserPrompt`
   （`原文：` + `[[n]]\n<段>` 逐段列出）。
2. `openai.ts`：`parseOpenAiSegmentTranslations(content, count)` 严格校验标记数量与
   编号必须正好是 1..count、每段非空；任何不符（漏段、重排、被 `max_tokens` 截断）返回 `null`。
3. `providers.ts` `OpenAiProvider`：
   - 分批：默认整篇一批；超过 `OPENAI_BATCH_CHARS = 6000` 才在**段落分组边界**
     （`planBatches` 的 `groupIds`）切几批，批次之间仍受 `textKinds`/`concurrency` 约束。
   - 退回：编号不符或整批失败（429/401/403 除外）→ 该批**退回逐段请求**，
     一段坏了不拖垮整篇；逐段也失败的段逐条上报，其余照常落地。
   - 不变：同实例已成功段落复用（重试只补失败段）、同一次调用内重复文本只翻一次、
     `onBatch` 仍按段回调、失败汇总文案不变。
   - Hunyuan-MT（`isHunyuanTranslationModel`）不吃标记协议，仍逐段发送。

## 取舍

| 取舍 | 说明 |
|---|---|
| 上限 6000 字符 | 限制的是「模型一次能吐多少」：输出被 `max_tokens` 截断会浪费一整批；6000 与其它 provider 的 `DEFAULT_BATCH_CHARS` 同量级 |
| 首屏粒度 | 一次请求内的段落同时到达，不再逐段滚动补齐；批次之间仍有 `onBatch` 进度 |
| 失败面 | 整批失败比单段失败影响面大，靠「退回逐段」兜底 |

## 验证

`test:openai`（整篇一次请求、标题+正文同批、Hunyuan 逐段、429/401、并发上限、
整批失败后逐段回退、重试只补失败段、去重、标记截断回退）；
`test:translation`、`test:free-translation`、`test:apple-translation`、`test:deeplx`、
`test:feed-translation`、`test:chinese-variant`、`test:detect-language` 全绿。
