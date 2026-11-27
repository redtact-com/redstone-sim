package gtoracle;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.commands.arguments.blocks.BlockStateParser;
import net.minecraft.core.BlockPos;
import net.minecraft.core.HolderLookup;
import net.minecraft.core.registries.Registries;
import net.minecraft.gametest.framework.GameTestAssertException;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.flag.FeatureFlags;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.gamerules.GameRules;
import net.minecraft.world.level.levelgen.structure.BoundingBox;
import net.minecraft.world.phys.AABB;

// テスト関数の毎 tick の呼び出しの中で、fixture を 1 本ずつ回す状態機械 (docs/research/18 §4.1 の 4)。
//
// 呼ばれる位置: GameTest の tick は MinecraftServer.tickChildren の gameTests の区画で回る。
// 全ディメンションの tick と接続の tick の後である (R18 §3.1 の 9・§4.2)。
// ここで入力を入れて、同じ呼び出しの中で範囲を読むので、tick 規約
// 「state[t] は tick t の全相の後、tick t の入力の直後」と同じ位置で撮れる。
//
// 1 本の流れ (1 行 = 呼び出しの区切り):
//   掃除 → 強制読み込み                      … 範囲と余白を無更新で空気にし、予約 tick・ブロックイベント・エンティティを消す
//   (チャンクが tick される状態になるまで待つ)
//   置く → settle の更新                    … 無更新で置き、全ブロックに近隣更新を配る (今のハーネスの fx_settle と同じ)
//   (8 tick 待つ)
//   tick -1 を撮る → tick 0 の入力 → tick 0 を撮る
//   tick t の入力 → tick t を撮る (t = 1..ticks)
//   書き出す → 掃除
//
// 落とし穴への対処 (R18 §4.5):
// - 同じ tick の処理の順が決まらない: runAtTickTime の登録表は順が決まらないので使わず、
//   処理を 1 つにまとめて GameTestSequence.thenExecuteFor の毎 tick の呼び出しに載せる
// - fixture の場所が tick されない: 範囲のチャンクを強制読み込みにし、tick される状態になってから置く
// - テストの位置が乱数: 回路はテストの構造物に置かず、fixture の絶対座標に置く
//   (ダストの更新先の集合の順は絶対座標で決まる。docs/research/09)
// - gameTime の位相: tick -1 を撮った時点の gameTime を結果に書く
// - 1 本の中で例外が出ても、記録して次の fixture へ進む。最後にまとめてテストの成否を決める
final class Driver {
   /** settle の後に進める tick 数。今のハーネスの tick step 8 と同じ */
   static final int SETTLE_TICKS = 8;
   /**
    * チャンクが tick される状態になるまで待つ上限 (壁時計)。GameTestServer は tick の間を待たずに全速で回す
    * (R18 §3.1「tick の待ち」) ので、チャンクの生成 (別スレッドで壁時計で進む) を tick の数では測れない
    */
   static final long MAX_CHUNK_WAIT_MS = 60_000L;
   /** 掃除の余白。今のハーネス (dump.sc の fx_setup) と同じく横 8・縦 6 */
   static final int PAD_XZ = 8;
   static final int PAD_Y = 6;
   /**
    * 掃除と設置の書き込みのフラグ。/setblock の strict と同じ組み合わせ (26.3 SetBlockCommand.setBlock):
    * クライアントへ送る・形状更新をしない・ドロップしない・BlockEntity の後始末をしない・設置フックを呼ばない。
    * 近隣更新のフラグは含めない
    */
   static final int STRICT = Block.UPDATE_CLIENTS | Block.UPDATE_KNOWN_SHAPE | Block.UPDATE_SUPPRESS_DROPS
      | Block.UPDATE_SKIP_BLOCK_ENTITY_SIDEEFFECTS | Block.UPDATE_SKIP_ON_PLACE;

   private static final Gson GSON = new GsonBuilder().setPrettyPrinting().disableHtmlEscaping().create();

   private static JsonObject plan;
   private static Path outDir;
   private static String mcVersion;
   private static int dataVersion;
   private static long bootStarted;

   private enum Phase { WAIT_CHUNKS, SETTLE, RECORD }

   /** 実行中の 1 本 */
   private static final class Run {
      final JsonObject def;
      final String name;
      final int ticks;
      final BlockPos from;
      final BlockPos to;
      final BoundingBox clearBox;
      final JsonArray snapshots = new JsonArray();
      final JsonArray inputLog = new JsonArray();
      final long startedNanos = System.nanoTime();
      Phase phase = Phase.WAIT_CHUNKS;
      int waited;
      long waitStartedNanos;
      long chunkWaitMs;
      int settleLeft;
      int t;
      long startGameTime;
      long placedGameTime;

      Run(final JsonObject def) {
         this.def = def;
         this.name = def.get("name").getAsString();
         this.ticks = def.get("ticks").getAsInt();
         JsonObject region = def.getAsJsonObject("region");
         this.from = pos(region.getAsJsonArray("from"));
         this.to = pos(region.getAsJsonArray("to"));
         this.clearBox = new BoundingBox(
            Math.min(from.getX(), to.getX()) - PAD_XZ, Math.min(from.getY(), to.getY()) - PAD_Y, Math.min(from.getZ(), to.getZ()) - PAD_XZ,
            Math.max(from.getX(), to.getX()) + PAD_XZ, Math.max(from.getY(), to.getY()) + PAD_Y, Math.max(from.getZ(), to.getZ()) + PAD_XZ
         );
      }
   }

   private final GameTestHelper helper;
   private final ServerLevel level;
   private final Inputs inputs;
   private final List<JsonObject> fixtures = new ArrayList<>();
   private final JsonArray summaries = new JsonArray();
   private final long firstCallNanos = System.nanoTime();
   private int next;
   private Run cur;
   private boolean finished;
   private String runError;
   private int failedFixtures;

   static void configure(final JsonObject planJson, final Path out, final String version, final int dataVer, final long bootStartedNanos) {
      plan = planJson;
      outDir = out;
      mcVersion = version;
      dataVersion = dataVer;
      bootStarted = bootStartedNanos;
   }

   /** test_function の本体。テストの tick 0 に 1 回だけ呼ばれ、以後の毎 tick の処理を登録する */
   static void start(final GameTestHelper helper) {
      Driver driver = new Driver(helper);
      int budget = plan.get("budgetTicks").getAsInt();
      // 予算を使い切ったら失敗にする。成功は onTick の中で全部を撮り終えたときだけ
      helper.startSequence()
         .thenExecuteFor(budget, driver::onTick)
         .thenFail(() -> new GameTestAssertException(Component.literal("gt-oracle: tick の予算 (" + budget + ") を使い切った"), (int)helper.getTick()));
   }

   private Driver(final GameTestHelper helper) {
      this.helper = helper;
      this.level = helper.getLevel();
      this.inputs = new Inputs(helper);
      for (JsonElement e : plan.getAsJsonArray("fixtures")) {
         this.fixtures.add(e.getAsJsonObject());
      }
   }

   private void onTick() {
      if (this.finished) {
         return;
      }
      try {
         this.step();
      } catch (Throwable e) {
         if (this.cur != null) {
            this.finishFixture(this.cur, e);
         } else {
            this.runError = describe(e);
            this.finishAll();
         }
      }
   }

   private void step() throws IOException {
      if (System.nanoTime() - this.firstCallNanos > plan.get("wallLimitMs").getAsLong() * 1_000_000L) {
         throw new IllegalStateException("全体の時間の上限 (" + plan.get("wallLimitMs").getAsLong() + " ms) を超えた");
      }
      if (this.cur == null) {
         if (this.next == 0) {
            this.checkWorld();
         }
         if (this.next >= this.fixtures.size()) {
            this.finishAll();
            return;
         }
         this.begin(this.fixtures.get(this.next++));
         return;
      }

      Run run = this.cur;
      switch (run.phase) {
         case WAIT_CHUNKS -> {
            if (!this.chunksTicking(run)) {
               if (run.waited++ == 0) {
                  run.waitStartedNanos = System.nanoTime();
               } else if (System.nanoTime() - run.waitStartedNanos > MAX_CHUNK_WAIT_MS * 1_000_000L) {
                  throw new IllegalStateException("チャンクが " + MAX_CHUNK_WAIT_MS + " ms 待っても tick される状態にならない");
               }
               return;
            }
            run.chunkWaitMs = run.waited == 0 ? 0 : (System.nanoTime() - run.waitStartedNanos) / 1_000_000L;
            this.place(run);
            run.placedGameTime = this.level.getGameTime();
            run.phase = Phase.SETTLE;
            run.settleLeft = SETTLE_TICKS;
         }
         case SETTLE -> {
            if (--run.settleLeft > 0) {
               return;
            }
            run.startGameTime = this.level.getGameTime();
            this.snapshot(run, -1);
            run.t = 0;
            this.inputsAndSnapshot(run, 0);
            run.phase = Phase.RECORD;
            if (run.t >= run.ticks) {
               this.finishFixture(run, null);
            }
         }
         case RECORD -> {
            run.t++;
            this.inputsAndSnapshot(run, run.t);
            if (run.t >= run.ticks) {
               this.finishFixture(run, null);
            }
         }
      }
   }

   /**
    * 世界が専用サーバの既定と違う所を確かめる。GameTestServer は全部の機能フラグから
    * redstone_experiments と minecart_improvements を除いて起動する (R18 §3.1) が、実際に効いている
    * フラグをここで読み、redstone_experiments が入っていたら止まる (ダストの更新順が変わるため)
    */
   private void checkWorld() {
      if (this.level.enabledFeatures().contains(FeatureFlags.REDSTONE_EXPERIMENTS)) {
         throw new IllegalStateException("redstone_experiments が有効になっている。既定の挙動を撮れない");
      }
   }

   private void begin(final JsonObject def) {
      Run run = new Run(def);
      this.cur = run;
      this.clear(run.clearBox);
      for (ChunkPos cp : chunks(run.clearBox)) {
         this.level.setChunkForced(cp.x(), cp.z(), true);
      }
   }

   private boolean chunksTicking(final Run run) {
      for (ChunkPos cp : chunks(run.clearBox)) {
         if (!this.level.areEntitiesActuallyLoadedAndTicking(cp) || !this.level.isPositionTickingWithEntitiesLoaded(cp.pack())) {
            return false;
         }
      }
      return true;
   }

   /**
    * 掃除。範囲を無更新で空気にし、その範囲の予約 tick (ブロックと液体) とブロックイベントを消し、
    * プレイヤー以外のエンティティを消す (LevelTicks.clearArea・ServerLevel.clearBlockEvents)。
    * キューを直接消すので、今のハーネスの「数十 tick の空回し」(#240) は要らない (R18 §4.1 の 4)
    */
   private void clear(final BoundingBox box) {
      BlockState air = Blocks.AIR.defaultBlockState();
      for (BlockPos p : BlockPos.betweenClosed(box.minX(), box.minY(), box.minZ(), box.maxX(), box.maxY(), box.maxZ())) {
         if (!this.level.getBlockState(p).isAir()) {
            this.level.setBlock(p, air, STRICT);
         }
      }
      this.level.getBlockTicks().clearArea(box);
      this.level.getFluidTicks().clearArea(box);
      this.level.clearBlockEvents(box);
      for (Entity e : this.level.getEntitiesOfClass(Entity.class, AABB.of(box).inflate(1.0), e -> !(e instanceof Player))) {
         e.discard();
      }
   }

   /**
    * 置く。定義の blocks を無更新で置き、全ブロックに近隣更新を配り、コンテナの中身を入れる。
    * 順は今のハーネス (generate.ts の 2) と同じで、中身を入れたらもう一度配る (#196)
    */
   private void place(final Run run) {
      HolderLookup<Block> blocks = this.level.registryAccess().lookupOrThrow(Registries.BLOCK);
      for (JsonElement e : run.def.getAsJsonArray("blocks")) {
         JsonObject b = e.getAsJsonObject();
         BlockPos p = pos(b.getAsJsonArray("pos"));
         String text = b.get("block").getAsString();
         BlockState state;
         try {
            state = BlockStateParser.parseForBlock(blocks, text, false).blockState();
         } catch (Exception ex) {
            throw new IllegalArgumentException("blockstate を読めない: " + text + " (" + ex.getMessage() + ")", ex);
         }
         this.level.setBlock(p, state, STRICT);
      }
      this.settleUpdates(run);
      boolean hadItems = false;
      for (JsonElement e : run.def.getAsJsonArray("blocks")) {
         JsonObject b = e.getAsJsonObject();
         if (b.has("items")) {
            this.inputs.fillContainer(pos(b.getAsJsonArray("pos")), b.get("items"));
            hadItems = true;
         }
      }
      if (hadItems) {
         this.settleUpdates(run);
      }
   }

   /**
    * settle の更新。範囲の空気でないブロックに、そのブロック自身を送り元とする近隣更新を 1 回ずつ配る。
    * 今のハーネスの fx_settle (scarpet の update) に当たる。走査の順も同じく x → y → z
    */
   private void settleUpdates(final Run run) {
      for (int x = run.from.getX(); x <= run.to.getX(); x++) {
         for (int y = run.from.getY(); y <= run.to.getY(); y++) {
            for (int z = run.from.getZ(); z <= run.to.getZ(); z++) {
               BlockPos p = new BlockPos(x, y, z);
               BlockState s = this.level.getBlockState(p);
               if (!s.isAir()) {
                  this.level.neighborChanged(p, s.getBlock(), null);
               }
            }
         }
      }
   }

   private void inputsAndSnapshot(final Run run, final int tick) {
      for (JsonElement e : run.def.getAsJsonArray("inputs")) {
         JsonObject in = e.getAsJsonObject();
         if (in.get("tick").getAsInt() == tick) {
            JsonObject log = this.inputs.apply(in);
            log.addProperty("gameTime", this.level.getGameTime());
            run.inputLog.add(log);
         }
      }
      this.snapshot(run, tick);
   }

   /** 範囲を読む。空気は持たない。文字列は名前空間つきのまま (TS 側で fixture の形に写す) */
   private void snapshot(final Run run, final int tick) {
      JsonObject blocks = new JsonObject();
      for (int x = run.from.getX(); x <= run.to.getX(); x++) {
         for (int y = run.from.getY(); y <= run.to.getY(); y++) {
            for (int z = run.from.getZ(); z <= run.to.getZ(); z++) {
               BlockState s = this.level.getBlockState(new BlockPos(x, y, z));
               if (!s.isAir()) {
                  blocks.addProperty(x + "," + y + "," + z, BlockStateParser.serialize(s));
               }
            }
         }
      }
      JsonObject snap = new JsonObject();
      snap.addProperty("tick", tick);
      snap.addProperty("gameTime", this.level.getGameTime());
      snap.add("blocks", blocks);
      run.snapshots.add(snap);
   }

   private void finishFixture(final Run run, final Throwable error) {
      this.cur = null;
      long wallMs = (System.nanoTime() - run.startedNanos) / 1_000_000L;
      JsonObject result = new JsonObject();
      result.addProperty("name", run.name);
      result.addProperty("oracle", "gt-oracle");
      result.addProperty("mc", mcVersion);
      result.addProperty("dataVersion", dataVersion);
      result.addProperty("placedGameTime", run.placedGameTime);
      result.addProperty("startGameTime", run.startGameTime);
      result.addProperty("chunkWaitTicks", run.waited);
      result.addProperty("chunkWaitMs", run.chunkWaitMs);
      result.addProperty("wallMs", wallMs);
      result.add("inputs", run.inputLog);
      result.add("ticks", run.snapshots);
      if (error != null) {
         result.addProperty("error", describe(error));
         this.failedFixtures++;
      }
      try {
         Files.writeString(outDir.resolve(run.name + ".json"), GSON.toJson(result) + "\n", StandardCharsets.UTF_8);
      } catch (IOException e) {
         this.failedFixtures++;
         System.err.println("[gt-oracle] 結果を書けない: " + run.name + " " + e);
      }
      // 次の 1 本に残骸を残さない。キューも一緒に消す
      try {
         this.clear(run.clearBox);
      } catch (Throwable e) {
         this.runError = "掃除に失敗: " + describe(e);
      }

      JsonObject summary = new JsonObject();
      summary.addProperty("name", run.name);
      summary.addProperty("ok", error == null);
      summary.addProperty("wallMs", wallMs);
      summary.addProperty("chunkWaitTicks", run.waited);
      summary.addProperty("chunkWaitMs", run.chunkWaitMs);
      if (error != null) {
         summary.addProperty("error", describe(error));
      }
      this.summaries.add(summary);
      System.out.println("[gt-oracle] " + run.name + ": " + (error == null ? "撮れた" : "失敗 " + describe(error)) + " (" + wallMs + " ms)");
   }

   private void finishAll() {
      this.finished = true;
      long now = System.nanoTime();
      JsonObject runJson = new JsonObject();
      runJson.addProperty("oracle", "gt-oracle");
      runJson.addProperty("mc", mcVersion);
      runJson.addProperty("dataVersion", dataVersion);
      runJson.addProperty("bootMs", (this.firstCallNanos - bootStarted) / 1_000_000L);
      runJson.addProperty("driveMs", (now - this.firstCallNanos) / 1_000_000L);
      JsonArray features = new JsonArray();
      FeatureFlags.REGISTRY.toNames(this.level.enabledFeatures()).stream().map(Object::toString).sorted().forEach(features::add);
      runJson.add("enabledFeatures", features);
      JsonObject rules = new JsonObject();
      GameRules gr = this.level.getGameRules();
      rules.addProperty("advance_time", gr.get(GameRules.ADVANCE_TIME));
      rules.addProperty("advance_weather", gr.get(GameRules.ADVANCE_WEATHER));
      rules.addProperty("spawn_mobs", gr.get(GameRules.SPAWN_MOBS));
      rules.addProperty("spawn_monsters", gr.get(GameRules.SPAWN_MONSTERS));
      rules.addProperty("random_tick_speed", gr.get(GameRules.RANDOM_TICK_SPEED));
      rules.addProperty("fire_spread_radius_around_player", gr.get(GameRules.FIRE_SPREAD_RADIUS_AROUND_PLAYER));
      runJson.add("gameRules", rules);
      runJson.add("fixtures", this.summaries);
      if (this.runError != null) {
         runJson.addProperty("error", this.runError);
      }
      try {
         Files.writeString(outDir.resolve("_run.json"), GSON.toJson(runJson) + "\n", StandardCharsets.UTF_8);
      } catch (IOException e) {
         System.err.println("[gt-oracle] _run.json を書けない: " + e);
      }
      if (this.runError != null || this.failedFixtures > 0) {
         this.helper.fail("gt-oracle: 失敗 " + this.failedFixtures + " 本" + (this.runError != null ? " / " + this.runError : ""));
      } else {
         this.helper.succeed();
      }
   }

   private static List<ChunkPos> chunks(final BoundingBox box) {
      List<ChunkPos> out = new ArrayList<>();
      for (int cx = box.minX() >> 4; cx <= box.maxX() >> 4; cx++) {
         for (int cz = box.minZ() >> 4; cz <= box.maxZ() >> 4; cz++) {
            out.add(new ChunkPos(cx, cz));
         }
      }
      return out;
   }

   static BlockPos pos(final JsonArray a) {
      return new BlockPos(a.get(0).getAsInt(), a.get(1).getAsInt(), a.get(2).getAsInt());
   }

   static String describe(final Throwable e) {
      StringWriter w = new StringWriter();
      e.printStackTrace(new PrintWriter(w));
      String[] lines = w.toString().split("\n");
      StringBuilder b = new StringBuilder();
      for (int i = 0; i < Math.min(lines.length, 6); i++) {
         if (i > 0) {
            b.append(" | ");
         }
         b.append(lines[i].trim());
      }
      return b.toString();
   }
}
