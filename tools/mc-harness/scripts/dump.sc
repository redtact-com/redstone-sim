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
__on_tick() -> (global_tick_count += 1);
fx_tickcount() -> global_tick_count;

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
fx_setup() -> (
  fx = read_file('fixture', 'shared_json');
  if(fx == null, exit('shared/fixture.json がない'));
  global_region = fx:'region';
  from = global_region:'from';
  to   = global_region:'to';
  // 領域クリア (更新抑制。前回 fixture の残骸を消す)
  without_updates(
    c_for(x = from:0, x <= to:0, x += 1,
      c_for(y = from:1, y <= to:1, y += 1,
        c_for(z = from:2, z <= to:2, z += 1,
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
