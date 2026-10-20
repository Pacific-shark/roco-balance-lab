# 来源与许可

`public/data/bwiki-2026-10-14.json`、`public/data/team-2026-10-14.json`、`public/data/dex.json`、`data/catalog-s4-20261016-review.json`、`data/dex-image-manifest.json` 与 `docs/evidence/` 中 BWIKI 资料是洛克王国：世界 BWIKI 玩家社区数据的派生整理。原来源：

- https://wiki.biligame.com/nrc/精灵列表
- https://wiki.biligame.com/nrc/技能列表
- https://wiki.biligame.com/nrc/特性列表
- https://wiki.biligame.com/nrc/游戏描述图鉴
- https://wiki.biligame.com/nrc/克制计算器
- https://wiki.biligame.com/nrc/多多 （30 种性格名称及增减属性关系，见 `src/team-stats.mjs` 中数据映射；该映射按同一数据许可署名）
- JSON 元数据列出的 `Module:Pets/data/` 五个公开数据模块及对应修订。

作者与维护者署名为“洛克王国：世界 BWIKI 玩家社区贡献者”；具体贡献记录见各来源页面的历史。本站声明：原创文字及有权授权的整理成果按 CC BY-SA 4.0 使用。项目对此进行了字段筛选、命名规范、技能学习关系展开和完整性校验；派生资料继续采用同一许可。

许可链接：https://creativecommons.org/licenses/by-sa/4.0/
站点声明：https://wiki.biligame.com/nrc/洛克王国世界:站点声明

游戏美术、音视频、角色名称与其他游戏内容的权利归魔方工作室、腾讯游戏及相应权利人所有；社区数据许可不提供这些权利。图鉴通过 BWIKI 公开图片地址展示精灵头像与立绘，仓库保存地址清单，不复制游戏客户端资源，也不声称官方授权或合作。

图鉴配队案例整理自树池来了《洛克时报 51》及搞零王的电环水队讲解；电环水队一图流署名云云云。逐队链接和发布时间保留在 `public/data/dex.json` 的 `teams` 字段中。整理包含人工转录与本项目的玩法摘要，未复制完整视频或文章；没有独立验证作者的排名、胜率或当前环境适用性。

`src/data.mjs` 的小范围旧版数值记录保留逐条来源，未复制第三方计算器或引擎。原创程序代码采用 MIT，见 LICENSE；数据不因代码许可而改为 MIT。
