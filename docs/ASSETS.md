# 默认素材

深海背景由项目作者使用 AI 生成并提供，公开版保留原图。公开版未包含原私人版本的照片、头像、音乐录音或环境音录音。

| 路径 | 内容与来源 |
| --- | --- |
| public/images/avatar-ai.svg、avatar-user.svg | 本次整理编写的通用几何头像 |
| public/icon-192.png、icon-512.png | 由 scripts/generate-default-assets.js 生成的波浪图标 |
| public/images/deep-sea-bg.png | 项目作者提供的 AI 生成深海背景，保留原始文件；生成脚本不会覆盖它 |
| audio/ocean.wav、rain.wav、wind.wav | 同一脚本生成的噪声信号，非实地录音 |
| public/images/life-bathymetry.svg | 项目现有的矢量等深线图形 |
| 页面内联 SVG、CSS 图形 | 项目界面代码 |

本次新增图形和生成脚本随项目使用 MIT 许可证。现有项目代码与矢量图形的权属仍需项目作者在发布前确认。第三方 npm 依赖使用各自许可证；项目许可证不覆盖使用者另行加入的素材。

背景音乐由使用者自行提供，位置为 public/audio/bgm.mp3。默认不附带音乐文件，点击唱片时会显示添加提示。仓库提供合成环境音素材，当前页面没有环境音播放控件；素材并非原版录音。

档案页默认留空并显示“导入立绘”，已移除原人物线条轮廓。用户导入的立绘单独保存在被 Git 忽略的 `uploads/` 目录中，不属于默认公开素材。
