# 規則帳本: 公開子模組(下游可深層匯入之檔)

本檔收 R-PUBMOD-01. 通則與其他規則見 `rulebook.md` 之分檔索引.

## R-PUBMOD-01 下游深層匯入只限 README〈公開子模組〉公開表所列之檔; 清單之單一來源為該表, 以測試與 `src/*.mjs` 比對

- **來源**: 主控排程第 202 項(2026-10-31): 下游 w-web-task、w-web-sso、w-web-api、w-web-perm 深層匯入本套件之非公開內部檔,各自以例外登錄容忍(w-web-perm `KNOWN_DEEP`、w-web-sso 之 `EXCEPT_PROD` 與內部檔列、w-web-task `EXCEPT`、w-web-api `ALLOWED` 之「既有」列).跨套件規格 `C:\opensrcOper\dspec\輸入參數之檢測機制.md`(草稿;`checkOptRemoved` 即「V7 已移除之鍵」之檢查).
- 狀態: 已套(2026-10-31 pubmod-servorm,未提交、未發布;`package.json` 版本 1.1.23 未動).
- **規則**:
  1. 下游對本套件之深層匯入(`w-serv-orm/src/<檔>.mjs`)只限 README〈公開子模組〉之公開表所列之檔: `WServOrm.mjs`(主入口)、`baseline.mjs`、`safeKeys.mjs`、`checkOptRemoved.mjs`、`getDb.mjs`、`genTestData.mjs`.其餘 `src/*.mjs` 為內部檔(README 內部檔表逐檔寫理由),不保證穩定,改動不列入 Breaking changes.
  2. **單一來源**: README 之兩張表(公開表 5 欄: 檔、匯入路徑、匯出、用途、穩定性承諾; 內部檔表 2 欄: 檔、理由).`test/unit-publicmods.test.mjs` 把表(經 `test/tools/publicMods.mjs` 解析)與 `src/*.mjs` 實際檔案比對: 每個檔恰屬一表、表列之檔須存在、匯入路徑須為 `w-serv-orm/src/<檔>`、匯出欄須恰等於該檔實際匯出名稱(含 `default`)、公開表之檔集合須恰等於測試內之契約案登錄 `CONTRACTED`.**新增、移除或改名任一 `src/*.mjs` 須同步更新 README 兩表(與契約案),否則該測試判紅.**
  3. **升格判準**(升為公開須同時成立): (a) 出貨碼或維運腳本有正當需求(非僅測試為觀察內部); (b) 無等價之公開 API; (c) 簽名可承諾穩定(不含內部參數,如 `diag`); (d) 有契約案(行為符合 README 所載之承諾).**僅測試為組裝或觀察內部而匯入者**: 先判是否有公開路徑,有則改走公開 API,不升格.
  4. **穩定性承諾**: 匯出名稱、參數、回傳值與錯誤語意不變,須改動時先列入 README〈Breaking changes〉再改;僅表中「穩定性承諾」欄所載之範圍受保證(如錯誤訊息只保證起首之固定句).
  5. 內部檔不為下游用法而加註或改簽名;下游用法有公開路徑者,在 README〈測試組真實 procOrm〉寫明.
- **盤點指令**(可重跑,以 Grep 工具,範圍 `C:\opensrc`,`glob: **/*.{mjs,js,cjs,vue,ts}`,node_modules 預設被排除):
  - 真實 import 站點全集(排除註解、字串、模板字串內之字面): `^\s*(import\b[^`'"]*\bfrom\s*|\}\s*from\s*)['"]w-serv-orm/src/[A-Za-z_]+\.mjs['"]|=\s*await import\(['"]w-serv-orm/src/`,`output_mode: count` 求站數,`content` 列站點.
  - 非 `src/` 之深層路徑(`schema`、`dist`、`toolg`、`test`、`docs`…): 同規則之 `w-serv-orm/(schema|dist|toolg|test|docs|sgud|package|index)` 與 `from 'w-serv-orm'`(主入口 UMD)皆**零命中**(下游只深層匯入 `src/`).
- **2026-10-31 結果: 88 站(66 檔),未歸類 0**(寬鬆式改動前 93 處,排除 5 處假命中; 本輪新增之 4 行 JSDoc 範例亦不計: `w-web-perm` `unit-shipTools.test.mjs:128`(掃描夾具字串)、`unit-rowDigest.test.mjs:333`(斷言字串)、`w-web-api` `api-ormDiagSafeKeys.test.mjs:7`(註解)與 `:36`(探針模板字串)、本套件 `src/safeKeys.mjs:20`(JSDoc 範例)):

| 模組 | 判定 | w-web-task | w-web-sso | w-web-perm | w-web-api | 合計 |
|---|---|---|---|---|---|---|
| `WServOrm.mjs` | 公開(主入口,既有) | 5 | 4 | 14 | 2 | 25 |
| `baseline.mjs` | 公開(既有) | 7 | 4 | 3 | 12 | 26 |
| `safeKeys.mjs` | 公開(既有) | 3 | 3 | 3 | 3 | 12 |
| `checkOptRemoved.mjs` | **升格**(出貨碼: 包裝層預先檢查已移除之設定) | 1 | 1 | 1 | 2 | 5 |
| `getDb.mjs` | **升格**(維運腳本與離線工具: 備份、還原) | 0 | 1 | 3 | 1 | 5 |
| `genTestData.mjs` | **升格**(維運腳本與測試子行程: 產製測試資料) | 0 | 1 | 4 | 1 | 6 |
| `getMapOrm.mjs` | 不升格(僅測試與歷史取證腳本) | 0 | 4(含取證 2) | 1 | 0 | 5 |
| `getProc.mjs` | 不升格(僅測試與歷史取證腳本) | 0 | 3(含取證 1) | 1 | 0 | 4 |
| 合計 | | 16 | 21 | 30 | 21 | 88 |

  - 無下游匯入之內部檔: `getWoItems.mjs`、`getSettings.mjs`、`getDbBackupAndRecover.mjs`、`getDiagBrief.mjs`、`isOrmFail.mjs`(不升格).
- **逐模組判定理由**:
  - `checkOptRemoved.mjs` 升格: 4 個下游之出貨碼(`WWebTask.mjs:26`、`WWebApi.mjs:25`、`WWebPerm.mjs:26`、`getIgnoredOrmKeys.mjs:2`)於建構自身之前預先檢查 `opt`(判準與訊息之單一擁有者為本套件,下游不另寫);原檔註解即寫明「使用端包裝層可直接呼叫以檢查其自身之 opt」;無等價之公開入口(`WServOrm` 建構雖亦於建立 ORM 之前拋同一錯誤,但須具備完整之 `ds`、`WOrm`、`url`、`db` 並與自身建構順序耦合,而下游要在自身任何副作用之前單獨檢查: w-web-perm 須於 srLogInit 之後、WServOrm 之前記 srLog,w-web-task 之 UNIT-OR-019 要求早於建立 log 目錄與開啟資料庫).契約案 `unit-publicmods` O1-O4,既有 `unit-WServOrm` I13.
  - `getDb.mjs` 升格: 4 個下游根目錄之 `g_backupDb.mjs` 與 w-web-perm `server/tools/fromTools.mjs`、`authRefsClean.mjs`(執行破壞性維運前自動備份);實例上之 `backup(woItems)` 只回傳資料不寫檔,`getDb.backup` 之「寫 `backup-時間.json`」無等價公開 API.契約案 G1-G3,既有 `unit-getDb`、`unit-diaglog-tools`.
  - `genTestData.mjs` 升格: 4 個下游之 `g_initialTestData.mjs` 與 w-web-perm 三支測試子行程(`ormDiagChild`、`maskRawChild`、`consoleNoValuesChild`);無等價公開 API.契約案 T1-T4,既有 `unit-mapOrm`、`unit-diaglog-tools`、`unit-diaglog-wire`.
  - `getMapOrm.mjs`、`getProc.mjs` 不升格: 下游僅測試(w-web-sso `test/tools/unitProc.mjs`、`test/unit-ignoredOrmKeys.test.mjs`;w-web-perm `test/tools/unitOrm.mjs`)與 w-web-sso 兩支歷史取證腳本(`spec/evidence/`,不出貨亦不執行);其用途(一)以替身資料表組真實 `procOrm`、(二)以 `getProc` 建構期拋錯探測已移除之設定,皆有公開路徑且結果等價——(一)`WServOrm(ds, 替身WOrm, url, db).procOrm`(w-web-perm `mkCore`、w-web-sso `mkServ` 已用此寫法),(二)`checkOptRemoved` 或 `WServOrm` 建構之拋錯;等價由 `unit-publicmods` I1(同一操作序列回傳逐項相同)、I2(三條路徑對 3 鍵 × 9 值之拋錯訊息逐值相同)鎖定.另者公開將凍結 `getMapOrm(ds, woItems, optServ, diag)` 與 `getProc(mapOrm, opt, diag)` 之內部簽名(含 `diag`),而 `getMapOrm` 之簽名與行為近期已動過(2026-10-29 診斷輸出遷移曾使直接呼叫者之 `opt.logDetail`/`opt.funLog` 型別檢核行為改變,見 README Breaking changes),不宜承諾.
  - 無下游匯入者(`getWoItems`、`getSettings`、`getDbBackupAndRecover`、`getDiagBrief`、`isOrmFail`): 無需求,不升格.`getSettings` 於 README〈Diagnostic output〉有描述其診斷輸出行為,仍屬內部檔(下游無匯入).
- **測試**: `test/unit-publicmods.test.mjs`(21 案: A 組清單單一來源 3、B 組匯出一致 1、W/K/S 組既有公開模組之契約 3、O 組 `checkOptRemoved` 4、G 組 `getDb` 3、T 組 `genTestData` 4、I 組不升格之依據 3)、`test/tools/publicMods.mjs`(README 表解析與檢核之純函數).指令: `npx mocha --no-parallel test/unit-publicmods.test.mjs --timeout 180000`.
- **未納入**(本規則不管): 下游各自之匯入全表由其測試鎖定(w-web-task `unit-ormDiagLog` OD-S-03、w-web-sso `unit-diaglog` SITE-DG-011、w-web-perm `unit-ormDiagSafeKeys` SK-S1、w-web-api `unit-ormDiagLog` 之 `ALLOWED`),本套件不掃下游;下游於改引公開入口後清空各自之例外登錄(機械式後續見 2026-10-31 報告〈下游機械式後續〉).`package.json` 不加 `exports` 欄位(加了會阻擋下游一切未列之深層匯入,屬破壞性強制手段,是否採用待裁示).
