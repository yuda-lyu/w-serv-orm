# 規則帳本(錯誤、訊息與輸入形狀)

本檔為 `rulebook.md` 之分檔(2026-10-22 依全域 §14 整理: 各節原文逐字搬移,節號與標題不變,未刪改)。索引與共通事項(系列規格、測試與 lint 指令、行號基準)見 `rulebook.md`。

## R-ERR-01 錯誤型別依層: procOrm 回字串,工具函數拋 Error

- 狀態: 已套(1.1.8).
- 單一擁有者:
  - 請求路徑: `src/getProc.mjs` procOrm(`:31`)、`src/getMapOrm.mjs` mapOrm(邊界保證,`:508`)、execMapOrm(`:524`).
  - 工具路徑: 建構(`src/checkOptRemoved.mjs:4`、`src/getWoItems.mjs:8`、`src/getSettings.mjs:12`、`src/getProc.mjs:65` getProc)、擴充函數註冊(`src/getProc.mjs:7` addFun)、`src/getDb.mjs`、`src/getDbBackupAndRecover.mjs`、`src/genTestData.mjs`.
- 規則:
  1. procOrm、mapOrm 由本套件產生之 reject 一律為字串.ORM 之錯誤原文只以 console.log 輸出,由 mapOrm 各 catch 轉為固定訊息.
  2. 建構(含直接呼叫 getProc)、擴充函數註冊、backup、recover、getDb、genTestData 由本套件產生之錯誤一律為 Error;ORM 之錯誤原樣轉出.
  3. 擴充函數自身之 reject 或拋錯原樣轉出,型別由呼叫端決定.
  4. addFunCheck 註冊非函數時,註冊當下拋 Error,另推入以字串 reject 之守門函數(`src/getProc.mjs:15-21`),令該實例之 procOrm 維持 fail-closed.
  5. **邊界保證**(2026-10-17 run02 外審後新增): mapOrm 以單一 try/catch 包住本套件之檢查、轉型與 ORM 呼叫階段(execMapOrm),非字串之例外(RangeError、使用端物件之 Proxy 陷阱/`util.inspect.custom`/`toString` 拋錯、已撤銷之 Proxy、woItems 之非 ORM 值、循環或共用子結構使遞迴爆堆疊等)一律 `console.log` 原文後以固定字串 `failed to process input` reject,不轉出例外物件與其拋出之值;字串(本套件各處之固定訊息)原樣轉出.理由: 逐站確保會漏(外審 opus 二輪以 Proxy 列、`mode` 為物件、`console.log(input)` 觸發 inspect、循環與鏈狀共用子結構逐一找出漏網);擴充函數(getProc)與 ORM 之錯誤不在此列(規則 3、規則 1 之 ORM 部分).對照: 由 getErrFind、getReasonBadKey 等已轉為特定固定訊息者(`unreadable value` 等)優先於此兜底.(2026-10-20 第 82 項: find 之循環與共用子結構改由 R-OBJ-01 規則 5 續之 `measureFind` 先以 `too deep`/`too large` 拒收,此處僅為兜底; 寫入列頂層與批次容器為 Proxy 者改由 R-OBJ-01 規則 7 以 `irregular` 拒收,不再走此兜底,測試 C02、C04 之預期隨之更新.)
- 依據: 使用端以字串處理 procOrm 之拒絕(各前端只接受字串語系鍵);Error 經 JSON 序列化為 `{}`.
- 盤點指令: Grep `src/` 搜 `reject\(|throw `.
- 站點全集與判準(2026-10-13):
  - 請求路徑之字串 reject: `src/getProc.mjs:18`(守門)、`:47`;`src/getMapOrm.mjs:516`、`:519`、`:531`、`:539`、`:551`、`:563`、`:579`、`:586`、`:598`、`:608`、`:629`、`:638`、`:684`、`:699`、`:706`、`:714`、`:728`、`:738`、`:761`、`:768`、`:788`、`:800`、`:822`、`:852`、`:864`、`:883`、`:894`(其中之 err 皆為 catch 內設定之字串或 getMsgFail、getMsgIdXSS、getErrFind、getMsgsBadKey 之回傳,2026-10-17 run02 重取;`:516` 為邊界保證對字串之原樣轉出、`:519` 為其固定字串 `failed to process input`(規則 5);`:539` 為 woName 檢查(R-INPUT-01 規則 5);`:551`、`:684` 為 select、delAll 之 find 檢查,`:586`、`:738` 為 R-OBJ-01 之鍵檢查,`:706` 為 mix 容器為存取器): 已套.
  - `src/getMapOrm.mjs:407`(adjustData 拋 Error): 刻意,由 mapOrm 之 catch 轉為 `failed to adjust data`.
  - 規則 1 之兩項既有例外(2026-10-17 審計與外審發現,同日 run02 修為已套): (a) woName 為 `__proto__`、`constructor`、`toString` 或含 `.` 之路徑(如 `tests.select`)時,原 `get(woItems, woName, null)` 取到非 ORM 之值,`wo.select is not a function` 以 TypeError 物件 reject → 現由 R-INPUT-01 規則 5 以固定字串 reject;(b) 字串型主鍵表之 select、delAll 收到深層巢狀之 `{"$and":[…]}` 時,castIdFind 與 castIdCond 之遞迴爆呼叫堆疊,以 RangeError 物件 reject(HEAD `c57402e` 即如此;實測閾值見 R-OBJ-01 規則 5) → 現由 R-OBJ-01 規則 5 之深度上限以固定字串 reject.R-OBJ-01 之檢查(getReasonBadKey)以堆疊迭代,不受影響,且其內部拋錯皆轉為固定字串.
  - 工具路徑之 Error: `src/checkOptRemoved.mjs:18`、`src/getProc.mjs:21`(註冊)、`:74`(mapOrm 無效)、`src/getWoItems.mjs:13-31`、`src/getSettings.mjs:41-79`、`src/getDb.mjs:87`、`:137`(`:105`、`:154` 為原樣轉出)、`src/getDbBackupAndRecover.mjs:22`、`:45`、`:49`、`:73`、`:78`、`:81`、`src/genTestData.mjs:54`: 已套(2026-10-17 run02 因 recover 改用 hasOwnProperty 而移除 haskey 之 import,該檔行號減 1).
- 測試: `test/unit-WServOrm.test.mjs` I03、I12、K06、K07;`test/unit-getDb.test.mjs` B01-B12;`test/unit-mapOrm.test.mjs` U06、U11、U16-U18;`test/unit-objcopy.test.mjs` W01、W02、W03(woName 與建表)、T01、T02(find 深度與寫入列深度)、C01-C05(邊界保證: `mode` 為物件、Proxy 列、inspect.custom、循環與鏈狀共用子結構、woItems 之非 ORM 值).
- 變更紀錄:
  - 1.1.11 之後(2026-10-17, run02): 規則 1 之兩項既有例外修為已套(woName 見 R-INPUT-01 規則 5;find 深度見 R-OBJ-01 規則 5).
  - 1.1.8(2026-10-12)守門由 Error 改為字串;低階 backup 補 woItems 檢查(原由 pmSeries 以字串 reject,且 `[]`、`{}` 會產出 recover 拒收之空備份).
  - 1.1.9 之後(2026-10-13): getProc 收到非函數之 mapOrm 由回字串之 rejected Promise 改為拋 Error.原判「WServOrm 恆傳函數而不可達」不成立: 使用端有直接呼叫 getProc 者(見 R-COMPAT-01).原 procOrm 內之同一檢查(st 由 getProc 建立且不外露,不可達)一併移除.

## R-MSG-01 訊息一律英文,依固定句型

- 狀態: 已套(1.1.8).
- 單一擁有者: 逐筆失敗訊息為 `src/getMapOrm.mjs` getMsgFail(`:20`);主鍵含 HTML 標記者為 getMsgIdXSS(`:394`).
- 規則:
  1. 程式碼送出之訊息(reject、throw、console.log 之訊息句)一律英文、小寫開頭.註解與 JSDoc 用中文;schema 之欄位顯示名稱(`name`)屬資料,不在此限.
  2. 句型:
     - 驗證失敗: `invalid X`.
     - 查無: `can not find X`,如 `can not find table[x] in ORM`.
     - 操作失敗: `failed to X`,如 `failed to select data`、`failed to insert data`、`failed to save data`、`failed to delete data`、`failed to update data`(mix 之 diff)、`failed to adjust data`.
     - 已移除之設定: `opt.X has been removed, …`.
  3. 逐筆失敗之格式為 `${msg}: ${list}`:
     - 主鍵為非空字串或數字者列 `id[...]`,超過 100 字元截斷並加 `…`(log 保留全文).
     - 其餘列 `data[k]`,k 自 0 起.
     - 呼叫端指定之位置標籤(getMsgFail 之 `ref`,如 mix 同鍵之 `add[0]`、`del[1]`)原樣列出.
     - 超過 10 筆只列前 10 筆,並接 `, ... (N in total)`.
     - mix 各步驟之訊息以 `; ` 串接;錯誤原文只進 log.
     - 寫入前之整批拒絕沿用同一格式,於 msg 後接原因: `, id contains HTML markup`(R-XSS-01)、`, not an object`(R-INPUT-01)、mix 同鍵為 `invalid input of mix, same id in add and del`(R-MIX-01).
  4. 主鍵含 HTML 標記之拒絕只列位置,不回顯主鍵: `${msg}, id contains HTML markup: data[k]`.
  5. genTestData 兩種模式之逐筆失敗訊息相同,皆為 `failed to write test data into table[k]: <JSON>`.funTestAndSave 之訊息由 w-data-collector 產生,1.0.46 起同格式.
- 盤點指令: Grep `src/`、`schema/`、`g-mOrm.mjs` 搜 `^[^/]*['"\`][^'"\`\n]*\p{Han}`(含中文之字串);命中只應為 JSDoc 與 schema 之欄位顯示名稱.
- 站點全集與判準(2026-10-17 重取): `src/WServOrm.mjs:15`、`:20`、`:26`、`:27`、`:29`、`:30`、`:36`(JSDoc,2026-10-19 因新增條件(find)與 delAll 兩段說明而位移;新增之 `:24`、`:25` 含 `/` 在引號之前,不被盤點指令命中,內容為 JSDoc)、`schema/tables/tests.mjs:17`、`:21`、`:25`、`:29`(欄位顯示名稱): 刻意不套;其餘 0 筆.
- 使用端影響: 四個使用端之前端皆把拒絕值當語系鍵翻譯,查無鍵者顯示通用訊息,procOrm 原文不顯示於畫面;w-web-api、w-web-task 之 spec 曾引用 `找不到使用者資訊`(2026-10-12 已交建議檔).
- 測試: `test/unit-mapOrm.test.mjs` U03-U18、U21-U23、X02-X04;`test/api-procOrm.test.mjs` A02、A03、A07;`test/unit-WServOrm.test.mjs` K04、L01、L02、T01、P06.
- 變更紀錄: 1.1.8 由中文改英文,位置由 `第N筆`(自 1 起)改 `data[k]`(自 0 起);同版把 schema 範例之 log 改英文,並補上漏掉之 `$`(原印出字面之 `{keyTable}`).

## R-PERITEM-01 save、del、mix 之逐筆失敗即 reject

- 狀態: 已套(1.1.7).
- 單一擁有者: `src/getMapOrm.mjs` execMapOrm(`:524`);逐筆判讀用 w-data-collector 之 `src/getItemsFail.mjs`(本套件不另設同名檔,見 R-COMPAT-01).
- 規則:
  1. save、del 之 ORM 回傳為逐筆陣列(規格 T2);任一筆 ok 為 0 即 reject,並列出失敗筆(格式見 R-MSG-01 規則 3).查無(ok:1、n:0)不是失敗.
  2. 單筆失敗不中斷整批,reject 時其餘筆已寫入.
  3. mix 依 add、del、diff 之序執行.逐筆失敗不中斷後續步驟,全部完成後一併 reject;整批性錯誤立即 reject,後續步驟不執行.
  4. insert 回聚合物件,其錯誤皆整批 reject,不做逐筆檢查.ORM 回傳非陣列(未依規格)時不檢查.
  5. 失敗訊息以呼叫端原輸入列出(inputOrig `:570`、diffOrig `:843`);本套件補出之主鍵只寫於複本,reject 時呼叫端未曾取得.del 與 mix 之 del 以 R-ID-02 轉型後之列判讀與列出(數字之字串形式與原數字之列出文字相同).
  6. 逐筆失敗而 reject 時不執行後處理.
- 盤點指令: Grep `src/` 搜 `getItemsFail\(`.
- 站點全集與判準(2026-10-13):
  - `src/getMapOrm.mjs:632-640`(save)、`:668-675`(del)、`:825-830`(mix 之 del)、`:867-872`(mix 之 diff)、`src/genTestData.mjs:52`(funTest 之寫入): 已套(2026-10-17 run02 重取).
  - insert 與 mix 之 add: 刻意不套(規則 4).
- 測試: `test/unit-mapOrm.test.mjs` U01-U22;`test/api-procOrm.test.mjs` A01-A04;`test/unit-WServOrm.test.mjs` H01、P06.
- 變更紀錄: 1.1.7(2026-10-11)由靜默 resolve 改為 reject;1.1.8 改用 w-data-collector 之 getItemsFail.

## R-INPUT-01 寫入、select 與 delAll 之輸入形狀

- 狀態: 已套(1.1.10 之後,2026-10-14;裁示 D4、D5、D6).select 之 find 檢查於 1.1.11 之後(2026-10-17)補上(使用者 2026-10-16 裁示,dspec 一之一;主控派工裁示 D3).
- 單一擁有者: `src/getMapOrm.mjs` getOwnItem(woName 之查表,規則 5;含 isIdCast 內之 ds 查表)、getItemsNotObj(元素檢查)、getErrFind(select 與 delAll 之 find 檢查,同時負責 R-OBJ-01 規則 3、5 之 `__proto__`、存取器與深度檢查)、mapOrm(mix 各段之檢查)、adjustData(空物件列之補值,見 R-ID-01 規則 3).
- 規則:
  1. insert、save: 輸入為物件或陣列,各筆須為一般物件(wsemi isobj,`[object Object]`);單一非物件輸入視為第 0 筆.否則於任何寫入之前整批 reject: `failed to insert data, not an object: data[0]`、`failed to save data, not an object: data[0]`.空陣列照舊交 ORM.**批次容器**(2026-10-20 第 82 項,R-OBJ-01 規則 7 ③): 輸入若為 `Array.isArray` 之陣列,須為乾淨之真密陣列,Proxy 或原型鏈有標籤 → `failed to insert data, unsupported irregular object or array`,有空洞 → `failed to insert data, unsupported sparse array: data[k]`、索引為存取器 → `…, unsupported accessor property: data[k]`(save、del〔`failed to delete data, …`〕同),已撤銷之 Proxy → 容器層 `…, unsupported irregular object or array`(無位置),於讀任何元素之前檢查(以描述子逐索引,不執行 getter).原空洞容器於 insert、save 為 `not an object: data[k…]`(並為每個空洞配置一個物件,稀疏巨陣列 OOM),於 del 原樣交後端.偽造 `Symbol.toStringTag` 為 `Array` 之類陣列物件不再被當陣列(原 `isarr` 為真而繞過規則 3),視為單一列,由 R-OBJ-01 規則 7 ② 以 `irregular` 拒收.
  2. mix: input 須為非空物件(既有);add、del、diff 若給予(非 undefined)須為陣列,否則 reject 既有之 `invalid input of mix, need the result object of ltdtDiffByKey`;add、diff 之各筆須為一般物件,否則整批 reject `failed to insert data, not an object: data[k]`、`failed to update data, not an object: data[k]`(兩段皆有者以 `; ` 串接).del 之各筆不檢查(同 del 模式,交後端逐筆處置),**但 add、del、diff 三段各為批次容器,須為乾淨之真密陣列**(`failed to insert data|delete data|update data, unsupported irregular object or array|unsupported sparse array: data[k]`,多段以 `; ` 串接,於各段形狀檢查之後、任何元素讀取之前); 偽造標籤之類陣列(`isarr` 為真而 `Array.isArray` 為假)視為「非陣列」,回既有之 `need the result object of ltdtDiffByKey`.另 **mix.del 列之 id 須為自有資料屬性**,見 R-MIX-01 規則 6.
  3. select、delAll: find 若給予(非 undefined)須為**純物件**(isPlainObj: 原型鏈乾淨(isCleanChain: 無 Proxy、無任何自有 `Symbol.toStringTag`,不執行使用端程式)、wsemi isobj 為真,且原型為 null、本 realm 之 `Object.prototype`,或某 realm 之 `Object.prototype`(isRealmObjectProto,2026-10-19 規則 6 起: 原型為 null、自有鍵名集合同本 realm 之 `Object.prototype`、`constructor` 為資料屬性之函數且其 `Function.prototype.toString` 與 `Object` 相同、且其 `prototype` 指回該原型;只有 `constructor` 一鍵、鍵名多或少、`constructor` 為 getter 或指向他處之偽原型皆不通過),故 `Object.create(null)` 與跨 realm(vm)之物件通過,`Object.create(Object.create(null))`(原型為 null 原型之一般物件,條件繼承自原型而自有鍵為空)不通過),否則 reject `invalid find of select, need an object`、`invalid find of delAll, need an object`.undefined 與空物件 `{}` 為無條件(select 回全部、delAll 刪除全部;規格與 dspec 一之一).`null`、陣列、字串、數字、布林、函數、Date、RegExp、Map、Set、包裝物件(`new String`、`Object(1)`)、`arguments`、類別實例、`Object.create(proto)`、偽造 `Symbol.toStringTag` 之 Map 皆 reject.
     - 純物件而非 isobj 之理由: isobj 以 `Object.prototype.toString` 判定,類別實例與偽造 `Symbol.toStringTag` 者通過,而其自有可列舉鍵可能為空,在字串型主鍵表被 mapOwn 複製成 `{}`,令條件消失(select 回全表、delAll 刪全表),違反 dspec 一之 2②③(外審 opus #4、sol F2 實測).dspec 一之一第 2 點之清單亦含類別實例.寫入列(規則 1、2)仍用 isobj,複製只取自有鍵,無條件消失之問題.
  4. 檢查之順序: woName 檢查(規則 5)最先,其後批次容器檢查(R-OBJ-01 規則 7 ③,寫入與 del)、形狀檢查、R-OBJ-01 之 `__proto__`、存取器與深度檢查、R-ID-02 轉型、R-XSS-01 預檢、R-MIX-01 同鍵檢查,皆於任何寫入(或查詢)之前.
  5. woName(資料表名)須為 woItems 之**自有字串屬性**(getOwnItem: `typeof` 為 string 且 `Object.prototype.hasOwnProperty.call`),否則於任何 ORM 呼叫之前 reject `can not find table[<woName>] in ORM`(非字串者 `can not find table[] in ORM`).原以 lodash `get(woItems, woName, null)`: 取到原型鏈上之值(`__proto__`、`constructor`、`toString`、`hasOwnProperty` 等)並解析路徑(`tests.select` 取到 ORM 之函數),`wo.select is not a function` 以 TypeError 物件 reject(違反 R-ERR-01 規則 1).ds 之鍵含 `.` 之資料表為自有屬性,照常.訊息回顯 woName 為既有慣例(見「其他已知限制」),不新增回顯.isIdCast 之 `get(ds, woName, null)` 同改為 getOwnItem.getWoItems 以 `Object.defineProperty` 建立 woItems 之各表(ds 之鍵 `__proto__` 為自有屬性而非改設 woItems 之原型,與 R-OBJ-01 規則 2 同理;原 `woItems[v] = wo` 令該表不可用且不被 closeAll 關閉,外審 opus 二輪 F10).
- 依據: adjustData 之 clearXSS 以 lodash each 遍歷各元素,字串、陣列元素被展開成 `{0:…,1:…}` 寫入、數字等變成 `{}`,resolve 而寫入垃圾紀錄,並繞過 w-orm-lmdb 1.0.39 之「元素須為物件」檢查(審計 run01 全盤 M6);mix 各段為物件時回報為每欄一個 `{id: undefined}`(M7);後端對非物件之 find 一律刪除全表(M10,lmdb、lowdb、reladb 實測);select 之非物件 find 於多數後端視為無條件而回全表,傳了值卻不是條件物件通常是呼叫端之錯誤(如變數意外為 null),默默回全表比報錯危險(dspec 一之一,使用者 2026-10-16 裁示).
- 已知限制:
  - 規則 3 之純物件判準比主控派工裁示 D3 字面之「一般物件(與 delAll 同式)」更嚴(delAll 原用 isobj,現與 select 共用 getErrFind,一併收緊): 為外審 opus #4、sol F2 實測之靜默全表操作而收緊,與 dspec 一之一第 2 點之清單一致;影響僅及傳類別實例、`Object.create(proto)` 等之行程內呼叫端(庫內盤點 0 處).主控 2026-10-17 複審裁示採用(T2).
  - 經 JSON 傳輸(如 w-serv-webdata 資料通道)時,陣列內之 `undefined` 成為 `null`(JSON 語意,以 `JSON.stringify([undefined])` 為 `[null]` 推論,w-converhp 之序列化未另實測),故前端明示傳 `select(undefined)` 者到達本套件為 `null` 而被 reject;不帶參數或僅帶回調函數之 `select()`(w-serv-webdata 客戶端 `args=[...arguments]`,回調函數被剔除)到達者為 `undefined`,照常.
- 盤點指令: Grep `src/getMapOrm.mjs` 搜 `getItemsNotObj\(|getErrFind\(|getMsgsBadKey\(|getOwnItem\(|need the result object`;並搜 `get\(woItems|get\(ds, woName|woItems\[|ds\[woName\]` 確認 woName 之每個查表處皆經 getOwnItem 或已由其保證(`ds[woName]` 於 `wo` 為自有屬性之後).
- 站點全集與判準(2026-10-17 重取,`src/getMapOrm.mjs`):
  - getErrFind `:501-523`(含 isPlainObj `:198-207`): select 之檢查 `:843`(早於 castIdFind 與 `wo.select`,`:850`)、delAll 之檢查 `:976`(早於 `wo.delAll` `:983`): 已套(select 為 2026-10-17 新增).
  - woName 檢查(規則 5): getOwnItem `:74-82`;execMapOrm 之查表 `:535` 與 reject `:539`(早於 isIdCast `:543` 與一切 ORM 呼叫);isIdCast 內 `:86`;getWoItems 之建表 `src/getWoItems.mjs:45`(defineProperty): 已套(2026-10-17 run02).`ds[woName]` 之直接取用(adjustData `:411`、`:490`)發生於 `wo` 已確認為 woItems 自有屬性之後(ds 與 woItems 不一致者另拋 Error 由 adjustData 之 catch 轉為字串): 刻意.
  - insert、save 之元素檢查(getItemsNotObj)`:576`;mix 之 input 檢查 `:697-700`、容器檢查與快照 `:702-709`、各段陣列檢查 `:711-716`、add 與 diff 之元素檢查 `:718-729`: 已套(2026-10-17 run02 重取).
  - del 之各筆: 刻意不套(交後端;del 之無效列為後端之逐筆失敗,R-PERITEM-01).
- 測試: `test/unit-pkcast.test.mjs` E01-E04;`test/unit-objcopy.test.mjs` D01-D04(D01 非純物件之語料 × 四種資料表型態 × select/delAll、D02 未給/undefined/`{}`/一般條件、D04 null 原型與跨 realm 之純物件照常、D03 字串且不回顯)、W01-W03(woName: 原型鏈名稱、路徑字串、非字串一律固定字串 reject 且 ORM 未被呼叫;ds 之鍵含 `.`、為 `constructor` 或 `__proto__` 者照常);`test/api-objcopy.test.mjs` A17、A18.

## R-MIX-01 mix 之跨段同鍵整批拒絕

- 狀態: 已套(1.1.10 之後,2026-10-14;裁示 D1,與 R-ID-02 同版).
- 單一擁有者: `src/getMapOrm.mjs` getMsgsMixSameId(比對與訊息)、getMixIdKey(比對用之鍵).
- 規則:
  1. mix 依 add、del、diff 之序執行.於任何步驟之前(R-INPUT-01 之形狀檢查、R-ID-02 之轉型、R-XSS-01 之主鍵預檢之後),比對 add 與 del、del 與 diff 之主鍵: 任一組含同一主鍵者整批 reject,不寫入任何一筆.
  2. 比對用之鍵: 非空字串取其值;有限數字取 `String(v)`(故整數主鍵欄之 5 與 `'5'` 亦視為同鍵);其餘(未提供)不參與比對.比對以 R-ID-02 轉型後之值為準.
  3. add 與 diff 同鍵者(insert 略過、save 更新)不遺失資料,不攔.
  4. 訊息只列位置、不回顯主鍵(del 之主鍵不經 XSS 檢查): `invalid input of mix, same id in add and del: add[0], del[1]`;兩組皆有者以 `; ` 串接;截斷與 10 筆上限同 R-MSG-01 規則 3.
  5. 同鍵之判斷只及於本套件正規化後之值;後端之寬鬆比對(Jet 不分大小寫等)本套件無從得知,不在此列(已知限制).
  6. **比對所見之主鍵即實際寫入或刪除所用之主鍵**(2026-10-20 第 82 項,B-02 ④ 與 F6,主控裁示 Q2(a)): ①比對鍵一律經 `getRowId`(R-OBJ-01 規則 7 ①)——只認自有可列舉之資料屬性; add、diff 列因此不再讀到不可列舉/繼承之 id(原誤拒為 `same id`,與 adjustData 之 `mapOwn` 實際寫入者不同); ②**mix.del 列**之 id 因交後端的是原物件(後端讀 id 之方式不一: w-orm-lowdb 的 cloneDeep 保留原型並執行 getter),本層無法保證與後端所讀一致,故 mix.del 列須滿足: 非 Proxy、原型鏈無標籤(`isCleanChain`)、沿原型鏈以描述子找 `id` 時,找到者須為**自有、可列舉**之資料屬性(不是繼承、不是存取器、不是不可列舉; 不存在可).**更正**(minimax F5): 首版允許不可列舉之自有 id(w-orm-lowdb 之 cloneDeep 不複製而視為無 id),但其餘後端之讀法未實測,改為 fail-closed; 列為函數(含 callable Proxy、宣稱標籤者)亦 reject(sol F02).不合者整批 reject `failed to delete data, unsupported irregular object or array: data[k]`,於任何步驟寫入之前(`getItemsIrregularId`).實測(修前,字串型表): add `[{id:'a7'}]` 加 del 列 `id` 為 getter(比對時回 `x`、其後回 `a7`)→ add 之 `a7` 隨即被後端刪除而 resolve(正是本規則欲防之資料遺失).一般 `del` 模式不受此檢查(R-INPUT-01 規則 2: 各筆交後端),僅 `getRowId` 與批次容器檢查生效.
- 依據: add 與 del 同鍵時 insert 因已存在而略過、del 隨即刪除,resolve 而資料遺失(審計 run01 全盤 M9: 呼叫端直接給同鍵者於 lmdb、lowdb、reladb 現況即遺失;R-ID-02 之轉型使 `ltdtDiffByKey` 以嚴格比對產生之 add 123、del '123' 成為同鍵,lmdb、reladb、mdb 皆遺失).del 與 diff 同鍵時 del 後由 save 以 diff 之部份欄位重新插入,其餘欄位遺失.ltdtDiffByKey 以嚴格比對產生之輸入本不會跨段同鍵,同鍵即表示輸入與後端之鍵語義不一致.
- 盤點指令: Grep `src/getMapOrm.mjs` 搜 `getMsgsMixSameId|getMixIdKey|mode === 'mix'`.
- 站點全集與判準(2026-10-17 重取): getMixIdKey `:332-337`、getMsgsMixSameId `:340-377`、execMapOrm 之 mix 檢查 `:764-769`(於形狀檢查 `:697-729`、R-OBJ-01 之鍵檢查 `:731-739`、轉型 `:741-749`、主鍵 XSS 預檢 `:751-762` 之後,第一個寫入 `:792` 之前): 已套.del、insert、save 模式無跨段,不適用.
- 實測(2026-10-14,`tmp/run02/review/out/rv-{lmdb,reladb,mdb}-fix.txt` A 段): 表內 `'123'`、mix 輸入為 `ltdtDiffByKey` 產生之 add `[123]`、del `['123']` → 三後端皆 reject `invalid input of mix, same id in add and del: add[0], del[0]`,表內不變(HEAD: lmdb 主鍵換新、reladb 表內清空、mdb reject `failed to insert data`).
- 測試: `test/unit-pkcast.test.mjs` M01;`test/api-pkcast.test.mjs` A10.
