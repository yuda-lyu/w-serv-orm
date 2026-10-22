# 規則帳本(主鍵、條件(find)與 XSS)

本檔為 `rulebook.md` 之分檔(2026-10-22 依全域 §14 整理: 各節原文逐字搬移,節號與標題不變,未刪改)。索引與共通事項(系列規格、測試與 lint 指令、行號基準)見 `rulebook.md`。

## R-ID-01 未帶主鍵者由本套件補值並回傳

- 狀態: 已套(1.1.8;1.1.10 之後依 R-ID-02 修訂有效主鍵之判定與空物件列).
- 單一擁有者: `src/getMapOrm.mjs` adjustData(補值段)、isPkIdString.
- 規則:
  1. insert、save、mix 之 add 與 diff,數據未帶有效主鍵者補值.有效主鍵為非空字串;字串型主鍵欄之有限數字先依 R-ID-02 轉為字串,故剩餘之數字(NaN、±Infinity)與其他型別(null、''、布林、物件、陣列、Date、BigInt)皆視為未提供而補值.條件(即 isPkIdString): 主鍵欄為 id;有 settings 者須標為 pk;型別為 STRING、TEXT、CHAR、UUID、CITEXT 或未知(比對前取 `(` 之前之字並轉大寫,`STRING(36)` 視為 STRING).補值器為 wsemi 之 genIDSeq,與各 w-orm 後端相同.
  2. 補值寫於清除 XSS 後之複本,不改呼叫端之物件.
  3. 輸入依 wsemi 之 iseobj(單一物件)或 isearr(陣列)判為無效者不補,保留後端視之為無效輸入(規格 T5)而不寫入之行為: 即單一空物件 `{}` 與只含一個空物件之陣列 `[{}]`.其餘(含多筆批次中之空物件列)一律補值,令回傳之主鍵與後端實際寫入者一致.
  4. resolve 時回傳補出之主鍵;reject 時不回傳,故重送未帶主鍵之數據會重複寫入,需冪等者自帶主鍵.
- 測試: `test/unit-WServOrm.test.mjs` P01-P06;`test/api-procOrm.test.mjs` A05;`test/unit-mapOrm.test.mjs` X05、X07;`test/unit-pkcast.test.mjs` N05、N08、E04.
- 變更紀錄:
  - 1.1.8(原回傳 `{ id: undefined }`,即 `{}`).
  - 1.1.10 之後(2026-10-14): 數字不再視為有效主鍵(字串型主鍵欄之有限數字改由 R-ID-02 轉字串);多筆批次中之空物件列改為補值(原不補而後端補值寫入,回報 undefined);型別字串去參數後比對.

## R-ID-02 字串型主鍵欄之有限數字主鍵以其字串形式處置

- 狀態: 已套(1.1.10 之後,2026-10-14;裁示 D1、D2).
- 單一擁有者: `src/getMapOrm.mjs` isIdCast(是否適用)、castIdValue(值之正規化,唯一之轉字串處;寫入、刪除、查詢條件與 R-MIX-01 之比對鍵皆經此)、isIdNumFinite(唯一之「有限數字」判定)、castIdRows(寫入與刪除之列)、castIdFind 與 castIdCond(查詢條件).
- 規則:
  1. 適用: isIdCast 為真,即 ds 有該表且 isPkIdString 為真(見 R-ID-01 規則 1).ds 無該表者不適用,select、del 照舊原樣交 ORM 而不拋錯.主鍵欄為整數型等(isPkIdString 為假)者一律不轉型、不補值.
  2. 主鍵值為有限數字(`typeof v === 'number' && Number.isFinite(v)`;不用 wsemi isnum,因其對數字字串與 Infinity 亦為 true)者,以 `String(v)` 取代:
     - 寫入: insert、save(陣列與物件)、mix.add、mix.diff.
     - 刪除: del(陣列與物件)、mix.del;mix 回報之 del 列亦為轉型後之值.
     - 查詢條件: select、delAll 之 find 中 id 之值,及其 `$eq`、`$ne`、`$gt`、`$gte`、`$lt`、`$lte`、`$in`、`$nin` 之值(陣列逐一);遞迴進入文件層 `$and`、`$or` 巢狀.他欄與其餘運算子(`$regex`、`$exists` 等)不變.範圍只及系列條件白名單內之運算子(R-WL-01): 原亦轉型之 `$all`、`$not`(遞迴 id 條件內)與 `$nor`(遞迴巢狀)在白名單外,由後端 reject,2026-10-19 起不轉型(死碼已移除).
  3. NaN、±Infinity 視為未提供: 寫入時依 R-ID-01 補值;刪除與查詢條件原樣.
  4. 轉型寫於複本,不改呼叫端之物件與條件.
  4 續. **列之主鍵值只認自有可列舉之資料屬性**(2026-10-20 第 82 項,`getRowId`,R-OBJ-01 規則 7 ①): castIdRows(寫入與刪除之列)與 getMixIdKey、getItemsIdXSS 讀主鍵一律經 `getRowId`——不可列舉、繼承、經存取器之有限數字 id 不再轉字串(原被轉為自有可列舉字串 id 寫入,與直呼後端〔忽略之並產生新主鍵〕不同; 且 getter 於檢查後被執行); 視為未提供,寫入列由 adjustData 補主鍵,del 與 mix.del 列原樣交後端(mix.del 列另受 R-MIX-01 規則 6 檢查).
  5. 後處理之 input 為前處理後之 input(不含本套件之補值與轉型,主鍵可能仍為數字),output 為回報(主鍵為字串),見 R-HOOK-01 規則 5.
- 依據: 各後端之主鍵判準互異(lmdb、lowdb、level、mongodb 只認非空字串而以 genIDSeq 取代數字;reladb、mdb 之字串欄由資料庫把數字存為字串),原以「非空字串或數字」為有效而原樣回報,回報之 id 與實際寫入者不同、重送不斷新增、以回報 id 查不到刪不掉(審計 run01 全盤 M1-13～15).下游 perm、api 以 `String(id)` 判重.對標 Mongoose(寫入與查詢條件皆依 schema 轉型,含範圍運算子與 `$not`).
- 已知限制:
  - 範圍運算子轉型後依字串之字典序比較(與 reladb 現況、Mongoose 一致).
  - 數字之字串形式為 JavaScript 之 `String(v)`(`1e21` → `'1e+21'`);經 reladb(sqlite)、mdb(Jet)以數字直接寫入之舊資料,其存值格式可能不同(`'1.0e+21'`、`'1000000000000000000000'`),以數字查不到.一般十進位寫法之數字相同.
  - w-orm-mongodb 於 2025-04-29(`f08a173`)以前以 `if (!v.id)` 判定而保留數字主鍵,此類舊資料以數字查詢於轉型後查不到(轉型前 save、del 本已無法以數字操作).w-orm-lmdb、lowdb、level 自首版即取代非字串主鍵,無此情形.
  - 只作用於 procOrm;genTestData、recover、woItems 直寫不經轉型,依後端語義.
  - 回報之 id 為本套件依輸入(含補值與轉型)所得之預測,非後端之寫入結果;後端比對規則較寬者(w-orm-mdb 之 Jet 不分大小寫、忽略尾端空白),insert 略過或 save 命中之對象可能與回報不同.
- 盤點指令: Grep `src/getMapOrm.mjs` 搜 `castId|isIdCast|isIdNum`;並搜 `wo\.(select|insert|save|del|delAll)\(` 確認每個 ORM 呼叫之輸入皆經轉型或刻意不轉.
- 站點全集與判準(2026-10-14,`src/getMapOrm.mjs`):
  - 判定與正規化(2026-10-17 run02 重取): isIdCast `:84-92`(以 getOwnItem 取 ds 之表,見 R-INPUT-01 規則 5;execMapOrm 取用 `:543`,各模式共用同一判定)、isIdNumFinite `:95-98`、castIdValue `:101-106`、castIdRows `:274-284`、castIdCond `:287-299`、castIdFind `:302-316`(2026-10-19 重取): 單一擁有者.castIdCond、castIdFind 以 mapOwn 迭代(R-OBJ-01).
  - ORM 呼叫(盤點 `wo\.(select|insert|save|del|delAll)\(` 共 9 處): select `:555`(castIdFind)、insert `:613` 與 save `:620`(`:589-592` castIdRows)、del `:662`(`:656-659` castIdRows)、delAll `:688`(castIdFind)、mix 之 insert `:792`、del `:814`、save `:856`(`:741-749` 各段 castIdRows): 已套.
  - adjustData 之補值 `:485-499`: 消費轉型結果(有效主鍵只認非空字串),屬 R-ID-01.
  - getMixIdKey `:332-337`: 以 castIdValue 取比對鍵(與寫入、刪除同一正規化函數),不改輸入;不論 isIdCast 皆正規化,故整數主鍵欄亦以字串形式比對(R-MIX-01 規則 2): 刻意.
  - genTestData(`src/genTestData.mjs:49`)、recover(`src/getDbBackupAndRecover.mjs:100`)、woItems 直寫: 刻意不套(已知限制).
- 測試: `test/unit-pkcast.test.mjs` N01-N09(N03 為白名單內運算子之轉型;白名單外運算子見 R-WL-01 之 N10);`test/api-pkcast.test.mjs` A08、A09、A11、A12;既有 P02、X05、X07 依本規則改寫.

## R-WL-01 find 之條件白名單由各 w-orm 後端把關,本套件不另設白名單,只轉型白名單內之 id 條件

- 狀態: 已套(2026-10-19,第 33 項批 3;方案 `C:\opensrcOper\dnow\20261017093849\agent-out\run01-審計與方案.md` §4.5、§6.2、§6.4,D13).
- 單一擁有者: 白名單本身在各 w-orm-* 後端(select、delAll 入口以 wsemi 之 `cvOrmFind` 檢核;w-orm-lmdb、level、lowdb、mongodb、postgresql、reladb 已發布,mdb 批 2 進行中).本套件為轉手端: `src/getMapOrm.mjs` castIdCond、castIdFind(轉型範圍只及白名單內運算子)、execMapOrm 之 select、delAll 兩段 `.catch`(錯誤回傳路徑);說明文字在 `src/WServOrm.mjs` 類別 JSDoc.
- 規則:
  1. 系列白名單(dspec〈一之三〉): 頂層未給、`undefined`、`{}` 為全部,其餘須為條件物件;欄位等值 `{欄:純量}`;欄位運算子 `$eq $ne $gt $gte $lt $lte`(值為純量)、`$in $nin`(值為純量陣列);文件層 `$and`、`$or`.其餘(`$not $nor $regex $options $exists $type $where $expr $all $like $ilike` 等)由後端整批 reject.
  2. 本套件不實作、不重複白名單檢查(方案 D13: 不改核心邏輯): getErrFind 只檢查純物件、自有 `__proto__` 鍵、存取器與深度(R-INPUT-01、R-OBJ-01),與運算子無關;不依運算子名稱放行或攔截.
  3. castIdCond、castIdFind 只轉型白名單內之 id 條件: id 之值,及 `$eq $ne $gt $gte $lt $lte $in $nin` 之值(陣列逐一),並遞迴 `$and`、`$or`(R-ID-02 規則 2).`$not`、`$all`、`$nor` 在白名單外(後端 reject),原轉型分支雖仍會被執行(外審 sol 以還原變異證明可達),但其轉型後之條件必被後端整批 reject,屬無用之碼(方案稱「死碼」),已移除;白名單外運算子與其內之 id 值原樣交後端,不轉型.
  4. 白名單外之條件經後端 reject 時,本套件把後端錯誤原文只 console.log,以固定字串回傳(R-ERR-01 規則 1): select 為 `failed to select data`,delAll 為 `failed to delete data`;delAll reject 時表內容不變.
  5. 文件(使用者 2026-10-17 裁示): `WServOrm.mjs` 類別 JSDoc 須載明 select 之 find 說明(§6.3)與 delAll 使用須知(§6.2): 不給條件(未給、`undefined`、`{}`)即刪除全部數據,不另加通道專屬限制;delAll 須審慎使用、非必要不用;條件須符合系列白名單,傳非條件物件或白名單外運算子整批 reject.經資料通道(w-serv-webdata)呼叫之 delAll 與此一致.文字須與已發布之各 w-orm-* 之 select、delAll JSDoc(批 1)一致,並加註三項本層特有之限定(外審 sol F2、F3、F4): ①白名單保證以「已實作該白名單之 w-orm-* 版本」為前提,舊版不在保證內; ②經 JSON 傳輸時顯式傳入之 `undefined` 成為 `null` 而被 reject,須省略參數或傳 `{}`; ③「先 select 確認範圍再刪除」之預覽不保證即實際刪除之集合(ORM 啟用快取而他方已寫入時,select 可能回傳快取,delAll 直讀資料庫).README 之字串純量須含「不含 NUL 字元與孤立代理字元」.
- 依據: 後端白名單實作後,`$not $all $nor` 之 id 轉型結果必被後端 reject(真 lowdb 實測 `invalid find: unsupported operator [$not] at [find.id.$not]`),留著只會讓讀者誤以為這些運算子可用.
- 已知限制: 後端尚未收緊者(w-orm-mdb 批 2 發布前,及使用端自行選用之舊版 w-orm-*)仍接受 `$not` 等運算子時,`$not` 內之數字主鍵不再轉字串(字串型主鍵表以數字查詢將對不上); 此為白名單外之用法,升級後端即回到 reject.
- 盤點指令: Grep `src/` 搜 `\$not|\$nor|\$all`(只應在註解或本規則提及之處);Grep `test/` 搜 `\$not|\$nor|\$all`(命中只應為「白名單外原樣交後端」之行為鎖定與後端 reject 之案);Grep `src/getMapOrm.mjs` 搜 `castIdCond|castIdFind` 確認轉型運算子集.
- 站點全集與判準(2026-10-19,`src/getMapOrm.mjs`):
  - castIdCond `:287-299`: 轉型運算子 `$eq $ne $gt $gte $lt $lte $in $nin`,其餘原樣: 已套.
  - castIdFind `:302-316`: 遞迴 `$and`、`$or`,id 之條件經 castIdCond,他欄原樣: 已套.
  - select 之 `.catch` 固定字串 `:555-559`(其後 `:562-564` reject)、delAll 之 `.catch` 固定字串 `:688-692`(其後統一於 `:893-895` 之 `isestr(err)` reject): 已套(未變).
  - 說明文字: `src/WServOrm.mjs:24`(條件(find))、`:25`(delAll 使用須知),README「Conditions (find) and delAll」: 已套.
- 測試: `test/unit-pkcast.test.mjs` N03(白名單內運算子與 `$and`/`$or` 巢狀之轉型)、N10(`$not $all $nor` 及其內之 id 原樣交 ORM,不轉型;還原死碼分支則轉紅)、N11(後端以 Error 或字串 reject 時,select 為 `failed to select data`、delAll 為 `failed to delete data`,後端原文進 log,替身 ORM);`test/api-pkcast.test.mjs` A12(白名單內運算子與巢狀命中字串主鍵)、A19(7 種白名單外之條件經真 lowdb(>= 1.0.32)reject,固定字串回傳且表不變);`test/api-objcopy.test.mjs` A13、A14(白名單內條件之 JS 參考實作比對;原 `$nor` 條件與參考實作之 `$not`、`$nor` 已移除);`test/unit-objcopy.test.mjs` L01(id 條件物件含整數 length)、P01、T01、T02(深度與 `__proto__` 檢查與運算子名稱無關,T02 之合理查詢改用白名單內運算子,並以手寫預期斷言三層巢狀之最深 id 條件亦被轉型,外審 sol F6).
- 變異(2026-10-19,`tmp/mut/run.mjs` 16 種 + 基準,不入版控): 還原 castIdCond 之 `$not`/`$all` 分支、castIdFind 之 `$nor` 分支 → N10 轉紅(僅 N10);白名單內轉型被誤刪($nin、$gte、$and 遞迴、$or 遞迴、遞迴只做一層)→ N03、A12、T02 等轉紅;select、delAll 之 `.catch` 固定字串改壞、移除、改為重拋、吞掉 → N11、A19 轉紅;移除 select 的 console.log → N11 轉紅(詳見 `sgud/exp/experience.md` 同日一節).
- 變更紀錄: 2026-10-19 移除 `$not $all $nor` 之轉型分支(死碼),新增本規則.

## R-XSS-01 寫入路徑清除 XSS,字串主鍵會被改寫者整批拒絕

- 狀態: 已套(1.1.8).
- 單一擁有者: `src/getMapOrm.mjs` adjustData 之清除(`:476-483`)、getItemsIdXSS(`:380`)、getMsgIdXSS(`:394`).
- 規則:
  1. insert、save、mix 之 add 與 diff 寫入前,各欄位之字串皆經 wsemi 之 clearXSS.select、del、delAll、mix 之 del 不經清除.
  2. wsemi 須為 1.9.13 以上: clearXSS 只轉義會開始標籤之 `<`(後接英文字母、`/`、`!`、`?`)與段尾之 `<`,`>` 不轉義,數學式原樣保存.
  3. 字串主鍵若會被 clearXSS 改寫,整批 reject 且不寫入任何一筆.insert、save 於 adjustData 之前檢查;mix 於任何步驟之前檢查 add 與 diff.檢查之對象為 R-ID-02 轉型後之主鍵(數字轉成之字串不含標記,不受影響),順序見 R-INPUT-01 規則 4.
  4. 判準為「是否被改寫」: 數字主鍵(字串型主鍵欄先依 R-ID-02 轉為字串)、未帶主鍵、白名單標籤之規範寫法(如 `<b>粗體</b>`)照常寫入.
- 依據: 寫入路徑清除而查詢、刪除不清除,主鍵被改寫後以原主鍵查不到也刪不掉(真 lowdb 實測: select 回 0 筆,del 回 `{n:0,nDeleted:0,ok:1}` 而資料仍在).
- 盤點指令: Grep `src/` 搜 `clearXSS\(|getItemsIdXSS\(`.
- 站點全集與判準(2026-10-13):
  - `src/getMapOrm.mjs:480`(清除)、`:386`(判斷)、`:594-599`(insert、save 之檢查)、`:751-762`(mix 之檢查): 已套(2026-10-17 run02 重取).
  - select(`:555`)、del(`:662`)、delAll(`:688`)、mix 之 del(`:814`): 刻意不套(規則 1).
- 已知限制:
  - 1.1.8 以前存入之 `&lt;`、`&gt;` 不會還原;重送 `a < b` 對不上舊之 `a &lt; b`,save 會新增一筆,須由使用端盤查.
  - 本身即合法標籤者(如 `a<b and c>d`)仍被改寫為 `a<b>d`.
- 測試: `test/unit-mapOrm.test.mjs` X01-X07;`test/api-procOrm.test.mjs` A06、A07.
- 變更紀錄: 1.1.8 依賴 wsemi ^1.9.13,並新增主鍵拒絕.
