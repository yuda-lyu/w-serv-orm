# 現況(state)

本檔只記現況: 各功能做到哪裡、對應之規則帳本條目與測試檔、已知缺口與待辦、最近一次驗證或發布之版本.過程與教訓寫入 `sgud/exp/`.接續工作先讀本檔.(2026-10-22 第 110 項 run01 新建)

- 套件: `w-serv-orm`,伺服器端 ORM 操作封裝.`package.json` 版本 1.1.16(發布由使用者處理).HEAD `425ff02` 之後有**未提交、未發布**之第 110 項 run01 與 run02 變更(見下「多人同時編輯之共用核心」,run02 為 `opt.keepUserId`),版本號與 `script.txt` 未動.
- 2026-10-23 orm-run03(小型修正輪,未提交、未發布): procOrm 之 `insert` 與 `mix` 之 add 步增判 ORM 回傳聚合物件 `ok === 0` 即固定字串 reject `failed to insert data`(見下「一、procOrm 核心」之 R-PERITEM-01 列);版本號與 `script.txt` 未動.該輪跑全套 `npm test` 318 案 0 失敗、eslint 0 錯誤.
- 2026-10-23 orm-run05(最末輪,未提交、未發布): 全站點盤點(`src/` 內 ORM 呼叫 19 站,未歸類 0;規則 R-ORM-RESULT-01,`rulebook_error-input.md`),補齊 6 站未檢查之回傳(`save`、`del`、`delAll`、`mix` 之 `del`/`diff`、`genTestData` 之 funTest 寫入對聚合形違約與 `delAll` 之全面缺漏);讀取類與狀態值類(`select`、`createStorage`、`close`)不適用;謂詞更名 `src/isOrmFail.mjs`;盤點以 `test/unit-ormsites.test.mjs` 鎖定(新增站點須先歸類).外部缺口: w-data-collector `build.mjs:100` 之 funTestAndSave 對聚合形違約未檢查(本套件不得改,待通報).全套 `npm test` 350 案 0 失敗、eslint 0 錯誤.
- 2026-10-23 orm-run04(續接 run03,未提交、未發布): 判準抽為共用謂詞(今名 `src/isOrmFail.mjs`;聚合 `ok === 0` 或逐筆陣列任一筆 `ok === 0`),procOrm 之 insert、mix 之 add 與備份還原 `recover` 共用;`recover` 之 insert 回報失敗即於該表停止並以 `Error` reject(訊息列失敗表、ORM 回傳原文與先前已寫入之表).全套 `npm test` 330 案 0 失敗、eslint 0 錯誤.
- 全套測試: `npm test`(`mocha --parallel "test/*.test.mjs" --timeout 180000`).run01 只跑新增與受影響之 10 檔、run02 加 `unit-keepuser`、`api-keepuser` 共 13 檔(309 案 0 失敗),全套由主控於最末輪凍結碼跑一次.

## 一、procOrm 核心(既有,run01 未改其行為)

| 功能 | 規則帳本 | 測試檔 | 狀態 |
|---|---|---|---|
| 錯誤型別依層、訊息英文固定句型、逐筆失敗 reject | R-ERR-01、R-MSG-01、R-PERITEM-01(`rulebook_error-input.md`) | `unit-WServOrm`、`unit-mapOrm`、`api-procOrm` | 已套 |
| insert 與 mix 之 add: ORM 回報失敗(聚合 `ok === 0`〔run03〕、逐筆陣列任一筆 `ok === 0`〔run04〕,違約之 ORM)即固定字串 reject,不回成功;mix 之 add 失敗立即 reject、後續步驟不執行;契約內之 ORM 零行為改變(2026-10-23 orm-run03/04,來源: w-web-api 建議書 R18,實測屬實;run04 為主控裁示) | R-PERITEM-01 規則 4(`rulebook_error-input.md`) | `unit-mapOrm` U17b-U17d、U19b-U19e;`api-procOrm` F01-F05(真 w-orm-lowdb 包一層注入);`unit-isOrmFail` V01-V03 | 已套,未發布 |
| 全站點 ORM 回傳失敗檢查(orm-run05): `save`、`del`、`mix` 之 `del`/`diff` 對聚合形違約(`ok:0`)固定字串 reject(mix 立即 reject、後續不執行);`delAll` 聚合/陣列形 `ok:0` 固定字串 reject;`genTestData` funTest 寫入對聚合形違約拋 Error;`mustExist` 下優先於 `rowNotFound`;契約內 ORM 零行為改變 | R-ORM-RESULT-01(`rulebook_error-input.md`) | `unit-mapOrm` U03b/c、U10c、U12b、U14b/c/d、U21b/c、U24/b/c/d;`api-procOrm` F06-F09;`unit-ormsites` O01-O03 | 已套,未發布 |
| 備份還原 `recover` 之 insert 回報失敗(同判準)即於該表停止、之後之表不寫入,以 `Error` reject,訊息列失敗表、ORM 回傳原文(逐筆陣列至多前 10 筆)與先前已寫入之表;先前之表與失敗表已被 ORM 寫入之筆無從回復(2026-10-23 orm-run04) | R-DB-01 規則 3(`rulebook_runtime.md`) | `unit-getDb` B05b-B05f | 已套,未發布 |
| 主鍵補值與字串型主鍵之數字轉型 | R-ID-01、R-ID-02(`rulebook_id-find.md`) | `unit-pkcast`、`api-pkcast` | 已套 |
| 輸入形狀、mix 跨段同鍵 | R-INPUT-01、R-MIX-01(`rulebook_error-input.md`) | `unit-WServOrm`、`unit-mapOrm`、`unit-objcopy` | 已套 |
| 使用端物件之迭代與複製(自有可列舉鍵、`__proto__` fail-closed、find 深度與共用子結構) | R-OBJ-01(`rulebook_obj.md`) | `unit-objcopy`、`api-objcopy` | 已套(第 82 項 run02 為最近一次修正) |
| find 白名單由 w-orm-* 把關、XSS 清除 | R-WL-01、R-XSS-01(`rulebook_id-find.md`) | `unit-objcopy`、`api-objcopy`、`api-procOrm` | 已套 |
| 擴充函數、授權、實例隔離、備份還原、相容 | R-HOOK-01、R-AUTH-01、R-INST-01、R-DB-01、R-COMPAT-01(`rulebook_runtime.md`) | `unit-WServOrm`、`unit-getDb` | 已套 |

## 二、多人同時編輯之共用核心(第 110 項,run01,2026-10-22;規格 `C:\opensrcOper\dspec\多人同時編輯之寫入契約.md`)

| 功能 | 規則帳本(`rulebook_concurrency.md`) | 程式 | 測試檔 | 狀態 |
|---|---|---|---|---|
| 純函數: `digestRow`、`buildBaseline`、`compareBaseline`、`checkContract`、`isBaselineValid`、`cyrb53`(零 import、前後端同構、版本 h1 凍結);另**額外新增(任務原清單外,待裁示)** `pickWriteRow`(存檔白名單,V5)、`getRejectKey`(統一取拒收鍵) | R-BASELINE-01 | `src/baseline.mjs` | `unit-baseline`(D、K、P、F、C、H、S 系列,含 `vm` 同構與零 import 靜態檢查) | 已套,未發布 |
| 每實例共用表鎖 `withTabLocks(tableNames, fn)`(碼元序取鎖、不可重入、巢狀取他表須一次宣告全部表) | R-LOCK-01 | `src/WServOrm.mjs` | `unit-guard` L01-L08(含 L03b 取鎖次序可觀察)、`api-guard` R13 | 已套,未發布 |
| 原子防護 `guardWrite({ tables, read, baseline, contract, write })` | R-GUARD-01 | `src/WServOrm.mjs` | `unit-guard` W01-W12、`api-guard` R07-R12、R09b、R15 | 已套,未發布 |
| `procOrm(userId, woName, mode, input, opt)` 之 `opt.mustExist`(只改不增、刪除回報未命中、del 同批重複主鍵拒收、存在檢查分批每批 1000、opt 先於擴充函數驗證) | R-ONLYMOD-01 | `src/getMapOrm.mjs`、`src/getProc.mjs` | `unit-guard` M01-M15(含 M03b、M07b、M12b、M14b)、`api-guard` R01-R08、R05b、R14 | 已套,未發布 |
| `procOrm(userId, woName, mode, input, opt)` 之 `opt.keepUserId`(insert 保留列上自有非空字串之 `userId` 為擁有者,`userIdUpdate` 仍記操作者;只適用 insert,其餘 mode、非布林、未知鍵於任何讀寫與擴充函數之前固定字串拒收;save 現行即不覆寫 `userId` 故不適用;2026-10-23 run02,使用端 w-web-sso T2①) | R-KEEPUSER-01 | `src/getMapOrm.mjs`(`getOptProc`、`hasOwnerUserId`、`adjustData`)、`src/getProc.mjs`(起首驗證) | `unit-keepuser` K01-K14、`api-keepuser` A01-A07 | 已套,未發布 |
| 不提供 `getTabHash` 與任何雜湊快取(規格取捨) | R-BASELINE-01(依據) | — | — | 刻意不做 |

規格驗收 V1-V14 在本套件之對應(使用端套件另以其實際傳輸路徑驗 V10、前端草稿保護 V11 等): V1、V3、V4、V5、V13(`unit-guard` W02/W03/W06、`api-guard` R09/R10)、V2(`api-guard` R10)、V6、V7(`unit-guard` M01-M08、`api-guard` R01-R08)、V8(`unit-baseline` C11,刪除集合之計算屬使用端)、V9(`unit-baseline` C04/C05、`api-guard` R11)、V10 之純函數部分(`unit-baseline` C12、`api-guard` R09)、V12(`unit-guard` W04)、V14(`unit-guard` W11/W12、`api-guard` R12).

使用端(w-web-perm、w-web-sso、w-web-api、w-web-task)須知: 見 `README.md`「Concurrent editing」一節與 `rulebook_concurrency.md`; 重點: (1) 同表所有寫入者經同一實例之 `withTabLocks`,鎖不可重入,`procOrm` 不自取鎖; (2) `guardWrite` 之 `read` 須新鮮(不經 ORM 快取); (3) guardWrite 不符時 reject 之 Error 以 `err.key` 取拒收鍵,procOrm 之 `'rowNotFound'` 為字串; (4) 前端以 `w-serv-orm/src/baseline.mjs` 深層匯入自算基準,契約檔前後端共用.

## 三、已知缺口與待辦

- 未發布: run01 變更尚在工作樹,等主控全套驗證與使用者發布; 使用端套件於發布後改用.
- `mustExist` 不支援 `mix`、`insert`、`select`、`delAll`(以固定字串拒收); 不支援 BigInt 主鍵(procOrm 本身不處理 BigInt id).
- `keepUserId` 只支援 `insert`(其餘 mode、含 `mix` 以固定字串拒收);保留之 `userId`(擁有者)之授權由使用端負責;`String` 包裝物件之 `userId` 視為非字串(以操作者補).
- 已裁示(主控複審 run01,2026-10-22): 額外新增之 `pickWriteRow`、`getRejectKey` 保留;巢狀取鎖維持文件規定(不加執行期偵測);`mustExist` 不支援 mix 接受;mdb 不分大小寫接受(README 與 JSDoc 註明為收嚴方向).
- 使用端職責(核心刻意不代為處理,見 `rulebook_concurrency.md` 開頭): 所有寫入者取同表鎖並一次宣告全部表、寫入列走白名單、整表存檔之刪除集合為基準內 − 送出、外部同步穩定 id、基準經實際傳輸路徑之等價驗證、草稿保護.
- w-orm-mdb(Jet 比對不分大小寫)之存在檢查以嚴格字串相等,可能把會命中者判為不存在而 `rowNotFound`(收嚴方向).
- 規格之 V11(推播草稿保護)、V8 之刪除集合計算、V10 之實際傳輸路徑驗證屬使用端.
- 前一版(run01 前)已知之 R-OBJ-01 限制(見 `rulebook_obj.md`、`rulebook_changes.md`)不變.
- 外部缺口(R-ORM-RESULT-01 表之 E2,本套件不得改): `w-data-collector/src/build.mjs:100` 之 `funTestAndSave` 對 `save` 回傳只做逐筆陣列檢查,聚合形違約(`ok:0`)未檢查;僅影響 `genTestData` 之 `funTestAndSave` 模式,待主控決定是否通報 w-data-collector.
