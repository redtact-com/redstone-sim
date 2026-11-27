package gtoracle;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import net.minecraft.SharedConstants;
import net.minecraft.core.registries.Registries;
import net.minecraft.gametest.framework.GameTestMainUtil;
import net.minecraft.gametest.framework.TestFunctionLoader;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;

// 26.3 のオラクルの入口 (docs/research/18 §4.1 の 2)。
//
// やることは 3 つだけで、ゲームのコードは書き換えない (Mod・Mixin・Java agent・ローダーなし)。
//   1. 版を決める (SharedConstants.tryDetectVersion)。決めないと以後の初期化が版を読めずに落ちる。
//      決まった版が run.sh の期待と違えば止まる (R18 §4.5「版ごとの API の揺れ」)
//   2. 自前のテスト関数のローダーを登録する (TestFunctionLoader.registerLoader)。
//      組み込みレジストリの初期化 (BuiltinTestFunctions.bootstrap) が登録済みのローダーを
//      1 回だけ回すので、Bootstrap より前に登録する。ここで Blocks などのゲームのクラスに
//      触れると初期化が先に起きてしまうので、ResourceKey もローダーが呼ばれてから作る
//   3. GameTestServer をプロセス内で起動する (GameTestMainUtil.runGameTestServer)。
//      テストは自前の名前空間の 1 本だけを選ぶ。駆動は Driver の毎 tick の状態機械が行う
//
// EULA: GameTestServer の経路は eula.txt を読まないが、EULA 自体は適用される (R18 §4.5)。
// 環境変数 GT_ORACLE_ACCEPT_EULA=true の明示の同意が無いと、何も読み込まずに止まる。
public final class OracleMain {
   static final String NAMESPACE = "gt_oracle";
   static final String FUNCTION = "drive";

   private OracleMain() {
   }

   public static void main(final String[] args) throws Exception {
      if (!"true".equals(System.getenv("GT_ORACLE_ACCEPT_EULA"))) {
         System.err.println("[gt-oracle] Minecraft の EULA (https://aka.ms/MinecraftEULA) への同意が要る。");
         System.err.println("[gt-oracle] 同意したうえで GT_ORACLE_ACCEPT_EULA=true を付けて起動すること。");
         System.exit(2);
      }

      Path plan = null;
      Path out = null;
      String universe = null;
      String packs = null;
      String expectVersion = null;
      for (int i = 0; i < args.length; i++) {
         String a = args[i];
         String v = i + 1 < args.length ? args[i + 1] : null;
         switch (a) {
            case "--plan" -> { plan = Path.of(v); i++; }
            case "--out" -> { out = Path.of(v); i++; }
            case "--universe" -> { universe = v; i++; }
            case "--packs" -> { packs = v; i++; }
            case "--expect-version" -> { expectVersion = v; i++; }
            default -> {
               System.err.println("[gt-oracle] 知らない引数: " + a);
               System.exit(2);
            }
         }
      }
      if (plan == null || out == null || universe == null || packs == null || expectVersion == null) {
         System.err.println("[gt-oracle] 使い方: --plan <plan.json> --out <結果のフォルダ> --universe <ワールドのフォルダ> --packs <データパックのフォルダ> --expect-version <版>");
         System.exit(2);
      }

      long bootStarted = System.nanoTime();
      SharedConstants.tryDetectVersion();
      String detected = SharedConstants.getCurrentVersion().name();
      if (!detected.equals(expectVersion)) {
         System.err.println("[gt-oracle] jar の版が " + detected + " で、期待の " + expectVersion + " と違う。起動コードは版ごとに確かめてから使う (R18 §4.5)");
         System.exit(3);
      }

      JsonObject planJson = JsonParser.parseString(Files.readString(plan, StandardCharsets.UTF_8)).getAsJsonObject();
      Files.createDirectories(out);
      Driver.configure(planJson, out, detected, SharedConstants.getCurrentVersion().dataVersion().version(), bootStarted);

      TestFunctionLoader.registerLoader(register -> register.accept(
         ResourceKey.create(Registries.TEST_FUNCTION, Identifier.fromNamespaceAndPath(NAMESPACE, FUNCTION)),
         Driver::start
      ));

      GameTestMainUtil.runGameTestServer(
         new String[]{"--universe", universe, "--packs", packs, "--tests", NAMESPACE + ":" + FUNCTION},
         path -> {}
      );
   }
}
