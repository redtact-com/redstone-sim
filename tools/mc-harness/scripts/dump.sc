// dump.sc — 実機 ground truth ダンプ用 scarpet アプリ
//
// ホスト側 (runner/generate.ts) が rcon 経由で以下を駆動する:
//   /script load dump
//   /script in dump run fx_setup()          … shared/fixture.json を読み without_updates で設置
//   /script in dump run fx_settle()         … 全ブロックに update をかけ authored 状態の安定性を確認
//   /script in dump run fx_dump(<t>)        … 対象領域を走査し tick t のスナップショットを蓄積
//   /script in dump run fx_save('<name>')   … 蓄積結果を shared/result.json へ書き出し
//
// 注意: scarpet 内から run('tick step 1') 等を呼ぶと「コマンド実行中の run() は
// 遅延実行される」(Auxiliary.md) ため同期性が保てない。tick step / player 操作は
// 全てホスト側 rcon から直接発行する (README「駆動方式」参照)。

__config() -> {'scope' -> 'global', 'stay_loaded' -> true};

global_results = [];
global_region = null;

// ── __on_tick 発火実験用カウンタ (README に結果記録) ─────────────
global_tick_count = 0;
fx_tickcount() -> global_tick_count;
// __on_tick の本体はファイル末尾 (キャプチャ機構と一体) に置く

// ── ブロック状態の正規化文字列 ('name[k=v,...]'、キーはソート) ──
_canon(x, y, z) -> (
  b = block(x, y, z);
  if(air(b), return(null));
  name = replace(str(b), 'minecraft:', '');
  props = block_state(b);
  ks = sort(keys(props));
  if(length(ks) == 0,
    name,
    str('%s[%s]', name, join(',', map(ks, str('%s=%s', _, get(props, _)))))
  )
);

// ── 領域走査: {'x,y,z' -> canon} (air は含めない) ────────────────
_scan_region() -> (
  from = global_region:'from';
  to   = global_region:'to';
  res = {};
  c_for(x = from:0, x <= to:0, x += 1,
    c_for(y = from:1, y <= to:1, y += 1,
      c_for(z = from:2, z <= to:2, z += 1,
        s = _canon(x, y, z);
        if(s != null, put(res, str('%d,%d,%d', x, y, z), s))
      )
    )
  );
  res
);

// ── fixture 設置 ─────────────────────────────────────────────────
// **掃除だけ**を先に行う (#240)。
// 掃除と設置を続けてやると、**前回の実行が残した予約 tick がキューに残ったまま**になり、
// 同じ回路を置き直しても発火して結果が変わる (予約は座標 + ブロック種で照合されるので、
// 同じ種類を置き直すと当たってしまう)。実測: 同条件で 2 回撮ると 6396 中 242 座標が食い違い、
// 予約の読み取りも 11 件 vs 91 件とばらついた。
// 掃除 → **数十 tick 空回し**して予約を枯らす → 設置、の順にすると一致する。
fx_clear() -> (
  fx = read_file('fixture', 'shared_json');
  if(fx == null, exit('shared/fixture.json がない'));
  global_region = fx:'region';
  cl = if(has(fx, 'clear'), fx:'clear', global_region);
  from = cl:'from'; to = cl:'to';
  pad = 8; pady = 6;
  without_updates(
    c_for(x = from:0 - pad, x <= to:0 + pad, x += 1,
      c_for(y = from:1 - pady, y <= to:1 + pady, y += 1,
        c_for(z = from:2 - pad, z <= to:2 + pad, z += 1,
          set([x, y, z], 'air')
        )
      )
    )
  );
  'ok'
);

fx_setup() -> (
  fx = read_file('fixture', 'shared_json');
  if(fx == null, exit('shared/fixture.json がない'));
  global_region = fx:'region';
  // 掃除範囲は 'clear' があればそちら (無ければ region)。
  // capture.ts が keep で region を縮めたときに **回路全体** を渡してくる。
  // 縮んだ region だけを掃除すると、前回置いたブロックが region のすぐ外に
  // 残って実機側だけに効いてしまう (最小化が偽の食い違いを追いかける)
  cl = fx:'clear';
  if(cl == null, cl = global_region);
  from = cl:'from';
  to   = cl:'to';
  // 領域クリア (更新抑制。前回 fixture の残骸を消す)。
  // ★ 領域を +8(x,z)/+6(y) パディングして掃除する。region ちょうどしか消さないと、
  //   直前に生成した大領域 fixture の残骸 (領域外) が残り、ダスト接続形状を汚染する
  //   (例: pulse-gen(z<=2)→comparator-compare(z<=1) で [1,1,2] 残留 dust に south 接続)。
  pad = 8; pady = 6;
  without_updates(
    c_for(x = from:0 - pad, x <= to:0 + pad, x += 1,
      c_for(y = from:1, y <= to:1 + pady, y += 1,
        c_for(z = from:2 - pad, z <= to:2 + pad, z += 1,
          set([x, y, z], 'air')
        )
      )
    )
  );
  // authored 状態をそのまま無更新設置
  without_updates(
    for(fx:'blocks',
      bl = _;
      if(length(bl:'props') == 0,
        set(bl:'pos', bl:'name'),
        set(bl:'pos', bl:'name', bl:'props')
      )
    )
  );
  global_results = [];
  'ok'
);

// ── 安定化: 領域内全ブロックに block update をかける ─────────────
// authored 状態が真に安定なら何も起きない。ズレがあれば後続の
// settle ステップ中に補正が走り、ホスト側の authored 照合で検出される。
fx_settle() -> (
  from = global_region:'from';
  to   = global_region:'to';
  c_for(x = from:0, x <= to:0, x += 1,
    c_for(y = from:1, y <= to:1, y += 1,
      c_for(z = from:2, z <= to:2, z += 1,
        if(!air(block(x, y, z)), update([x, y, z]))
      )
    )
  );
  'ok'
);

// ── tick スナップショット蓄積 ────────────────────────────────────
fx_dump(t) -> (
  global_results += {'tick' -> t, 'blocks' -> _scan_region()};
  'ok'
);

// ── 結果書き出し ─────────────────────────────────────────────────
fx_save(name) -> (
  write_file('result', 'shared_json', {
    'name' -> name,
    'mc_world_time' -> system_info('world_time'),
    'ticks' -> global_results
  });
  'ok'
);

// ════════════════════════════════════════════════════════════════════
// 大型実回路のキャプチャ (#240)
//
// 既存の fx_dump は **毎 tick フル スナップショット** を溜めるので、
// 6393 ブロック x 201 tick で result.json が 115.9MB になる (実測)。
// キャプチャ側は前 tick との**差分だけ**を溜める。
//
// tick 送りは `__on_tick` に載せる。README の「scarpet からは tick を進められない」
// は正しい (game_tick() は freeze 中に進まないことを実測) が、
// **`/tick step N` の各 tick で __on_tick は 1 回ずつ発火する**ので、
// ホストは `tick step N` を 1 回撃つだけで N tick 分の差分が採れる
// (実測: tick step 20 → カウンタ +20 / さらに tick step 50 → +50)。
// これで 200 tick が rcon 1 コマンドで済む (従来は 400 往復 x 186ms)。
// ════════════════════════════════════════════════════════════════════

global_cap_on = false;      // 記録中か
global_cap_prev = {};       // 前 tick の状態 (差分の基準)
global_cap_frames = [];     // [{'tick' -> t, 'changes' -> [{'pos','block'}]}]
global_cap_tick = 0;        // 記録開始からの tick 番号
global_cap_players = [];    // [{'tick','name','pos','on_ground'}]
global_cap_watch = [];      // 位置を記録するプレイヤー名

// 前回との差分を取る (消えたものは 'air')
_cap_diff(prev, cur) -> (
  changes = [];
  for(pairs(cur),
    k = _:0; v = _:1;
    if(get(prev, k) != v, changes += {'pos' -> k, 'block' -> v})
  );
  for(pairs(prev),
    k = _:0;
    if(!has(cur, k), changes += {'pos' -> k, 'block' -> 'air'})
  );
  changes
);

// プレイヤー位置の記録 (泡柱で運ばれる様子を追うため。#239)
_cap_players(t) -> (
  for(global_cap_watch,
    p = player(_);
    if(p != null,
      global_cap_players += {
        'tick' -> t, 'name' -> _,
        'pos' -> query(p, 'pos'),
        'on_ground' -> query(p, 'on_ground')
      }
    )
  )
);

// 記録開始。region は fx_setup 済みのものを使う。
//
// **初期状態 (authored) はここで撮る** (#248)。差分の基準 global_cap_prev と
// **同じ 1 回のスキャン**を使うのが肝で、こうすると
// 「authored ≡ 記録開始時点」が構造的に保証される。
// 以前は別関数 fx_cap_authored を先に呼んでいたが、その後に
// 「ピストンが動き終わるまで待つ」ループが tick を進めていたため、
// **initial state が記録の基準より古い**キャプチャが出来ていた。
// ずれたぶんの変化はどの frame にも現れないので、
// sim 側は永久に追いつけず「sim のバグ」に見える (#248 で 5 ブロック下流まで波及した)。
fx_cap_start(watch, name) -> (
  if(global_region == null, exit('fx_setup が先'));
  global_cap_on = true;
  base = _scan_region();
  global_cap_prev = base;
  write_file('authored', 'shared_json', {'name' -> name, 'blocks' -> base});
  global_cap_frames = [];
  global_cap_players = [];
  global_cap_tick = 0;
  global_cap_watch = watch;
  _cap_players(0);
  length(base)
);

// 記録停止 (入力を挟むときに一時停止する用途)
fx_cap_stop() -> (global_cap_on = false; 'ok');
fx_cap_resume() -> (global_cap_on = true; 'ok');

// 記録中の tick 番号 (ホスト側が入力の tick を合わせるのに使う)
fx_cap_tick() -> global_cap_tick;

// 入力を適用した直後にホストから呼ぶ。**その tick の状態を撮り直す**
// (規約: state[t] = 「tick t の ST フェーズ完了後、inputs[tick==t] 適用直後」)
fx_cap_reframe() -> (
  cur = _scan_region();
  ch = _cap_diff(global_cap_prev, cur);
  if(length(ch) > 0,
    // 同じ tick の frame があれば**そこへ足す** (frame が同 tick で 2 つあると
    // 突き合わせ側が片方を捨ててしまう)。
    // scarpet の `+` はリスト同士だと**要素ごとの加算**なので連結には使えない。
    // 長さが違うと 'Cannot add two lists of uneven sizes' で落ちる (実機で踏んだ)
    n = length(global_cap_frames);
    if(n > 0 && global_cap_frames:(n - 1):'tick' == global_cap_tick,
      merged = global_cap_frames:(n - 1):'changes';
      for(ch, merged += _);
      put(global_cap_frames, n - 1, {'tick' -> global_cap_tick, 'changes' -> merged}),
      global_cap_frames += {'tick' -> global_cap_tick, 'changes' -> ch}
    );
    global_cap_prev = cur
  );
  length(ch)
);

__on_tick() -> (
  global_tick_count += 1;
  if(global_cap_on,
    global_cap_tick += 1;
    cur = _scan_region();
    ch = _cap_diff(global_cap_prev, cur);
    if(length(ch) > 0,
      global_cap_frames += {'tick' -> global_cap_tick, 'changes' -> ch};
      global_cap_prev = cur
    );
    _cap_players(global_cap_tick)
  )
);

// 記録の書き出し。authored (tick 0 の状態) も一緒に返す
fx_cap_save(name) -> (
  write_file('capture', 'shared_json', {
    'name' -> name,
    'ticks' -> global_cap_tick,
    'frames' -> global_cap_frames,
    'players' -> global_cap_players
  });
  [global_cap_tick, length(global_cap_frames), length(global_cap_players)]
);

// (fx_cap_authored は廃止した。初期状態は fx_cap_start が
//  差分の基準と同じスキャンから書き出す — #248)

// コンテナの中身を一括投入する (#240)。
// generate.ts の `/item replace block` は 1 スロット 1 コマンド + sleep 80ms で、
// 大型回路では致命的に遅い。inventory_set なら 5400 スロットで 28ms (実測)
fx_items() -> (
  fx = read_file('fixture', 'shared_json');
  n = 0;
  for(fx:'items',
    it = _;
    for(it:'slots',
      s = _;
      inventory_set(it:'pos', s:'slot', s:'count', s:'id');
      n += 1
    )
  );
  n
);

// コンテナの中身を読み出す (回路ファイルに残すため)
fx_read_items() -> (
  from = global_region:'from'; to = global_region:'to';
  out = [];
  c_for(x = from:0, x <= to:0, x += 1,
    c_for(y = from:1, y <= to:1, y += 1,
      c_for(z = from:2, z <= to:2, z += 1,
        sz = inventory_size([x, y, z]);
        if(sz != null && sz > 0,
          slots = [];
          c_for(s = 0, s < sz, s += 1,
            v = inventory_get([x, y, z], s);
            if(v != null, slots += {'slot' -> s, 'id' -> str(v:0), 'count' -> v:1})
          );
          if(length(slots) > 0, out += {'pos' -> [x, y, z], 'slots' -> slots})
        )
      )
    )
  );
  write_file('items', 'shared_json', {'items' -> out});
  length(out)
);

// コンテナの中身をコンパレーター強度 s (0-15) 相当にする (#236 の入力を実機で作る)。
// f = 総個数 / 容量、signal = floor(f*14)+1 なので count = ceil((s-1)*容量/14)
//
// **注意**: `inventory_set` は vanilla の `Container.setItem` → `setChanged` を通らないので、
// これだけではコンパレーターが更新されない (空にしても出力が前の値のまま残る — 実測)。
// **slot 0 の最終的な中身だけはホスト側が `/item replace block` で置き直す**こと。
// 戻り値の [スロット数, slot0 の個数] はそのために返している
fx_set_signal(pos, s) -> (
  sz = inventory_size(pos);
  if(sz == null, exit('コンテナではない'));
  c_for(i = 0, i < sz, i += 1, inventory_set(pos, i, 0));
  first = 0;
  if(s > 0,
    cap = sz * 64;
    n = max(1, ceil((s - 1) * cap / 14));
    c_for(i = 0, i < sz && n > 0, i += 1,
      c = min(n, 64);
      inventory_set(pos, i, c, 'cobblestone');
      if(i == 0, first = c);
      n = n - c
    )
  );
  [sz, first]
);

// 領域内で「動いている最中」のピストンを数える (#244)。
//
// **動作中に撮り始めると再現できないキャプチャになる**。moving_piston は
// 運んでいる中身が BlockEntity 内にあって blockstate に出ないので、
// sim 側で復元できない。撮り始める前にこれが 0 になるまで待つ。
fx_moving() -> (
  from = global_region:'from'; to = global_region:'to';
  n = 0;
  c_for(x = from:0, x <= to:0, x += 1,
    c_for(y = from:1, y <= to:1, y += 1,
      c_for(z = from:2, z <= to:2, z += 1,
        if(str(block(x, y, z)) == 'moving_piston', n += 1)
      )
    )
  );
  n
);
