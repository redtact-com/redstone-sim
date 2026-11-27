package gtoracle;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.commands.CommandSource;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.level.GameType;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;

// fixture の入力を 26.3 のサーバ側の入口へ入れる (docs/research/18 §4.4)。
//
// - use: 偽の ServerPlayer を 1 人作り、当たりの位置と面を明示して ServerPlayerGameMode.useItemOn を呼ぶ。
//   パケット処理 (ServerGamePacketListenerImpl.handleUseItemOn) が距離などを確かめた後に呼ぶのと同じ入口である。
//   視線の計算が無いので、今のハーネスの狙点・遮蔽・落下・spawn の失敗の罠が無い。
//   GameTestHelper.pullLever と pressButton は通常の使用の確かめを飛ばすので使わない。
//   偽プレイヤーは GameTestHelper.makeMockServerPlayer で作る (世界には入れない。R18 §4.5)。
//   手は空で、しゃがまない。今のハーネスの carpet の use once と同じく、空の手でブロックを使う経路を通る
// - setblock・summon・kill・item: 今のハーネスと同じコマンドの文字列を、プロセス内のコマンドの入口
//   (Commands.performPrefixedCommand) で実行する。rcon と同じコマンドの処理を通り、待ちが無い
//
// 入力が効かなかった (use が何もしなかった・コマンドが失敗した) ときは例外にする。
// 黙って進むと「何も起きない」系列を正解として書いてしまう (今のハーネスの #242 の穴と同じ)。
// それ以外の action (step・container・tp・lectern) は O2 で写す。gen-datapack.ts が先に止める
final class Inputs {
   private final GameTestHelper helper;
   private final ServerLevel level;
   private final MinecraftServer server;
   private ServerPlayer player;

   Inputs(final GameTestHelper helper) {
      this.helper = helper;
      this.level = helper.getLevel();
      this.server = this.level.getServer();
   }

   JsonObject apply(final JsonObject input) {
      String action = input.get("action").getAsString();
      BlockPos p = Driver.pos(input.getAsJsonArray("pos"));
      JsonObject log = new JsonObject();
      log.addProperty("tick", input.get("tick").getAsInt());
      log.addProperty("action", action);
      log.add("pos", input.getAsJsonArray("pos"));
      switch (action) {
         case "use" -> log.addProperty("result", this.use(p));
         case "setblock" -> {
            if (!input.has("block")) {
               throw new IllegalArgumentException("setblock に block が無い");
            }
            log.add("command", this.command("setblock " + xyz(p) + " " + input.get("block").getAsString()));
         }
         case "summon" -> log.add("command", this.command("summon minecart " + (p.getX() + 0.5) + " " + p.getY() + " " + (p.getZ() + 0.5)));
         case "kill" -> log.add("command", this.command(
            "kill @e[type=minecart,x=" + p.getX() + ",y=" + p.getY() + ",z=" + p.getZ() + ",distance=..2]"));
         case "item" -> {
            int slot = input.has("slot") ? input.get("slot").getAsInt() : 0;
            int count = input.has("count") ? input.get("count").getAsInt() : 1;
            String item = input.has("item") ? input.get("item").getAsString() : "minecraft:stone";
            log.add("command", this.command("item replace block " + xyz(p) + " container." + slot + " with " + item + " " + count));
         }
         default -> throw new UnsupportedOperationException("action " + action + " はまだ写していない (O2)");
      }
      return log;
   }

   /**
    * 定義の items をコンテナに入れる。数値は旧形式 (丸石を slot 0 に n 個)、配列はスロット指定 (#194)。
    * 今のハーネスと同じく /item replace の経路を通す
    */
   void fillContainer(final BlockPos p, final JsonElement items) {
      List<String[]> specs = new ArrayList<>();
      if (items.isJsonPrimitive()) {
         int n = items.getAsInt();
         if (n > 0) {
            specs.add(new String[]{"0", "minecraft:cobblestone", Integer.toString(n)});
         }
      } else {
         JsonArray arr = items.getAsJsonArray();
         for (JsonElement e : arr) {
            JsonObject it = e.getAsJsonObject();
            String id = it.get("id").getAsString();
            specs.add(new String[]{it.get("slot").getAsString(), id.contains(":") ? id : "minecraft:" + id, it.get("count").getAsString()});
         }
      }
      for (String[] s : specs) {
         this.command("item replace block " + xyz(p) + " container." + s[0] + " with " + s[1] + " " + s[2]);
      }
   }

   private String use(final BlockPos p) {
      if (this.player == null) {
         this.player = (ServerPlayer)this.helper.makeMockServerPlayer(GameType.SURVIVAL);
      }
      // 当たりはブロックの中心・上の面。空の手での使用は当たりの位置を読まない部品だけを今は撮る
      BlockHitResult hit = new BlockHitResult(Vec3.atCenterOf(p), Direction.UP, p, false);
      InteractionResult r = this.player.gameMode.useItemOn(
         this.player, this.level, this.player.getItemInHand(InteractionHand.MAIN_HAND), InteractionHand.MAIN_HAND, hit);
      String name = r.getClass().getSimpleName();
      if (!r.consumesAction()) {
         throw new IllegalStateException("use が効かなかった: " + xyz(p) + " " + this.level.getBlockState(p) + " → " + name);
      }
      return name;
   }

   /** コマンドを 1 本実行する。結果の値と返ってきた文を記録し、失敗なら例外にする */
   private JsonObject command(final String cmd) {
      List<String> messages = new ArrayList<>();
      boolean[] done = new boolean[1];
      boolean[] ok = new boolean[1];
      int[] value = new int[1];
      CommandSource collector = new CommandSource() {
         @Override
         public void sendSystemMessage(final Component message) {
            messages.add(message.getString());
         }

         @Override
         public boolean acceptsSuccess() {
            return true;
         }

         @Override
         public boolean acceptsFailure() {
            return true;
         }

         @Override
         public boolean shouldInformAdmins() {
            return false;
         }
      };
      CommandSourceStack source = this.server.createCommandSourceStack()
         .withSource(collector)
         .withLevel(this.level)
         .withCallback((success, result) -> {
            done[0] = true;
            ok[0] = success;
            value[0] = result;
         });
      this.server.getCommands().performPrefixedCommand(source, cmd);
      JsonObject log = new JsonObject();
      log.addProperty("text", cmd);
      log.addProperty("success", done[0] && ok[0]);
      log.addProperty("result", value[0]);
      JsonArray msgs = new JsonArray();
      messages.forEach(msgs::add);
      log.add("messages", msgs);
      if (!done[0] || !ok[0]) {
         throw new IllegalStateException("コマンドが失敗した: /" + cmd + " → " + String.join(" / ", messages));
      }
      return log;
   }

   private static String xyz(final BlockPos p) {
      return p.getX() + " " + p.getY() + " " + p.getZ();
   }
}
