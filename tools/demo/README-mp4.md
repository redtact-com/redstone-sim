# demo-mp4 — fixture 再生を MP4 に撮る

```bash
npm run demo-mp4 -- <fixture名> [options]
npm run demo-mp4 -- --json <path.json> [options]
```

`demo-gif.mjs` の MP4 版。**長い動画 (100 tick 超) や人に見せる用はこちら** —
GIF より綺麗で軽い (エレベーター 160 tick / 1640x1520 で 392KB)。

## ffmpeg

PATH に `ffmpeg` があればそれを使う。無ければ `FFMPEG=<path>` で渡す:

```bash
npm i ffmpeg-static --prefix /tmp/ff
FFMPEG=/tmp/ff/node_modules/ffmpeg-static/ffmpeg npm run demo-mp4 -- ...
```

**devDependency には入れていない** (バイナリを抱き込むと配布物が重くなるため)。

## 大きい回路を綺麗に撮るコツ

- **`region` を絞ると寄れる**。fixture の `region` はカメラのフィット範囲と描画対象を
  兼ねている (`FixtureRunner.worldSnapshot`)。**回路全体は動いたまま** region だけ小さくすれば、
  147 段のガラスエレベーターでも見せたい階だけ大写しにできる
- **コマの縦横比を回路に合わせる** (`--demo-w` / `--demo-h`)。既定の 4:3 で縦長の回路を撮ると
  左右が余ってブロックが小さくなる
- **`--scale 2`** でデバイスピクセル比を上げる (720x540 の描画領域が 1440x1080 になる)
- 全体像を撮ると自動フィットが引きすぎる (奥行きを含む外接球で決めるため)。
  **`--distance` で詰める**
- 描画は software WebGL なので**ブロック数に比例して遅い**。全域を撮るときは
  `--every 2` 等でコマを間引く

## キャプチャ由来の fixture を撮る

実機キャプチャは fixture 名では引けないので、`captureToFixture` で JSON にしてから `--json` で渡す:

```ts
const fx = captureToFixture(cap, true)
fx.region = { from: [0, 57, 0], to: [7, 79, 17] }   // 見せたい範囲だけ
writeFileSync('fx.json', JSON.stringify(fx))
```
