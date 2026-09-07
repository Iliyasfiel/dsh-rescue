# Prompt:把 dsh-rescue 提交到 awesome-dsh-plugin 列表

把下面整段(到 `===== 结束 =====` 为止)复制给一个 AI 助手执行即可。它自包含,不需要翻聊天记录。

===== 开始 =====

你的任务:把开源项目 dsh-rescue 提交收录到 awesome-dsh-plugin 社区列表。
先读收录规则再动手,不要凭经验猜。

## 背景(事实,无需再调研)
- 待收录仓库:`https://github.com/Iliyasfiel/dsh-rescue`(owner=Iliyasfiel,repo=dsh-rescue)
- 它已满足的硬条件:
  - 公开仓库,代码真实可用(纯 Node CLI `dsh-rescue enter/exit/status` + 惰性 dsh.bundle 插件壳);
  - 根 `package.json` 声明了 `dsh.bundle.patch: ./cordis.patch.yml`,patch 文件存在 → 可用 `dsh plugin add` 安装;
  - 仓库已加 `dsh-plugin` topic;
  - 零依赖、无构建步骤,可从源码安装(我们**不做** npm 发布,也不要创建 GitHub Release tarball——不必要)。
- 投稿条目内容已备好,见本仓库 `docs/awesome-dsh-plugin-entry.yml`(下方也有内联副本)。
- 仓库创建于 2026-09-07;规则要求仓库创建满 1 天才过 CI——执行前先核对时间,未满 1 天则告诉我不符合并停止,不要硬发。

## 第一步:读规则
用 web 读取收录指南原文:
https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md
重点关注:投稿文件格式(一个插件一个 YAML)、CI 检查项、评审关注点、常见被拒原因。

## 第二步:核对前置条件(全过才继续)
1. 仓库年龄 ≥ 1 天(规则:过滤 PR 前几分钟才建仓的;刚满或差一点就停下说明,重新提交不扣分)。
2. 用 raw 拉取检查 `https://raw.githubusercontent.com/Iliyasfiel/dsh-rescue/main/package.json`,
   确认含 `dsh.bundle`(只声明 `dsh.client` 会被 CI 拒)。
3. 描述与代码必须属实:我们写的描述提到三个命令 `enter`/`exit`/`status` 和 `dsh.bundle` 条目——都与仓库代码一致,不要改写或夸大。
4. 分类:填 `usage`(指南明确:分类不精准维护者会直接改,不会打回)。

## 第三步:提交 PR(只加一个文件,别碰其他任何条目,别手工编辑那两个 README)
1. fork `awesome-dsh-plugin/awesome-dsh-plugin` 到 Iliyasfiel 名下(网页或 gh CLI)。
2. 在 fork 的 `main` 上开新分支,例如 `add-iliyasfiel-dsh-rescue`。
3. 新建文件 `data/plugins/Iliyasfiel__dsh-rescue.yml`,内容精确如下(与 `docs/awesome-dsh-plugin-entry.yml` 一致):

```yaml
url: https://github.com/Iliyasfiel/dsh-rescue
name: Iliyasfiel/dsh-rescue
category: usage
description:
  en: 'Rescue mode for DeepSeek Harness: temporarily disable all third-party profile plugins so a conflict-broken harness can boot on a pure core and repair itself. CLI enter/exit/status plus an inert dsh.bundle entry.'
  zh: 'dsh 救援模式:临时摘除 profile 中全部第三方插件,让因冲突无法启动的 harness 以纯核心启动并自我修复;提供 enter/exit/status 命令与 dsh.bundle 入口。'
```

4. 提交并推送到 fork 的同名分支。
5. 向 `awesome-dsh-plugin/awesome-dsh-plugin` 的 `main` 开 PR,标题例如:
   `Add Iliyasfiel/dsh-rescue (usage)`
   PR 描述一句话即可(可选附上仓库链接)。

## 第四步:跟进与收尾
- 等 CI 跑完。若失败:把 CI 报错原样读出来,按提示修复**同一分支**,推送即可,不要重开 PR。
- 若维护者评论要求改描述/分类:只按点名的那一处改(通常是 description 里夸大或不准的部分),只改自己的条目文件,改完推送。
- 不要手工编辑 awesome 仓库的 README(它们是生成的);不要动别人的条目。
- 完成后向我汇报:PR 链接、CI 状态(绿/红+原因)、维护者反馈(如有)。

注意:合并前维护者会真读源码核对描述。若他们问"这是什么",就指向仓库 README 的 "Dual form / 双形态" 一节——CLI 是救援本体,插件壳是刻意惰性的生态兼容入口,二者缺一不可。

===== 结束 =====
