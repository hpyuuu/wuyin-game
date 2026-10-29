BGM 放置说明
==============

1. 到 Pixabay（https://pixabay.com/music/）等免费素材站，下载一首可循环的短音频（8~20 秒为宜）。
2. 重命名为 bgm.mp3，放在本目录（assets/resources/audio/bgm.mp3）。
3. 回到 Cocos Creator，等待资源导入完成后直接运行即可。

说明：
- 没有 BGM 时游戏也能正常游玩，AudioManager 会用 0 振幅振荡器保活音频时钟。
- 打击音效完全由代码合成，不需要任何音频素材。
- 微信小游戏主包有体积限制，建议控制 BGM 在 300KB 以内；
  如需更长的 BGM，请使用远程加载或分包方案。
