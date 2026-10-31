# 規則帳本

本檔為套件設計與開發階段之規則帳本,為要求程式碼須長成什麼樣,或由規格產出之測試(項目/說明/流程)有哪些,包含軸、單一擁有者、已知限制、破壞性變更紀錄,以及對應是哪些測試檔案或指令等,由agent自行編列、擴充與維護.

- 系列規格: `C:\opensrc\開源-JS-015-4-w-orm-lmdb\w-orm-lmdb\w-orm系列套件統一規格.md`(2026-10-12 由 `資料庫函數回傳定義計算.md` 改名).以下「規格」即指此檔: save、del 回與輸入等長之逐筆陣列(T2);整批性錯誤 reject,逐筆失敗為該筆 ok:0 並附 err(T4);主鍵補值(T6);查無為 ok:1、n:0,不是失敗.
- 全套測試: `npm test`(即 `mocha --parallel "test/*.test.mjs" --timeout 180000`),2026-10-22 第 110 項(run01)新增 3 檔共 115 案(`unit-baseline` 57、`unit-guard` 41、`api-guard` 17,另有共用工具 `test/tools/memOrm.mjs`)並與其他受影響之 8 檔(unit-WServOrm、unit-mapOrm、api-procOrm、unit-pkcast、api-pkcast、unit-objcopy、api-objcopy、unit-getDb)合跑為 287 案 0 失敗(全套由主控於最末輪凍結碼跑),此前,2026-10-20 第 82 項修正(run02)後為 9 檔 173 案(全數通過;新增 unit-objcopy 之 S01、S01b、S02~S15 共 16 案與 api-objcopy 之 A27、A27b、A28、A29 共 4 案; P04、C02、C04 依規則 5 續、7 更新訊息預期,未放寬; eslint 0 錯誤; 新案對修前 HEAD 跑出 14 紅(P04、C02、C04、S01、S01b、S02~S07、A27、A27b、A28),S08 在 HEAD 即綠),2026-10-19 第 3 次執行後為 9 檔 153 案(全數通過;新增 D07、D07b、D08、A25、A26,D05d 擴充 WeakRef 與 FinalizationRegistry,N03 補比較運算子之陣列值;eslint 0 錯誤),同日第 2 次執行為 9 檔 148 案(全數通過;新增 A20、A21、A22、A23、A24、D05、D05b、D05c、D05d、D06,P04、P05、P07、C04 依規則 6 更動;eslint 0 錯誤),同日第 1 次執行為 9 檔 138 案(全數通過;第 33 項批 3 新增 N10、N11、A19;依賴升至 wsemi ^1.9.20、w-orm-lowdb ^1.0.32 後,A12、A13、A14 因真 lowdb 拒收 `$not`、`$nor` 而紅,已改為白名單內條件),2026-10-17 為 9 檔 135 案(全數通過,0 pending,K01 已於 wsemi 1.9.18 啟用;含 `test/all.test.mjs` 之佔位 1 案;2026-10-14 為 7 檔 100 案,2026-10-13 為 5 檔 81 案).單檔: `npx mocha --no-parallel test/<檔名> --timeout 180000`.測試共用小工具(替身 ORM、getReject、quiet、same)在 `test/tools/ormStub.mjs`(`createStub` 每次各自持有 calls 與 plan,不共用模組層狀態),`unit-objcopy`、`api-objcopy` 使用;較早之測試檔各有自己的複本,未改.
- Lint: `npx eslint src/*.mjs test/*.mjs schema/*.mjs schema/tables/*.mjs g-mOrm.mjs`.eslint 8 以目錄為參數會回 No files matching,須給檔案樣式.
- 測試暫存落 `test/_tmp/<案名>/`,於 after 刪除.getDb 之 backup 寫至模組載入時之 cwd,故寫檔案例以子程序執行,cwd 設於 `test/_tmp/unit-getDb/`(`test/unit-getDb.test.mjs` 之 runChild).
- 行號以 2026-10-13 之工作樹為準(HEAD `9b3417d` 即 1.1.9,另含其後未發布之修改,見破壞性變更紀錄之「1.1.9 之後」).例外: `src/getMapOrm.mjs`、`src/WServOrm.mjs` 之行號於 2026-10-14 依各規則之盤點指令重取(R-ID-02、R-MIX-01、R-INPUT-01 實作後兩檔行號全面移位),2026-10-17 於 R-OBJ-01 實作後、同日 run02(woName 與 find 深度)後再度全面重取(各規則之行號,含 R-ERR-01、R-MSG-01、R-PERITEM-01、R-ID-02、R-MIX-01、R-INPUT-01、R-OBJ-01、R-XSS-01、R-AUTH-01、R-INST-01),以 2026-10-17 之工作樹為準.**2026-10-19 第 2 次執行(R-OBJ-01 規則 6)後,`src/getMapOrm.mjs` 約第 123 行之後的行號整體位移(MSGS_BAD_KEY +2 行,isPlainObj 之前 +2、其後逐步增加,select 呼叫等後段約 +154);只有 R-OBJ-01 之站點全集已依盤點指令重取,其餘規則所載 getMapOrm 行號請依各規則之盤點指令重取,不要照抄舊值.2026-10-20 第 82 項(run02)後,R-OBJ-01 站點全集再依最終程式重取(`getMapOrm.mjs` 全面再位移,約 1475 行),其餘規則之行號同樣不可照抄.**

## 分檔索引(2026-10-22 依全域 §14 整理;各節原文逐字搬移,節號與標題不變)

| 類 | 檔 | 內容(規則編號) |
|---|---|---|
| 錯誤、訊息與輸入形狀 | `rulebook_error-input.md` | R-ERR-01、R-MSG-01、R-PERITEM-01、R-ORM-RESULT-01(ORM 回傳失敗之全站點盤點,2026-10-23 orm-run05 新增)、R-INPUT-01、R-MIX-01 |
| 主鍵、條件(find)與 XSS | `rulebook_id-find.md` | R-ID-01、R-ID-02、R-WL-01、R-XSS-01 |
| 使用端物件之迭代與複製 | `rulebook_obj.md` | R-OBJ-01 |
| 擴充函數、授權、實例、備份還原與相容 | `rulebook_runtime.md` | R-HOOK-01、R-AUTH-01、R-INST-01、R-DB-01、R-COMPAT-01 |
| 破壞性變更紀錄、其他已知限制與 delAll 使用須知 | `rulebook_changes.md` | 破壞性變更紀錄、其他已知限制、〔delAll 使用須知(使用者裁示)〕 |
| 診斷輸出(console)與對外錯誤值之遮罩(2026-10-28 orm-run01 新增;2026-10-29 mig-servorm 遷移至 wsemi 共用模組) | `rulebook_diag.md` | R-DIAG-01:**依主控 dspec `C:\opensrcOper\dspec\診斷輸出與遮罩.md` 與 wsemi 帳本 R-DIAG-01**(遮罩、拷貝、摘要、出口由 wsemi `getDiag` 系列實作,本套件不另寫);本套件只宣告秘密來源、代碼集合、`safeKeys` 與站點(`src/getDiagBrief.mjs`);站點全集 195 站(診斷出口 66、外來值 diag.err 15、ORM 原文段 diag.mask 4、固定詞彙不包 107、轉拋 3);測試 `unit-diaglog-wire`(語料 wire 案)、`unit-diaglog`(P01-P52 接線)、`unit-diaglog-tools`、`api-diaglog`;**R-DIAG-02(2026-10-30 a-servorm)**:不匯入 wsemi 底線內部檔、公開 `SAFE_KEYS`(`src/safeKeys.mjs`,下游 `genDiagFunLog(write, { safeKeys })` 之單一來源)、刪 `getUrlSecrets`;測試 `unit-diagsafe` |
| 計時器相關函數之觀察回調與以事件同步之測試(2026-10-29 tm-servorm 新增;規格 `C:\opensrcOper\dspec\計時器相關函數之觀察回調與測試.md`) | `rulebook_timer.md` | R-TRACE-01(擴充函數生效之 `opt.onTrace`、`test/tools/hookKit.mjs` 以事件同步、效能時限類改 CPU 時間斷言 `test/tools/cpuBound.mjs`;站點全集 1 處;處理清單與 A 類不改清單) |
| 公開子模組(下游可深層匯入之檔;2026-10-31 pubmod-servorm 新增) | `rulebook_pubmod.md` | R-PUBMOD-01(下游深層匯入只限 README〈公開子模組〉公開表所列之 6 檔: `WServOrm.mjs`、`baseline.mjs`、`safeKeys.mjs`、`checkOptRemoved.mjs`、`getDb.mjs`、`genTestData.mjs`;清單單一來源為 README 表,`test/unit-publicmods.test.mjs` 比對 `src/*.mjs`;升格判準;下游 88 站盤點與逐模組判定) |
| 多人同時編輯之寫入共用核心(2026-10-22 第 110 項 run01 新增) | `rulebook_concurrency.md` | R-BASELINE-01、R-LOCK-01、R-GUARD-01、R-ONLYMOD-01、R-KEEPUSER-01(2026-10-23 run02 新增) |
