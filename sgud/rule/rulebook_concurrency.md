# 規則帳本(多人同時編輯之寫入共用核心)

本檔為 `rulebook.md` 之分檔,記 2026-10-22 第 110 項(run01)新增之規則。上位規格: `C:\opensrcOper\dspec\多人同時編輯之寫入契約.md`(以下「規格」,版本 1/`h1`);上位原則: `C:\opensrcOper\sgud\proc\process_principle.md` 第 10 條;方案與三審採納表: `C:\opensrcOper\dnow\20261022221854\方案v2.md`(歸檔後在 `dhist/`)。規格第 15 節對本套件之要求: 純函數子模組(零 import)、`withTabLocks`、`guardWrite`、只改不增、刪除回報未命中;**不提供雜湊快取與 `getTabHash`**。

共通說明:
- 本批規則之行號不寫死(`src/getMapOrm.mjs` 近期頻繁位移),一律依各規則之盤點指令重取.
- 使用端(w-web-perm、w-web-sso、w-web-api、w-web-task)以 `w-serv-orm/src/baseline.mjs` 深層匯入純函數,並呼叫 `WServOrm(...)` 回傳物件之 `withTabLocks`、`guardWrite`、`procOrm(..., opt)`;各使用端之盤點表與契約記入其自身帳本(規格 §9).
- 測試: `test/unit-baseline.test.mjs`(純函數)、`test/unit-guard.test.mjs`(替身記憶體 ORM `test/tools/memOrm.mjs`: 鎖、guardWrite、opt)、`test/api-guard.test.mjs`(真 w-orm-lowdb).單檔指令: `npx mocha --no-parallel test/<檔名> --timeout 180000`.
- 第 110 項之續(2026-10-23 run02,w-web-sso T2①): R-KEEPUSER-01(procOrm 之 `opt.keepUserId`),測試 `test/unit-keepuser.test.mjs`(記憶體 ORM)、`test/api-keepuser.test.mjs`(真 lowdb).

使用端職責(本核心刻意不代為處理,外審 sol 之 V1、V5、V8、V10、V11 評語,各使用端須於其盤點表與測試明列):
1. 同表所有寫入者(後台存檔、逐列寫入、外部同步、系統直寫雙方欄位)取同一實例之 `withTabLocks`/`guardWrite`;一次宣告全部要用之表(R-LOCK-01 規則 3).
2. 寫入列只含 `pickWriteRow` 白名單(伺服器專有欄位不回寫,V5).
3. 整表存檔之刪除集合＝基準內且在 scope 內之 id − 送出之 id(V8;`test/api-guard.test.mjs` R15 為參考流程,核心無法測使用端之刪除集合計算).
4. 外部同步沿用穩定 id(明確且唯一之來源識別,V2 之身分部分): 核心之 V2 測試只驗「內容不變 → 摘要不變、與寫入互斥」,不驗 id 穩定.
5. 前端自算基準之傳輸等價(V10): 核心以行程內 `JSON.stringify/parse` 與 `vm` 驗同構,實際 RPC/資料通道是否改變型別(如數字被傳成字串)須各使用端以其傳輸路徑驗證.
6. 草稿保護與重新載入提示(V1 之草稿部分、V11)屬前端.

## R-BASELINE-01 列摘要與基準為零依賴之同構純函數,版本 h1 凍結

- 狀態: 已套(2026-10-22 run01,未發布).
- 單一擁有者: `src/baseline.mjs`(`digestRow`、`buildBaseline`、`compareBaseline`、`checkContract`、`isBaselineValid`、`cyrb53`、`BASELINE_VERSION`、`BASELINE_REJECT`).
- 規則:
  1. **零依賴與同構**: 檔內無 `import`/`require`/動態 import,不用 Node 專屬全域(`process`、`Buffer` 等),語法限 ES2017 以內(不用 `?.`、`??`、`**`、BigInt 字面值,使用端之舊版打包器不轉譯 node_modules),末尾為單一 `export { ... }` 敘述(同構測試以文字替換該敘述後於 `vm` 執行).型別判定一律用 `Object.prototype.toString` 與原型鏈,不用 `instanceof`(跨 realm 之 Date 與物件同結果).
  2. **契約驗證**(`checkContract`,三個函數皆先驗證,不合者拋 Error,不靜默): 只允許 `table`、`pk`、`fields`、`serverOnly`、`orderKey`、`scope` 六鍵,以 `Reflect.ownKeys` 檢查(含不可列舉鍵與 Symbol 鍵;拼錯之鍵,如 `orderkey` 會使名次政策靜默失效,故拋錯);`pk` 非空字串;`fields` 非空、不重複之非空字串陣列(空 `fields` 會使基準對任何欄位變動都不敏感,故拒收);`serverOnly` 與 `fields` 無交集;`orderKey` 不在 `fields`、不等於 `pk`;`scope` 為函數.
  3. **列摘要**(`digestRow`): 只取 `fields` 依宣告序、只讀自有屬性;欄位**頂層**之 `undefined`/`null`/`''`(含缺欄)為同一空值;`Date` 轉 ISO 字串;BigInt 轉十進位字串;物件鍵遞迴依 UTF-16 碼元序排序,陣列保序;數字與字串**不互轉**;巢狀值只依 JSON 語意(物件鍵之值為 `undefined` 者略去、陣列內 `undefined` 為 `null`、巢狀之 `null` 與 `''` 不等價);`-0` 與 `0` 同(JSON 語意);其餘非 JSON 值(function、symbol、NaN、±Infinity、無效 Date、Map、Set、RegExp、TypedArray、Error、類別實例與帶原型之物件、帶自有可列舉非索引屬性之陣列如 `toJSON`: 該屬性不入摘要卻會在 JSON 傳輸時改變內容而使兩端摘要不同)與深度逾 100、單列節點逾 10 萬者拋 Error;列本身須標籤為 Object 之物件(陣列、Map、Set、Date 等拋 Error).序列化直接組 JSON 文字(不建中介物件: 鍵為 `__proto__` 時賦值會改設原型).格式 `'h1:'` 加 14 位小寫 16 進位(cyrb53 補零).**h1 凍結**: 演算法或欄位政策有任何改動即開 h2(作法見檔頭註解),`test/unit-baseline.test.mjs` D13、D14 之凍結向量為其守門.
  4. **主鍵**(`pkOf`): 非空字串原樣、有限數字與 BigInt 轉十進位字串,其餘(空字串、null、undefined、布林、物件、NaN、±Infinity)為缺漏;`buildBaseline` 遇缺漏或同批重複拋帶 `key: 'baselineFormat'` 之 Error(訊息列 `rows[k]` 位置,不回顯主鍵值);`scope` 外之列不檢查主鍵.
  5. **基準**(`buildBaseline`): 先依 `scope` 過濾,再排序(有 `orderKey` 依(order 數值, 主鍵碼元序),否則主鍵碼元序,不用 `localeCompare`),回 `[[id, digest], ...]`,陣列之序即名次.order 數值: 有限數字、BigInt、整數字串(轉 BigInt)依數值**精確比較**(BigInt 與 Number 以 `<`、`>` 混比為精確之數學比較; 轉 Number 會使超過 2^53 之相鄰值同值而漏判重排),其他非空白數字字串轉 Number,缺漏或無法轉數字者排最後(Infinity,其間依主鍵碼元序).
  6. **比對**(`compareBaseline`): 回 `{ ok: true }` 或 `{ ok: false, reason, added, removed, changed, reordered }`.`added/removed/changed` 為 id 陣列,`reordered` 為布林(兩邊共有之 id 之相對次序不同).reason: `baselineFormat`(基準格式或版本不識,未比對,差異欄為空)、`rowNotFound`(基準只含一列、該列已不在、且無新增列: 逐列存檔時該列已被刪)、其餘 `baselineMismatch`.`rowsNow` 之主鍵缺漏或重複屬庫內資料異常,拋 Error 且 `key` 為 `'rowsInvalid'`(不用 `baselineFormat`: 使用端依文件以 key 分流時,會把庫內損壞當成客戶端格式錯誤而提示重新載入,重新載入無法解決; 外審 sol#10),不回傳.`buildBaseline` 本身(如前端自算)仍拋 `baselineFormat`.
  7. **格式驗證**(`isBaselineValid`): 陣列,每項為 `[非空字串 id, 'h1:' + 14 位小寫 16 進位]`,id 不重複,空陣列合法.不識之格式或版本一律不合法,**不得降級為不帶基準**(規格 §5).
  8. **寫入白名單**(`pickWriteRow(row, contract)`,規格 §4、V5): 只輸出 `pk` 與 `fields` 內、列上自有且值非 `undefined` 之欄位(新物件,鍵為 `__proto__` 時以 defineProperty 建自有屬性);伺服器專有欄位、系統欄位、`orderKey` 不輸出(`orderKey` 由使用端依列序補).客戶端持舊列整列送出時,不經白名單則系統已改之伺服器專有欄位會被回寫成舊值(`test/api-guard.test.mjs` R09b 以真 lowdb 示範兩種結果).**本函數不在任務原清單**,由外審 sol#4 之 V5 缺口而新增,列待裁示.
  9. **拒收鍵取得**(`getRejectKey(err)`): 字串原樣、帶字串 `key` 之 Error 取其 key、其餘 `null`;統一 procOrm(字串 reject)與 guardWrite(Error reject)兩種形狀(外審 sol 設計評語).**同樣為額外新增**,列待裁示.
- 依據: 規格 §3、§5、§6、§8、V2、V8、V9、V10、V13;方案 v2 採納表 12、13、16、19、22、23、25.
- 規格未定而由本輪依原則決定者(原則: 遇歧義收嚴、不靜默、與規格字面一致者從之):
  - 巢狀值不套空值等價(只有欄位頂層等價): 歧義收嚴,誤擋之代價為提示重新載入,誤放之代價為靜默覆蓋.
  - 摘要補零為固定 14 字元: 令格式可嚴格驗證.
  - 主鍵轉字串之範圍(含 BigInt、排除布林與 NaN).
  - order 缺漏者排最後而非拋錯: 拋錯會使含歷史空 order 之表整表無法存檔.
  - `reordered` 為布林而非 id 陣列: 避免 `if (r.reordered)` 對空陣列恆真之誤用.
  - 契約嚴格驗證(未知鍵、空 fields): 使用端之契約為新寫,拼錯之代價高於額外之約束.
- 盤點指令(皆應為 0 命中): Grep `^\s*import\s|\bimport\s*\(|\brequire\s*\(` 於 `src/baseline.mjs`(註解行除外,以測試 S01 為準);Grep `\?\.[A-Za-z_$\[(]|\?\?|\*\*` 於 `src/baseline.mjs` 去註解後(測試 S02).
- 測試: `test/unit-baseline.test.mjs` D01-D15 與 D08b(摘要)、K01-K07(契約)、P01-P09 與 P06b(主鍵、排序、scope、精確名次)、F01-F04(格式)、C01-C14(比對,含 V2/V8/V9/V10 之純函數部分)、H01-H03(pickWriteRow、getRejectKey)、S01-S03(零依賴靜態檢查與 `vm` 同構).
- 已知限制:
  - cyrb53 為 53 位元非密碼學雜湊,用於一致性比對,非安全邊界;碰撞機率約 2^-53/列.
  - 走訪上限(深度 100、單一欄位值節點 10 萬)為保護,合法資料遠低於此.
  - 同構之「瀏覽器打包後」僅以 `vm` 乾淨全域模擬(無實際打包器);各使用端依規格 V10 以實際傳輸路徑驗證.

## R-LOCK-01 每實例共用表鎖 withTabLocks

- 狀態: 已套(2026-10-22 run01,未發布).
- 單一擁有者: `src/WServOrm.mjs` 之 `getTabsLock`(輸入檢查與排序)與 `WServOrm()` 內之 `kmx`、`withTabLocks`.
- 規則:
  1. 每個 `WServOrm(...)` 實例一個 `pmKeyMutex`,每表一鍵(鍵即表名);兩實例互不阻擋(R-INST-01).
  2. `tableNames` 須為本實例 `woItems` 之自有表名之非空陣列,否則 reject Error(拼錯之表名會鎖到無人使用之鍵而靜默失去互斥);去重;依表名 UTF-16 碼元序取鎖,由外而內巢狀取齊後執行 `fn()`,回傳其結果;`fn` reject 或拋錯原樣轉出,鎖皆釋放.多表呼叫之取鎖順序固定,故交錯之多表呼叫不死結.
  3. **不可重入**: `fn` 內對同表再取鎖(`withTabLocks` 或 `guardWrite`)排隊等自己,永不返回;**巢狀取不同表亦可死結**(每次呼叫內雖依碼元序取鎖,跨層次序不受控: 一呼叫先持 b 再等 a、另一呼叫先持 a 再等 b 即互等,外審 sol#7 以記憶體 barrier 重現).故須一次宣告全部要用之表,不得於 `fn` 內再取其他表之鎖;若必須巢狀,所有呼叫路徑須依同一全域遞增次序.不偵測(偵測需 AsyncLocalStorage,會誤判 `fn` 內不等待之背景工作——fire-and-forget 之稽核寫入),只寫入 JSDoc 與 README,並以 L07、L08 測試釘住.逐列實體之業務鎖與表鎖並用時先表鎖、後實體鎖(規格 §7).
  4. 鎖只在同一行程之同一實例內有效;同表只由同一實例寫入(規格 §12).
- 依據: 規格 §7、§12、V14;方案 v2 採納表 17、20.
- 盤點指令: Grep `withTabLocks|pmKeyMutex` 於 `src/`: 命中應只有 `src/WServOrm.mjs`(`kmx`、`withTabLocks`、`guardWrite` 之呼叫與 JSDoc).
- 測試: `test/unit-guard.test.mjs` L01(同表循序、不同表並行)、L02(回傳值與失敗後釋放,含同步拋錯)、L03(多表不死結與互斥,含隨機 100 組)、L03b(碼元遞增取鎖次序之可觀察斷言,大寫在小寫前)、L04(去重)、L05(輸入檢查)、L06(每實例各一)、L07(不可重入)、L08(跨層巢狀取不同表之死結與「一次宣告全部表」之正解);`test/api-guard.test.mjs` R13(真 ORM 多表).
- 已知限制: 不可重入不被偵測;`fn` 內若 await 外部永不返回之事,鎖不釋放(無逾時).

## R-GUARD-01 guardWrite 原子防護

- 狀態: 已套(2026-10-22 run01,未發布).
- 單一擁有者: `src/WServOrm.mjs` 之 `guardWrite`、`mkErrBaseline`.
- 規則:
  1. `guardWrite({ tables, read, baseline, contract, write })`: 於 `withTabLocks(tables)` 內依序 `read()`(須 resolve 陣列,呼叫端之新鮮讀取,不得經 ORM 快取)、`compareBaseline`、`write(rows)`,回傳 `write` 之結果;比對與寫入在同一把表鎖內,其間插不進任何同表寫入者(規格 V14).
  2. `baseline` 為 `undefined`(不帶基準之寫入)才跳過比對,但仍取鎖、仍呼叫 `read`;`null` 與其他任何非 `undefined` 之值皆比對,格式不合即 `baselineFormat`,**不降級為不帶基準**(規格 §5、V13).
  3. 不符時 reject 一個 Error: `message` 與 `key` 皆為固定英文拒收鍵(`baselineMismatch`、`rowNotFound`、`baselineFormat`),另附 `added`、`removed`、`changed`、`reordered`;`write` 不被呼叫.`write` 自身之 reject(如 procOrm 之字串)與 `read` 之例外原樣轉出,鎖皆釋放.使用端取拒收鍵: `getRejectKey(err)`(procOrm 之 `'rowNotFound'` 為字串,依 R-ERR-01 procOrm 回字串; guardWrite 為工具函數故 reject Error).
  4. 帶基準時 `contract` 必填且驗證;未帶基準而給了 `contract` 者亦驗證;`contract.table` 若有須在 `tables` 內(基準與鎖指向不同表即使用端之錯).
  5. `read` 一律必填且恆呼叫(含不帶基準時),使 `write(rows)` 恆收到鎖內新鮮列;逐列存檔之 `read` 只讀該列(基準只含該列).
- 依據: 規格 §6、V1、V4、V5、V12、V13、V14;方案 v2 採納表 22、23.
- 規格未定而由本輪依原則決定者: `read` 恆必填(統一契約,不讓 `write` 收到可能為 undefined 之 rows);Error 形狀(message 與 key 同為拒收鍵);`contract.table` 須在 `tables` 內.
- 盤點指令: Grep `guardWrite|compareBaseline` 於 `src/`: 命中應只有 `src/WServOrm.mjs`、`src/baseline.mjs`.
- 測試: `test/unit-guard.test.mjs` W01-W12;`test/api-guard.test.mjs` R07-R12、R09b(V5 整列舊值回寫之對照)、R15(V8 整表存檔之刪除集合參考流程)(真 lowdb: V2、V3、V4、V5、V6、V7、V8、V9、V14).
- 已知限制: 原子性只在同一行程、同一實例、同表之所有寫入者皆取同一表鎖時成立(規格 §12);`read` 是否新鮮由呼叫端負責.

## R-ONLYMOD-01 procOrm 第 5 參數 opt.mustExist: 只改不增與刪除回報未命中

- 狀態: 已套(2026-10-22 run01,未發布).
- 單一擁有者: `src/getMapOrm.mjs` 之 `getOptProc`、`hasMissingRow`、`hasNoHit` 與 `execMapOrm` 之 save、del 分支;`src/getProc.mjs` 只轉傳 opt.
- 規則:
  1. `procOrm(userId, woName, mode, input, opt)`: opt 選用,未給(`undefined`、`null`)時行為與四參數完全相同(ORM 之 save 仍為單參數呼叫、無額外 select).
  2. opt 驗證(於任何讀寫之前**且早於擴充函數 check 與前處理**,`getProc.mjs` 之 procOrm 起首即驗,mapOrm 內再驗; 固定字串 reject,不回顯呼叫端之值; 外審 sol#3: 先執行擴充函數會令其副作用發生,且 check 拋錯會遮蔽固定拒收字串): 須為純物件(`invalid opt of procOrm, need an object`);只允許 `mustExist`、`keepUserId` 兩鍵(後者見 R-KEEPUSER-01),含 symbol 鍵(`unsupported key`);各鍵為自有資料屬性之布林(`mustExist needs a boolean`、`keepUserId needs a boolean`;先逐鍵驗型別再驗 mode);`mustExist: true` 只適用 `save` 與 `del`(`mustExist supports only save and del`);`mustExist: false` 於各 mode 無效果.拼錯之鍵若被靜默忽略,只改不增即失效而重新長出已刪之列,故 fail-closed.(2026-10-23 run02 起 opt 增為兩鍵.)
  3. `save` + `mustExist`: 寫入前(`adjustData` 補主鍵後)以 `select({ id: { $in: [...] } })` 分批(每批至多 1000 個主鍵,規則 11)檢查全部列,任一列不存在(含未帶主鍵者、空字串主鍵)即整批 reject `'rowNotFound'` 且零寫入;轉傳 `{ autoInsert: false }` 給 ORM 之 `save`.
  4. `del` + `mustExist`: 同上,任一列不存在(含無有效主鍵、非物件之列)即整批零刪除並 reject `'rowNotFound'`.**同批重複之有效主鍵**(數字與其字串視為同一)整批 reject `'invalid input of del, duplicate id: data[k]'`(列第 2 次以後出現者之位置,不回顯主鍵,零刪除,同 R-MIX-01 之訊息慣例): 若放行,第 1 筆刪除後第 2 筆必未命中,事後偵測(規則 5)雖會 reject 卻已刪除,違反零刪除(外審 sol#1);save 之同批重複主鍵(逐筆依序更新,後者蓋前者)不受影響.未帶 `mustExist` 之 del 仍回 ORM 逐筆結果,未命中為 `{ n: 0, nDeleted: 0, ok: 1 }`,不視為錯誤(既有行為不變).
  5. **事後偵測**: 檢查通過後 ORM 仍回逐筆 `n === 0`(save)或 `nDeleted === 0`/`n === 0`(del)而 `ok !== 0` 者,亦 reject `'rowNotFound'`(表鎖紀律被破壞,檢查後寫入前列被他方刪除);已寫入或刪除之筆無從回復.
  6. 存在檢查之 `select` 失敗: reject `'failed to save data'`(save)或 `'failed to delete data'`(del),錯誤原文只由 `console.log` 輸出(R-ERR-01 規則 5),零寫入.
  7. **procOrm 不自行取表鎖**: 存在檢查與寫入非原子,呼叫端須已持有該表之表鎖(`withTabLocks` 或 `guardWrite` 之 `write` 內);procOrm 自取鎖會與呼叫端之鎖不可重入而死結.
  8. 擴充函數(check、前處理、後處理)之參數物件**不含 opt**,形狀維持 R-HOOK-01 規則 4;前處理改寫後之 input 仍被存在檢查.
  9. 存在檢查之 `select` 經 ORM,ORM 開啟 `useCache` 時可能非新鮮(各 w-orm-* 之快取只反映本實例之寫入且寫入後即作廢): 部署前提為同表只由同一 ORM 實例寫入且不開 `useCache`(規格 §12).
  10. 比對以字串形式(整數主鍵之數字與其字串同一).w-orm-mdb 之 Jet 比對不分大小寫、忽略尾端空白(見 WServOrm JSDoc): 以嚴格字串相等比對存在,於 mdb 可能把「ORM 會命中」誤判為不存在而 reject(收嚴方向,零寫入).
  11. **分批查詢**: 各 w-orm-* 共用之條件檢核(`wsemi/src/cvOrmFind.mjs`,`DEF.maxIn = 10000`,只可下調)對 `$in` 之元素數設上限,超過整批 reject(實測 lowdb: `invalid find: array is too large (> 10000) at [find.id.$in]`);故存在檢查每批 `EXIST_CHUNK = 1000` 個主鍵,任一批有缺即止.無此分批時,一次存或刪逾 10000 列會以 `failed to save data`/`failed to delete data` 失敗(fail-closed 但不可用).效能依 ORM: lowdb 之 `$in` 為逐列線性比對,1 萬列約 5 秒(`test/api-guard.test.mjs` R14 實測 10500 列約 6 秒);後台表通常為數百至數千列.
- 依據: 規格 §6(修改只改不增、刪除檢查存在、V6、V7);方案 v2 §2.4 第 4、5 點;採納表 8、9;七個 w-orm-* 之 `save` 皆有 `autoInsert` 且未命中回 `n: 0, ok: 1`(主控 2026-10-22 已核,本輪另讀 lowdb、level、lmdb、mongodb、postgresql、reladb、mdb 之 save 註解與分支確認).
- 規格未定而由本輪依原則決定者: 選項名 `mustExist`(save 與 del 共用一個選項);無主鍵視為不存在而非 per-item failure;opt 嚴格驗證與 `mustExist:true` 限 save、del;事後偵測;procOrm 不自取鎖.
- 盤點指令: Grep `mustExist|optProc|autoInsert` 於 `src/`: 命中應只有 `src/getMapOrm.mjs`(`OPT_KEYS_PROC`、`getOptProc`、`hasMissingRow`、`hasNoHit`、execMapOrm 之 save/del 分支)、`src/getProc.mjs`(僅轉傳 opt)、`src/WServOrm.mjs`(JSDoc).
- 測試: `test/unit-guard.test.mjs` M01-M15(含 M03b 大批分批、M07b 刪除重複主鍵、M09 事後偵測(save 之 n、del 之 n 與 nDeleted 分別守住)、M10 select 失敗、M11b 整數主鍵、M12-M12b-M13 opt 驗證(含早於擴充函數)、M14-M14b 擴充函數形狀(成功路徑三種擴充函數皆執行)、M15 四參數行為鎖定(固定預期,非自我對照));`test/api-guard.test.mjs` R01-R08、R05b、R14(真 lowdb: V6、V7,R14 為逾 10000 列之大批).
- 已知限制: mdb 之大小寫(規則 10;README 與 `WServOrm` JSDoc 已註明為**收嚴方向**: 寧可誤拒、零寫入,不是放寬;run02 主控複審接受);mix 不支援 `mustExist`(整表存檔之 diff 於 `guardWrite` 內比對過全表,無「已刪列復活」之競態;run02 主控複審接受);insert、select、delAll 不支援.

## R-KEEPUSER-01 procOrm 第 5 參數 opt.keepUserId: insert 保留列上之 userId(擁有者語意)

- 狀態: 已套(2026-10-23 run02,未發布).需求來源: 使用端 w-web-sso 之 T2①(`tokens.userId` 是權杖**擁有者**而非建立者;sso 依擁有者分組、以擁有者當 `procOrm` 之第 1 參數寫入,結果 `userIdUpdate` 亦被記成擁有者,稽核錯誤).
- 單一擁有者: `src/getMapOrm.mjs` 之 `OPT_KEYS_PROC`、`getOptProc`(驗證)、`hasOwnerUserId`、`adjustData` 之 `keepUserId` 參數(insert 區塊之 userId 補值)與 `execMapOrm` 傳入處;`src/getProc.mjs` 只於起首呼叫 `getOptProc`(同 R-ONLYMOD-01 規則 2)並轉傳 opt.
- 規則:
  1. `opt.keepUserId` 為布林,**只適用 `insert`**.`true` 用於其他 mode(save、del、select、delAll、mix、無效 mode)reject `invalid opt of procOrm, keepUserId supports only insert`;非布林或存取器(含 get/set 皆 undefined 者)reject `invalid opt of procOrm, keepUserId needs a boolean`;未知鍵(含拼錯 `keepuserid`)reject `unsupported key`.驗證時點與方式同 `mustExist`(R-ONLYMOD-01 規則 2): 任何讀寫與擴充函數(check、前處理)之前,固定字串,不回顯呼叫端之值,ORM 0 次呼叫;`getProc` 與 `mapOrm` 各驗一次(直接使用 `getMapOrm` 者亦受保護).`keepUserId: false` 於各 mode 無效果,等同未給.
  2. **逐列判定**: `keepUserId: true` 時,該列自有、可列舉之資料屬性 `userId` 為非空字串(`typeof === 'string' && !== ''`;單純空白字串屬非空而保留)者保留原值;缺欄、空字串、`null`、`undefined`、非字串(數字、物件、布林)、繼承而來、不可列舉者視為未提供,照現行以操作者(`procOrm` 第 1 參數)補.認定法同 `getRowId`(只認自有可列舉之資料屬性,不執行 getter),令本層所見之 `userId` 即實際寫入者.保留之值與其他字串欄位同,仍於 `adjustData` 之後經 `clearXSS`.
  3. 不變: `userIdUpdate`、`timeCreate`、`timeUpdate` 照現行補值(`userIdUpdate` 恆為操作者,呼叫端給之值被覆寫);表之 keys 不含 `userId` 者 `keepUserId` 無效果(不補、不刪);補值規則之其餘部分、clearXSS、主鍵補號不動.判定依據為前處理(`addFunPreProcessing`)改寫後進入 `mapOrm` 之列.擴充函數之參數物件不含 opt(形狀同 R-HOOK-01 規則 4).
  4. 未帶 `keepUserId`、`false`、opt 為 `undefined`/`null`/`{}`/`{mustExist:false}` 之行為與現行完全相同(列上 `userId` 被操作者覆寫).`procOrm` 四參數呼叫行為不變.
  5. **save 之評估(依「欄位歸屬」: 擁有者語意之欄不被操作者覆寫)**: `adjustData` 之 save 分支現行只補 `userIdUpdate`、`timeUpdate`,**不碰 `userId`**,列上之 `userId` 原樣寫入,故 save 已符合欄位歸屬,不需此選項;對 save 給 `keepUserId: true` 以規則 1 拒收(不適用,而非靜默忽略).mix 之新增(`'insert+save'`)為內部步驟,同 `mustExist`,不開放.
  6. 兩鍵並用: `mustExist: true`(限 save、del)與 `keepUserId: true`(限 insert)無任何 mode 可同時為真;insert 先以 `mustExist` 之 mode 句 reject,save/del 以 `keepUserId` 之 mode 句 reject;型別檢查先於 mode 檢查(`{ mustExist: true, keepUserId: 'x' }` 於 save 報 `keepUserId needs a boolean`).
  7. 不改變授權性質: `procOrm` 不做授權(R-AUTH-01);`keepUserId` 讓呼叫端指定列上之 `userId`;`opt` 為伺服端程式呼叫 `procOrm` 之第 5 參數,若有開放處(如資料通道)把使用者可控之值轉傳成 `opt`,等於讓前端指定 `userId`,須由開放處自行限制(本輪未檢視任何資料通道之實作,不在本套件範圍);使用端須自行確認寫入列之 `userId`(擁有者)之授權.
- 依據: 使用端需求 T2①;與 R-ONLYMOD-01 同一驗證模式(fail-closed);原則「歧義收嚴」.
- 規格未定而由本輪依原則決定者(皆入 decisions.tsv,phase `orm-run02`): 選項名 `keepUserId`(布林);只適用 insert、其餘 mode 拒收;逐列判定與「非空字串」之認定(單純空白視為非空,字面依需求);繼承/不可列舉視為未提供;save 不適用之評估結論;mix 不開放.
- 盤點指令: Grep `keepUserId|hasOwnerUserId` 於 `src/`: 命中應只有 `src/getMapOrm.mjs`(`OPT_KEYS_PROC`、`getOptProc`、`hasOwnerUserId`、`adjustData` 之 insert 區塊、`execMapOrm` 之 adjustData 呼叫)、`src/getProc.mjs`(僅註解)、`src/WServOrm.mjs`(JSDoc).
- 測試: `test/unit-keepuser.test.mjs` K01-K14(含 K04 既有行為不變(修前即綠)、K08 非布林、K09 各 mode、K10 並用、K11 直接 getMapOrm、K12 早於擴充函數、K13 擴充函數形狀與前處理改寫、K14 save 現行不覆寫);`test/api-keepuser.test.mjs` A01-A07(真 lowdb,含 sso 情境 A01、同批多擁有者 A02、保留於 guardWrite/withTabLocks 內 A07).單檔指令: `npx mocha --no-parallel test/unit-keepuser.test.mjs test/api-keepuser.test.mjs --timeout 180000`.變異驗證 25 個全數被抓到(清單見 run02 報告).
- 已知限制: 保留之 `userId` 之授權由使用端負責(規則 7);不支援 mix 與 save;`String` 包裝物件之 `userId` 視為非字串(以操作者補).
