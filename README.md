# w-serv-orm
An operator for orm in server.

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-serv-orm.svg?style=flat)](https://npmjs.org/package/w-serv-orm) 
[![license](https://img.shields.io/npm/l/w-serv-orm.svg?style=flat)](https://npmjs.org/package/w-serv-orm) 
[![npm download](https://img.shields.io/npm/dt/w-serv-orm.svg)](https://npmjs.org/package/w-serv-orm) 
[![npm download](https://img.shields.io/npm/dm/w-serv-orm.svg)](https://npmjs.org/package/w-serv-orm) 
[![jsdelivr download](https://img.shields.io/jsdelivr/npm/hm/w-serv-orm.svg)](https://www.jsdelivr.com/package/npm/w-serv-orm)

## Documentation
To view documentation or get support, visit [docs](https://yuda-lyu.github.io/w-serv-orm/WServOrm.html).

## 公開子模組(Public submodules)
下游(w-web-sso、w-web-api、w-web-task、w-web-perm 等)對本套件之深層匯入(`w-serv-orm/src/<檔>.mjs`)**只限下表〈公開(可深層匯入)〉所列之檔**；`src/` 下其餘 `.mjs` 皆為**內部檔**(見〈內部檔〉表)，不保證穩定(簽名、匯出與行為可於任何版本改動，且不列入 Breaking changes)，下游不得匯入。

本節之兩張表為「公開子模組清單」之**單一來源**：測試 `test/unit-publicmods.test.mjs` 把表與 `src/*.mjs` 實際檔案逐一比對(每個檔恰屬一表、匯入路徑與匯出名稱須與實際一致、每個公開子模組須有契約案)，新增、移除或改名任一 `src/*.mjs` 須同步更新本節，否則該測試判紅。

**穩定性承諾**(適用於公開表之各檔)：匯出名稱、參數、回傳值與錯誤語意不變；須改動時先列入下節〈Breaking changes〉再改。僅表中「穩定性承諾」欄所載之範圍受保證(例如錯誤訊息只保證起首之固定句，其後之提示句不在內)。

### 公開(可深層匯入)

| 檔 | 匯入路徑 | 匯出 | 用途 | 穩定性承諾 |
|---|---|---|---|---|
| `src/WServOrm.mjs` | `w-serv-orm/src/WServOrm.mjs` | `default` | 主入口：`WServOrm(ds, WOrm, url, db, opt)` 建立伺服器端 ORM 支援物件(`procOrm`、`withTabLocks`、`guardWrite`、擴充函數等) | 建構參數與回傳物件之成員(`woItems`、`procOrm`、`withTabLocks`、`guardWrite`、`addFunCheck`、`addFunPreProcessing`、`addFunPostProcessing`、`closeAll`、`backup`、`recover`)穩定，`opt` 之鍵依 JSDoc；`WOrm` 可傳替身(建構函數，收 `{ url, db, cl }`，回該表之實例)而不碰資料庫(測試用，見下〈測試組真實 procOrm〉) |
| `src/baseline.mjs` | `w-serv-orm/src/baseline.mjs` | `digestRow`、`buildBaseline`、`compareBaseline`、`checkContract`、`isBaselineValid`、`pickWriteRow`、`getRejectKey`、`cyrb53`、`BASELINE_VERSION`、`BASELINE_REJECT` | 純函數(零 import、前後端同構)：多人同時編輯之基準(摘要、比對)與寫入契約檢核，可由瀏覽器端深層匯入；詳見〈Concurrent editing〉 | 摘要演算法版本 `h1` 凍結(同一列同一契約算出同一摘要)；零 import 且語法限 ES2017 以內；匯出名稱與簽名穩定 |
| `src/safeKeys.mjs` | `w-serv-orm/src/safeKeys.mjs` | `SAFE_KEYS` | 本套件 funLog 所產生之 `safe` 頂層鍵名單，下游 `genDiagFunLog(write, { safeKeys: SAFE_KEYS })` 之單一來源(見〈公開 `SAFE_KEYS`〉) | 凍結之字串陣列、零 import；名單新增鍵不視為破壞，刪除或改名列入 Breaking changes |
| `src/checkOptRemoved.mjs` | `w-serv-orm/src/checkOptRemoved.mjs` | `default` | 包裝層(如 w-web-*)於建構自身之前，預先檢查 `opt` 是否帶有本套件已移除之設定(`useCheckUser`、`getUserById`、`useExcludeWhenNotAdmin`)；判準與訊息之單一擁有者為本套件(`WServOrm` 建構亦呼叫同一函數) | 同步；上述三鍵之值為 `undefined`、`null`、`false` 者通過(回傳 `undefined`)，其他值拋 `Error`，訊息起首為 `opt.<鍵> has been removed, `(其後之提示句不在承諾內)；多鍵違規時依 `useCheckUser`、`getUserById`、`useExcludeWhenNotAdmin` 之序報第一個；只看這三鍵、不改動 `opt`；受檢鍵之增減列入 Breaking changes |
| `src/getDb.mjs` | `w-serv-orm/src/getDb.mjs` | `default` | 離線維運工具(如各 w-web-* 根目錄之 `g_backupDb.mjs`)：`getDb.backup(woItems, opt)` 備份各資料表至檔案，`getDb.recover(woItems, fp, opt)` 由備份檔以 `insert` 還原(參數順序與 `WServOrm` 實例上之 `recover(fp, woItems, ...)` 不同) | `backup` 寫出 `backup-時間.json`，落於**模組載入時**之工作目錄(載入後改變 cwd 不影響)，成功 resolve `undefined`，失敗 reject(外來錯誤之連線憑證已遮罩，見〈對外錯誤值〉)；`recover` 於備份檔不存在或內容無效時 reject，逐表 `insert` 失敗之語意見〈Rows〉；`opt.bRela`、`opt.ds`、`opt.genModelsByTabs`、`opt.fdModels`、`opt.bLog`、`opt.logDetail`、`opt.funLog` 見 JSDoc 與〈Diagnostic output〉 |
| `src/genTestData.mjs` | `w-serv-orm/src/genTestData.mjs` | `default` | 離線產製測試資料(如各 w-web-* 根目錄之 `g_initialTestData.mjs`)：`genTestData(ds, woItems, opt)` 預設逐表呼叫 `ds[表].funTestAndSave(woItems)`；`opt.mode` 為 `'funTest'` 時改呼叫 `ds[表].funTest(woItems)` 取資料列(可經同步之 `opt.hookFunTestData(rows)` 轉換)，再交 `woItems[表].save(rows)` | 逐表依 `ds` 之鍵序，任一表失敗即停止；`funTest` 模式 `save` 回報失敗(逐筆或聚合 `ok` 為 0)即拋 `Error`，訊息起首為 `failed to write test data into table[表名]: `；`mode` 非兩種值者同預設；`opt.bLog`、`opt.logDetail`、`opt.funLog` 見〈Diagnostic output〉 |

### 內部檔(不公開，不得深層匯入)

| 檔 | 不公開之理由 |
|---|---|
| `src/getMapOrm.mjs` | `procOrm` 之核心實作，簽名含內部參數(`diag`)且近期多次改動(2026-10-29 診斷輸出遷移曾使直接呼叫者之行為改變)；下游僅測試為組真實 `procOrm` 而匯入，改用 `WServOrm(ds, 替身WOrm, url, db)` 之 `procOrm` 即可(結果等價，見〈測試組真實 procOrm〉) |
| `src/getProc.mjs` | 擴充函數與 `procOrm` 之組裝，理由同 `getMapOrm.mjs`；下游以其建構期拋錯探測已移除之設定者，改用 `checkOptRemoved` 或 `WServOrm` 建構 |
| `src/getWoItems.mjs` | `WServOrm` 建立各資料表 ORM 實例之內部步驟，下游無匯入 |
| `src/getSettings.mjs` | 讀取設定檔之內部工具(診斷輸出行為見〈Diagnostic output〉)，下游無匯入 |
| `src/getDbBackupAndRecover.mjs` | 低階備份還原，為 `WServOrm` 實例上之 `backup`、`recover` 與 `getDb` 之內部實作，下游經此二者使用 |
| `src/getDiagBrief.mjs` | 診斷輸出之本套件設定與摘要函數(`genDiag`、`getBrief*`)，下游改用 wsemi 公開 API 與 `SAFE_KEYS` |
| `src/isOrmFail.mjs` | 判定 ORM 寫入回傳是否失敗之內部共用謂詞(見〈Rows〉) |

### 測試組真實 procOrm
下游測試要在不碰資料庫下取得真實 `procOrm`(含 `withTabLocks`、`guardWrite`)，傳替身 `WOrm` 給 `WServOrm` 即可，不必匯入 `getMapOrm.mjs`、`getProc.mjs`；探測「已移除之設定」用 `checkOptRemoved`(或觀察 `WServOrm` 建構之拋錯)，兩者之訊息與內部檢查逐值相同。

```js
import WServOrm from 'w-serv-orm/src/WServOrm.mjs'
import checkOptRemoved from 'w-serv-orm/src/checkOptRemoved.mjs'

// 替身 WOrm：建構函數，收 { url, db, cl }，回傳該表之替身(提供 select、insert、save、del、delAll 等)
function StubWOrm({ cl }) {
    return stubTables[cl]
}
let { procOrm, withTabLocks, guardWrite } = WServOrm(ds, StubWOrm, 'stub', 'stub', { funLog: () => {} })

checkOptRemoved({ useCheckUser: true }) // 拋 Error: opt.useCheckUser has been removed, ...
```

## Conditions (find) and delAll
`procOrm` 之 `select`、`delAll` 之條件(find)僅支援 w-orm 系列白名單，由各 `w-orm-*` 後端依相同規則檢核(須為已實作該白名單之 `w-orm-*` 版本；舊版或尚未更新者仍可能接受白名單外之運算子，不在下述保證內)，本套件不依運算子放行或攔截(僅把字串型主鍵條件中的有限數字轉為字串，見 JSDoc)：
* 欄位等值 `{ 欄: 純量 }`(多欄為 AND)；欄位運算子 `$eq $ne $gt $gte $lt $lte`(值為純量)與 `$in $nin`(值為純量陣列)；文件層 `$and $or`(值為條件物件之非空陣列)。純量為字串(不含 NUL 字元與孤立代理字元)、有限數字、布林、有效 Date，`null` 僅可用於欄位等值、`$eq`、`$ne`。欄名、清單長度與巢狀深度等另有上限，完整規則見各 `w-orm-*` 之文件。
* 白名單外之運算子(例如 `$not $nor $regex $options $exists $all $where $expr`)、欄位層 `$and/$or`、函數值、`undefined` 值、空的 `$nin/$and/$or` 等由後端整批 reject，`procOrm` 以固定字串回傳(`select` 為 `failed to select data`，`delAll` 為 `failed to delete data`)，後端錯誤原文預設不輸出，只在診斷輸出之細節(`opt.logDetail` 或 `opt.funLog`，見下節 Diagnostic output)，`delAll` 不刪除任何數據。
* `select` 未給、為 `undefined` 或 `{}` 回傳全部數據；傳了值卻不是條件物件(`null`、陣列、字串、數字、布林、函數、類別實例等)整批 reject。
* 條件內任何位置(含 `$and`/`$or` 元素與欄位運算子物件)若有 Symbol 鍵、不可列舉鍵(`invalid find of select, unsupported symbol key or non-enumerable property`)，或 Proxy(含已撤銷者、原型為 Proxy 者)、帶 `Symbol.toStringTag` 者(含 Map、Set 等內建品牌物件)、內建品牌物件(含原型被改為 `null` 者)、非純物件(類別實例、偽原型等)、有空洞或額外屬性或不可列舉元素之陣列、帶自有屬性之 Date、函數值、Symbol 值(`invalid find of select, unsupported irregular object or array`)，整批 reject(`delAll` 同)，不查詢亦不刪除，且檢查期間與拒收後之診斷輸出皆不執行使用端程式(Proxy 陷阱、getter、`Symbol.toStringTag`、`util.inspect.custom`；被拒條件之診斷輸出，預設只列拒收原因，不含條件值；`opt.logDetail` 為 `true` 或 `opt.funLog` 收到之細節為本層建立之純資料快照，字串長度、層數與項數有上限)。這些結構在字串型主鍵表之轉型複製時會被洗掉，令後端本會拒收之條件變成較寬甚至無條件；JSON 資料通道無法產生這些結構。以 Proxy 包裝之條件(如 Vue 響應式物件)或 Mongoose、Sequelize 等文件須先轉為純物件(如 `{ ...filter }` 或 `JSON.parse(JSON.stringify(filter))`)。跨 realm(如 `vm`)之純物件照常：於字串型主鍵表之複製位置(頂層、`$and`/`$or` 元素、`id` 之運算子物件)被複製為本 realm 物件，其餘位置原樣交後端，現行 `w-orm-*` 之條件白名單要求本 realm 物件，故會 reject。
* 條件內共用子結構(同一物件被多處引用，僅行程內可造，JSON 資料通道只能產生樹)：以最長路徑計深度(含循環)，超過 64 個容器層(物件與陣列各算一層)者 reject `invalid find of select, too deep`；依出現次數展開後之物件總數(不含陣列)超過 100,000 者 reject `invalid find of select, too large`(`delAll` 同)，不展開亦不查詢、不刪除；上限與後端 `cvOrmFind` 之 `maxNodes` 同值，本層只計物件(後端另計運算子物件、純量，且不計 `$and`/`$or` 之陣列)，故凡本層因此拒收者後端必也拒收；同一子條件被重用於多處之合理寫法不受影響。物件或陣列之原型鏈長度超過 65 層者視為不乾淨而 reject `unsupported irregular object or array`(合法物件之原型鏈至多數層)。
* **`delAll` 為破壞性操作，須審慎使用，非必要不用**(刪除單筆請用 `del`)：不給條件(未給、`undefined` 或 `{}`)即刪除全部數據，不另行確認；給了條件才是部分刪除。經資料通道(前端直接操作資料表)呼叫之 `delAll` 與此語意一致，不另加通道專屬限制，授權由開放處負責。條件值若來自可能為 `undefined`、`null` 或空陣列之變數，呼叫端須先自行判斷；經 JSON 傳輸時顯式傳入之 `undefined` 會成為 `null` 而被 reject，須省略參數或傳 `{}`。建議先以 `select(find)` 確認命中範圍再刪除(ORM 啟用快取而他方已寫入時，`select` 可能回傳快取，而 `delAll` 一律直讀資料庫，預覽不保證即實際刪除之集合)。

## Rows (insert, save, mix, del)
`insert`、`save`、`mix`(`add`、`del`、`diff`)與 `del` 之輸入列的檢查(皆於任何寫入之前整批 reject，訊息為固定字串，不回顯使用端之值；通過檢查之後，本層不再執行使用端程式——不呼叫 getter、setter 與 Proxy 陷阱，複製只取已驗證之資料)：
* 列之主鍵 `id` 只認**自有、可列舉之資料屬性**(以屬性描述子讀取，不執行 getter)：通過鍵檢查後，不可列舉、繼承而來或經存取器取得者視為未提供，寫入列由本套件補主鍵(與直接呼叫 ORM 寫入不可列舉之 `id` 時一致)；自有可列舉之存取器(`get id()` 定義於列本身)則先整批 reject(`unsupported accessor property: data[k]`)。字串型主鍵欄之有限數字 `id` 僅在其為自有可列舉資料屬性時轉為字串。
* 列本身為 Proxy(含 Vue 響應式物件與已撤銷者)、函數(含 callable Proxy 與宣稱 `Symbol.toStringTag` 之函數)、原型鏈上有 `Symbol.toStringTag` 者、或 `util.types` 可辨識之內建品牌物件(Map、Set、WeakMap、WeakSet、Promise、ArrayBuffer、TypedArray、DataView、包裝物件、RegExp、Error 等，原型被改為 `null` 時無標籤可辨而會被洗成 `{}`)者 reject `failed to insert data, unsupported irregular object or array: data[0]`。`WeakRef`、`FinalizationRegistry`、`Intl.*`、`KeyObject`、`Blob`、`URL` 等宿主物件於原型被改為 `null` 時不辨識，結果與直接呼叫 ORM 一致(得到空物件：多筆批次中補主鍵而成只含主鍵之列，單筆批次則與直接以 `{}` 呼叫 ORM 相同，由後端視為無效而不寫入)。**以 Proxy 包裝之列或陣列(如 Vue 響應式)須先轉為純物件**(如 `{ ...row }`、`[...rows]` 或 `JSON.parse(JSON.stringify(rows))`)。類別實例含自有欄位之物件、`Object.create(proto)`、跨 realm 與 `null` 原型之列照常(僅複製自有可列舉鍵)，這與條件(find)要求純物件不同：條件被洗掉會使查詢或刪除範圍變大，列被洗掉頂多得到多餘或空的列。
* 批次容器(`insert`、`save`、`del` 之輸入陣列，`mix` 之 `add`、`del`、`diff`)須為乾淨之真密陣列，且各索引須為自有資料屬性：Proxy(含已撤銷者，無法分類為陣列或單一列，不帶位置)、原型鏈有標籤、有空洞(`unsupported sparse array: data[1]`，`data[k]` 為首個空洞)、索引為存取器者 reject；稀疏巨陣列如 `new Array(2**32 - 1)` 於首個空洞即被拒，不逐索引迴圈；列內巢狀陣列有空洞者亦然。偽造 `Symbol.toStringTag` 為 `Array` 之類陣列物件不視為陣列：`insert`、`save` 視為單一列並以 irregular reject，`mix` 之三段回 `need the result object of ltdtDiffByKey`，單獨 `del` 視為單一列交 ORM(`del` 之各筆不檢查，ORM 可依其自身判準處置)。
* `mix` 之輸入物件本身須為乾淨之一般物件(Proxy、原型鏈有標籤者 reject `invalid input of mix, need the result object of ltdtDiffByKey`)，`add`、`del`、`diff` 只取其自有資料屬性(繼承而來者不取，亦不執行原型上之 getter)。`mix` 之 `del` 列另須其 `id` 若存在為自有、可列舉之資料屬性(不得為存取器、繼承而來、不可列舉，列不得為 Proxy、函數宣稱標籤或帶標籤)，否則 reject `failed to delete data, unsupported irregular object or array: data[0]`，使 `add`/`diff` 與 `del` 之同鍵比對所見之 `id` 即 ORM 刪除所用之 `id`(ORM 對不可列舉或繼承之 `id` 讀法不一)。
* 稽核欄位(`userId`、`timeCreate`、`userIdUpdate`、`timeUpdate`，schema 的 keys 含者)以 `defineProperty` 寫入列物件而不用賦值，故類別 DTO 原型上之 setter 不被執行；字串主鍵之列其原物件仍被寫入這些欄位(既有行為)。
* 上述各項只可能由行程內呼叫端構造，JSON 資料通道(解碼為一般物件與密陣列)不可達，通道來源之一般輸入行為不變。列內欄位值為共用子結構(DAG)者，其展開由 `wsemi` 之 `clearXSS` 進行，本套件之走訪為線性。
* ORM 回傳之結果(規則帳本 R-ORM-RESULT-01)：寫入類函數(`insert`、`save`、`del`、`delAll`，含 `mix` 各步驟、`recover`、測試數據寫入)之回傳凡可表達失敗者一律檢查，失敗即 reject 或拋錯，不當成功；判準為聚合物件 `ok` 為 0，或逐筆陣列任一筆 `ok` 為 0。`save`、`del` 與 `mix` 之 `del`、`diff` 於 ORM 逐筆結果有任一筆 `ok` 為 0 時 reject(訊息列失敗筆之主鍵)；ORM 若改回聚合物件而 `ok` 為 0(非契約形狀，無從逐筆列出)亦視為失敗，固定字串 reject(`failed to save data`、`failed to delete data`、`mix` 之 `diff` 為 `failed to update data`)，`mix` 之 `del`、`diff` 遇此為整批性錯誤，立即 reject，後續步驟不執行。`delAll` 依契約回傳聚合物件且 `ok` 恆為 1，`ok` 為 0(或陣列形任一筆 `ok` 為 0)固定字串 reject `failed to delete data`。讀取類 `select` 之回傳為數據列(列內欄位可能名為 `ok`)，失敗只以 reject 表達，不檢查 `ok`。`insert`(含 `mix` 之 `add`)依 ORM 契約回傳聚合物件且 `ok` 恆為 1(錯誤皆整批 reject)；ORM 若 resolve 聚合物件而 `ok` 為 0，或回傳逐筆陣列(非 insert 契約形狀)而任一筆 `ok` 為 0(違約或他種後端)，亦視為失敗，固定字串 reject `failed to insert data`(ORM 回傳原文預設不輸出，見 Diagnostic output)，不回成功；已寫入之筆無從回復。`mix` 之 `add` 遇此為整批性錯誤，立即 reject，`del`、`diff` 步驟不執行。契約內之 ORM(`ok` 為 1，含略過既有主鍵之 `n` 為 0)行為不變；回傳 `undefined`、`null`、無 `ok` 鍵之物件、空陣列或逐筆皆 `ok` 非 0 之陣列者不檢查。備份還原 `recover`(`getDb.recover` 與 `WServOrm` 實例上之 `recover`)逐表以 `insert` 還原，同此判準：失敗時於該表停止並以 `Error` reject，訊息為 `failed to recover data into table[表名]: ` 接 ORM 回傳原文(逐筆陣列則列失敗筆 `{k,id,err}`，至多前 10 筆並附總筆數)，另列先前已寫入之表(`; tables already written: a, b`)；之後之表不寫入，先前之表與該表已被 ORM 寫入之筆無從回復(取捨：不繼續寫入其餘表以免擴大不一致，營運者依訊息清空已寫入之表後重跑)。

## Diagnostic output (console, logDetail, funLog)
寫入失敗、輸入被拒等情形，本套件會輸出一行診斷(原為 `console.log(標籤, 失敗列 {k, id, err} 或 ORM 錯誤原文)`)。行程標準輸出常被 pm2、容器 log 收集，而主鍵可能是使用者識別(email 等)，故**預設不輸出主鍵、資料值與錯誤原文**，改為只輸出標籤(含表名與操作)與不含個資的摘要。`procOrm` 的 resolve 與 reject 內容與時機不變(reject 的固定字串、逐筆失敗時列主鍵之訊息皆照舊)，只動診斷輸出；唯一刻意的差異：診斷輸出自身拋錯(如 console 格式化使用端物件時拋錯)時，舊版部分站點會使 `procOrm` 轉為 `failed to process input`，現一律吞下、結果不受影響。規則見規則帳本 R-DIAG-01。

**出口、遮罩、細節拷貝與錯誤摘要一律由 wsemi 之共用模組處理**(`wsemi/src/getDiag.mjs` 等，跨套件規格〈診斷輸出與遮罩〉，wsemi 規則帳本 R-DIAG-01；`logDetail`、`funLog`、`safe` 之正規化、細節之遮罩與拷貝之完整規則以 wsemi 各函數之 JSDoc 為準)，本套件只宣告其秘密來源(連線位址 `url`；`getSettings` 為讀入之設定檔帳密)、錯誤代碼集合、`safe` 會用到之鍵與各呼叫點(`src/getDiagBrief.mjs`)。對外之錯誤值(reject、throw)凡含外來值(ORM、檔案系統、擴充函數等使用端回呼拋出或 reject 之值)者，亦經 wsemi 移除本實例之連線憑證(見下〈對外錯誤值〉)。

```js
WServOrm(ds, WOrm, url, db, opt) // opt.logDetail、opt.funLog 皆選用
```

| 設定 | 型別 | 預設 | 行為 |
|---|---|---|---|
| (都不給) | — | — | `console.log(標籤, 摘要)`，摘要不含主鍵、資料值與錯誤原文(下表) |
| `opt.logDetail` | 布林 | `false` | `true` 時 console 輸出 `console.log(標籤, 細節)`，細節含主鍵 `id` 與錯誤原文，惟**連線憑證已遮罩**(`***`)，供除錯 |
| `opt.funLog` | 函數 `(label, safe, detail)` | 無 | 給予時診斷輸出只交給它，**本套件不寫 console**(含進度訊息、無效參數與設定檔錯誤；`logDetail` 亦不再作用)；`label` 為標籤，`safe` 為上述摘要(無則 `undefined`)，`detail` 為細節(含主鍵與錯誤原文，連線憑證已遮罩；無則不傳)，供使用端轉送至自己的 log。**細節一律為 wsemi 之 `maskDiagCopy` 所產生之遮罩拷貝**(有界之樹、不執行使用端程式、不交出原參照、不沿用使用端原型；憑證鍵名之值整體 `***`；形態與上限見 wsemi `maskDiagCopy` 之 JSDoc)，使用端原地改動不影響結果；被拒條件(find)的細節為本層建立之有上限純資料快照，再經同一拷貝。`funLog` 帶 `noDetail === true` 屬性者(wsemi `genDiagFunLog` 所產生者即是)只收 `(label, safe)`，本套件不取細節；`funLog` 同步拋錯、或回傳 rejected promise 皆被吞下(原生 Promise 標記已處理，一般 thenable 之 `then` 不被呼叫)，不影響結果 |

* 型別錯誤(`logDetail` 非布林、`funLog` 非函數；`undefined` 與 `null` 視為未給，同 `procOrm` 的 `opt` 與已移除設定的慣例)：`WServOrm` 建構時拋 `Error`(`invalid opt.logDetail, need a boolean`、`invalid opt.funLog, need a function`)，早於建立各資料表 ORM。選項只讀取一次(固定快照)，各實例各自持有，互不干擾。
* **`src/` 內所有診斷輸出都經 wsemi 之 `getDiag` 出口**(`src/` 內沒有任何直接的 `console` 呼叫，測試 S01 鎖定)，包含無效參數、進度、完成訊息與錯誤，一律寫 `console.log`(stdout)。摘要 `safe` 只保留本套件宣告之鍵(`n ks skipped ok type reason msgs table tables keys nOther`，恆含 `errType`、`errCode`)，值依 wsemi 之 safe 正規化(字串至多 200 字元、陣列至多 20 項等)。摘要的形狀(標籤沿用舊版，如 `users.save fail`)：

| 情形 | 摘要 `safe` |
|---|---|
| 逐筆失敗(`save`、`del`、`mix` 的 `del`/`diff`)、列不是物件、`del` 同批重複主鍵、主鍵會被 `clearXSS` 改寫 | `{ n: 失敗筆數, ks: [前 10 筆的位置 k] }` |
| ORM 回聚合物件或陣列而 `ok` 為 0(`insert`、`delAll`、違約形狀) | 聚合物件：`{ ok: 0 }`；逐筆陣列：`{ n, ks }`(元素為 Proxy、`ok` 或索引為存取器者不執行，不計入並加 `skipped: 個數`) |
| ORM 或後端 reject / 拋錯(`catch`)、`adjustData` 失敗、邊界保證 | wsemi `getDiagBriefErr` 之 `{ errType, errCode? }`：`errType` 只列內建錯誤類別名(`Error`、`TypeError` 等)，其餘(含驅動之類別名如 `MongoServerError`)為 `'Error'`，字串 reject 為 `'string'`；`errCode` 只收明列之代碼集合(系統與 Node 代碼恆含，本套件另宣告 `sqlstate sqlite mysql mssql mongo mongoServer lmdb level`，並讀巢狀之 `original`、`parent`)，不用樣式，訊息文字與其他值不列；標籤中的 mode 只放行固定清單、表名只放行 `woItems` 的自有鍵(**前提：資料表名由部署者於 schema 定義，視為非個資**) |
| 被拒的條件(find) | `{ reason: 固定的拒收句 }`，不含條件值 |
| 呼叫端傳入之無效參數(`ds`、`WOrm`、`url`、`db`、`woItems`、備份檔路徑 `fp`) | `{ type: 型別名稱 }`，不列值(`url` 可含連線帳密) |
| 本就只含固定句型與位置者(`data has unsupported key`、`same id across steps`) | `{ msgs: [訊息] }`(訊息不含主鍵) |
| 只有標籤者(`invalid batch container`、`row not found`、`backup finish`) | 無(`console.log(標籤)`) |
| 備份還原進度(`backup...`、`recover...`，表名取自 `woItems` 的自有鍵) | `{ table: 表名 }` |

* 工具路徑同樣處理，選項寫在各函數既有的 `opt`，**型別錯誤者忽略並用預設**(與同處的 `bLog` 一致)：`getDb.backup(woItems, opt)`、`getDb.recover(woItems, fp, opt)` 失敗時預設只輸出 `{ errType }`(`logDetail` 為 `true` 時為 `console.log('backup catch'或'recover catch', 細節)`)；`getDb.recover` 的 `bRela` 路徑傾印 schema 預設只列表名 `{ n, tables }`；`WServOrm(...)` 實例上的 `backup(woItems)`、`recover(fp, woItems, genModels, needCreateStorage)` 參數不變(各實例的函數身分不同)，診斷輸出依該實例的 `opt`；`genTestData(ds, woItems, opt)` 於 `bLog` 為真(預設)時預設只輸出 `{ n: 筆數 }`(非真陣列為 `null`)而不列資料列；`getSettings(opt)` 設定檔無效時預設只輸出已知設定鍵名與未知鍵的個數 `{ keys, nOther }`，不傾印設定值，`logDetail`/`funLog` 之細節中之資料庫帳號、密碼與連線網址遮罩(秘密由讀入之設定導出)，讀取或解析錯誤(可含檔案路徑)預設只列錯誤類別。工具路徑(`getDb`、`genTestData`)無連線網址可宣告，其細節與對外錯誤值只依 wsemi 之網址帳密、憑證鍵值對與 Bearer 樣式遮罩；實例上之 `backup`、`recover` 依該實例之 `url`。
* 使用端建議：**w-web-* 等會把行程標準輸出交給 pm2 或容器收集的服務，建議以 `opt.funLog` 接管**，伺服端以 wsemi `genDiagFunLog(write)` 之 `funLog` 傳入即只寫安全摘要(`{ event: 'orm-diag', label, safe }`，不取細節)；不需要細節者不傳任何選項即可，預設已不含個資。已知差異：`procOrm` 逐筆失敗的 **reject 訊息**(如 `failed to save data: id[...]`)列主鍵(識別值，回傳契約)，仍會隨 reject 交給呼叫端，使用端須自行處理其落地。

### 公開 `SAFE_KEYS`(本套件 funLog 所產生之安全摘要的鍵名單)

下游伺服端(w-web-sso、w-web-api、w-web-task、w-web-perm 等)以 wsemi 之 `genDiagFunLog(write, { safeKeys })` 接管本套件之 `opt.funLog` 時，`safeKeys` 應傳本套件公開的 `SAFE_KEYS`：它是本套件 `safe`（上表）頂層鍵的**單一來源**（本套件自身的 `getDiag` 亦以它為白名單），使轉寫至伺服器日誌的 `safe` 只含本套件宣告之鍵（`errType`、`errCode` 由 wsemi 恆含，不列於名單）。**下游不得深層匯入本套件的內部檔**（如 `src/getDiagBrief.mjs`；可深層匯入之檔見〈公開子模組〉）。

```js
import genDiagFunLog from 'wsemi/src/genDiagFunLog.mjs'
import { SAFE_KEYS } from 'w-serv-orm/src/safeKeys.mjs'

let { funLog } = genDiagFunLog(write, { safeKeys: SAFE_KEYS }) // write(o)：o 為 { event, label, safe }
let so = WServOrm(ds, WOrm, url, db, { funLog })
```

* `SAFE_KEYS` 為凍結的字串陣列（目前為 `n ks skipped ok type reason msgs table tables keys nOther`），模組零 import（`w-serv-orm/src/safeKeys.mjs`，與 `baseline.mjs` 同為深層匯入之公開子模組）；名單內容以測試（`test/unit-diagsafe.test.mjs`）對本套件各站點**實際產出**之鍵雙向比對，新增 `safe` 鍵須同步登錄於此，否則該測試判紅。
* 名單外的鍵（含憑證鍵名與巢狀物件之鍵）於產生端與轉寫端皆被丟棄，不會進入伺服器日誌。

### 對外錯誤值(reject、throw)不含連線憑證

* **外來值**(ORM、檔案系統、ORM 建構子、擴充函數〔check、前處理、後處理〕、`genTestData` 之 `funTest`/`funTestAndSave`/`hookFunTestData`、`recover` 之模型產生器拋出或 reject 之值)於本套件之 catch 站點經 wsemi `diag.err`：含本實例連線憑證(連線字串整串、密碼、`帳:密`、查詢參數之秘密值等)、網址帳密或憑證鍵值對者，改為**同類別之副本**(`instanceof` 與 `code` 等自有屬性保留，訊息之憑證為 `***`，呼叫端原物件不被改動)；無須處理者回**原物件**(身分不變)。只遮憑證：單獨帳號、儲存路徑(`err.path`)、主鍵等識別值不遮。
* **本套件以固定詞彙組成之 reject 與 throw 一律原樣**(如 `failed to save data`、`failed to save data: id[...]`、`rowNotFound`、`invalid woItems`、`addFunCheck needs a function, but got ...`)：即使密碼為其子字串也不挖空(挖空會反推短密碼)。`procOrm` 之 ORM 錯誤本即只以固定字串轉出，不受影響。
* 工具路徑之失敗訊息(`recover` 之 `failed to recover data into table[表名]: ...`、`genTestData` 之 `failed to write test data into table[表名]: ...`)只對其中 ORM 回傳原文(含逐筆 `err`)之段經 wsemi `diag.mask`，固定前綴與表名原樣。
* `withTabLocks` 之 `fn` 與 `guardWrite` 之 `read`、`write` 之 reject 原樣轉出(其多為 `procOrm` 之固定詞彙，須原樣供 `getRejectKey` 判讀)。

## Breaking changes

* **2026-10-31(公開子模組清單)**：
  * 新增公開子模組(純新增，既有行為不變)：`src/checkOptRemoved.mjs`、`src/getDb.mjs`、`src/genTestData.mjs`，連同既有之 `src/WServOrm.mjs`、`src/baseline.mjs`、`src/safeKeys.mjs`，用途、匯入路徑、匯出與穩定性承諾見〈公開子模組〉。
  * 明定 `src/` 下其餘 `.mjs` 為內部檔，不再保證穩定、不列入 Breaking changes：`getMapOrm.mjs`、`getProc.mjs` 不公開，原直接匯入此二檔以組真實 `procOrm` 者(僅下游測試)，改用 `WServOrm(ds, 替身WOrm, url, db)` 之 `procOrm`(結果等價)，探測已移除之設定改用 `checkOptRemoved`；本套件之程式行為未變。
* **2026-10-30(診斷輸出收斂為 wsemi 公開 API;wsemi ≥ 1.9.33)**：
  * **刪除 `src/getDiagBrief.mjs` 匯出之 `getUrlSecrets(url)`**：改為 wsemi 的 `getDiagSecrets({ conns: [url] })`（連線字串〔含 `://` 或 `@`〕列為網址，其餘〔檔案型資料庫之位置〕列為儲存路徑，與舊函數結果相同）。原深層匯入 `w-serv-orm/src/getDiagBrief.mjs` 取 `getUrlSecrets` 者（w-web-task 之 `server/genDiag.mjs`、w-web-perm 之 `server/maskRaw.mjs`）須改用 `getDiagSecrets({ conns })`；`getDiagBrief.mjs` 為本套件內部檔，不再提供給下游。
  * **公開 `SAFE_KEYS`**：`import { SAFE_KEYS } from 'w-serv-orm/src/safeKeys.mjs'`（用途與用法見上節〈公開 `SAFE_KEYS`〉）。
  * 本套件不再匯入 wsemi 之底線內部檔（`_diagKit.mjs`）：`isProxy` 改用 wsemi 公開之 `wsemi/src/isProxy.mjs`，描述子與自有鍵判斷改用內建 `Object.getOwnPropertyDescriptor`、`Object.prototype.hasOwnProperty.call`。
* **2026-10-29(診斷輸出改用 wsemi 共用模組;wsemi ≥ 1.9.31)**：
  * `opt.logDetail`、`opt.funLog` 之細節**開始遮罩連線憑證**(舊版原樣，含 `getSettings` 之 `dbPassword`)，且一律為拷貝(舊版部分站點交 `funLog` 原參照)；拷貝不再沿用使用端之原型(類別實例之副本為一般物件，錯誤之副本為內建錯誤類別)，形態標記依 wsemi `maskDiagCopy`(如 `Promise` 為 `[Promise]`、無法讀取之 `stack` 為 `[Stack unavailable]`)。
  * `logDetail` 之輸出一律為 `console.log(標籤, 細節)`：舊版 `getDb.backup`/`getDb.recover` 失敗、`getSettings` 讀取失敗之 `console.log(err)`(無標籤)改為帶標籤(`backup catch`、`recover catch`、`getSettings catch`)。
  * 摘要 `safe` 之形狀：備份還原進度由表名字串改為 `{ table: 表名 }`；`data has unsupported key`、`same id across steps` 由訊息陣列改為 `{ msgs: [...] }`；白名單外之鍵丟棄。
  * `errType` 只列內建錯誤類別名(驅動之類別名如 `MongoServerError` 改為 `Error`)；`errCode` 由樣式白名單改為 wsemi 明列之代碼集合(未明列之整數與字串不再列出，如 `ERR_DUP_KEY`、`987654321`)。
  * 對外錯誤值：外來值含本實例之連線憑證者改為副本(見上節)；含憑證之擴充函數 reject、ORM 之 `close`/建構錯誤、`backup`/`recover`/`genTestData` 之外來錯誤，其訊息之憑證為 `***`。`recover`、`genTestData` 失敗訊息中之 ORM 回傳原文經遮罩。
  * 移除 `src/getDiag.mjs`(`getOptLog`、`getOptLogLoose`、`getDiag`、`getBriefErr`、`cpDetail` 等)；摘要函數 `getBriefFails`、`getBriefResult`、`getBriefType`、`getBriefCount` 移至 `src/getDiagBrief.mjs`。直接使用 `getMapOrm(ds, woItems, opt)` 者之 `opt.logDetail`/`opt.funLog` 型別錯誤不再拋錯(依 wsemi `getDiag` 之寬鬆讀取；型別檢核留在 `WServOrm` 建構子)。

## Concurrent editing (write contract, withTabLocks, guardWrite, mustExist, keepUserId)
供「多位使用者可同時編輯、且可能開著舊畫面存檔」之後台使用：舊畫面存檔整次拒收(先動先贏、零寫入)，看著最新資料改者與不帶基準之寫入(外部同步、外部應用)照常寫入，已刪之列不復活，不部分寫入。規格見 opensrcOper 之 `dspec/多人同時編輯之寫入契約.md`；以下為本套件提供之部分。

### 部署前提
* **單一行程**；**同表只由同一個 `WServOrm` 實例與同一個 `withTabLocks` 寫入**(鎖只在該實例內有效，多行程部署不在支援範圍，須另採資料庫交易或條件寫入)。
* **比對用之讀取不得經 ORM 快取**：`guardWrite` 之 `read` 由呼叫端提供，須直讀資料庫；`mustExist` 之存在檢查為 ORM 之 `select`，故同表須只由同一 ORM 實例寫入且不開 `useCache`(各 `w-orm-*` 之快取只反映本實例之寫入，且寫入後即作廢)。
* 不提供雜湊快取與 `getTabHash`：基準由使用端對「畫面所見之列」自算，伺服端於鎖內以新鮮讀取重算。

### 純函數子模組 `w-serv-orm/src/baseline.mjs`(零 import，前後端同構)
```alias
import { digestRow, buildBaseline, compareBaseline, checkContract, isBaselineValid, pickWriteRow, getRejectKey, cyrb53, BASELINE_VERSION, BASELINE_REJECT } from 'w-serv-orm/src/baseline.mjs'
```
使用端以深層匯入打包至瀏覽器；檔內只用標準全域、語法限 ES2017 以內，測試於只有標準全域之 `vm` 驗證算出與 Node 相同之摘要。

每張表一份**寫入契約**(前後端 import 同一檔)：
```alias
export default {
    table: 'users',
    pk: 'id',
    fields: ['account', 'name', 'timeBlocked'], //入基準之欄位(白名單)＝存檔採用客戶端值之欄位；含後台可改且系統亦會寫之雙方欄位
    serverOnly: ['password'],                    //伺服器專有欄位：不入基準，存檔不採用客戶端值
    orderKey: 'order',                           //只限「存檔依列序重編 order」之表；其餘不設
    scope: null,                                 //函式；有則基準只含 scope 回傳真值之列，例 (r) => r.isApp === 'y'
}
```
`checkContract` 驗證契約：只允許 `table`、`pk`、`fields`、`serverOnly`、`orderKey`、`scope` 六鍵(含不可列舉鍵與 Symbol 鍵，拼錯之鍵拋錯)；`pk` 為非空字串；`fields` 為非空、不重複之非空字串陣列；`serverOnly` 與 `fields` 不得有交集；`orderKey` 不得在 `fields` 內亦不得等於 `pk`；`scope` 為函數。三個函數皆先驗證，不合者拋 `Error`，不靜默。

| 函數 | 說明 |
|---|---|
| `digestRow(row, contract)` | 依 `fields` 之宣告序取值，正規化後序列化取 cyrb53，回 `'h1:' + 14 位 16 進位`。欄位頂層之 `undefined`、`null`、`''`(含缺欄)為同一空值；`Date` 轉 ISO 字串；`BigInt` 轉十進位字串；物件鍵遞迴依碼元序排序，陣列保序；**數字與字串不互轉**(`1` 與 `'1'` 不同)；巢狀值只依 JSON 語意(物件鍵之值為 `undefined` 者略去、陣列內 `undefined` 為 `null`、巢狀之 `null` 與 `''` 不等價)；其餘非 JSON 值(function、symbol、`NaN`、`±Infinity`、無效 `Date`、`Map`、`Set`、類別實例、帶自有可列舉非索引屬性之陣列如 `toJSON` 等)與深度超過 100、單列節點超過 10 萬者拋 `Error`；列本身須為一般物件。只讀自有屬性。 |
| `buildBaseline(rows, contract)` | 先依 `scope` 過濾；主鍵(非空字串、有限數字與 `BigInt` 轉字串)缺漏或同批重複拋帶 `key: 'baselineFormat'` 之 `Error`；排序：有 `orderKey` 依(order 數值, 主鍵碼元序)，order 之有限數字、`BigInt`、整數字串作精確比較(超過 2^53 不轉 `Number`)，缺漏或無法轉數字者排最後；否則依主鍵碼元序，不用 `localeCompare`；回 `[[id, digest], ...]`，**陣列之序即名次**：他人重排會被偵測，系統重編號(名次不變)不會。逐列存檔之基準即只含該列。 |
| `compareBaseline(rowsNow, baseline, contract)` | 相符回 `{ ok: true }`；不符回 `{ ok: false, reason, added, removed, changed, reordered }`：`reason` 為 `'baselineMismatch'`、`'rowNotFound'`(基準只含一列且該列已不在、無新增列：逐列存檔時該列已被刪)或 `'baselineFormat'`(基準格式或版本不識，未比對)；`added`、`removed`、`changed` 為 id 陣列，`reordered` 為布林。不識之格式或版本一律 `baselineFormat`，**不得降級為不帶基準**。`rowsNow` 之主鍵缺漏或重複屬庫內資料異常，拋 `key` 為 `'rowsInvalid'` 之 `Error`(不與客戶端基準格式錯誤之 `baselineFormat` 混為一類，使用端應視為伺服端錯誤)。 |
| `isBaselineValid(baseline)` | 基準格式是否合法：`[[非空字串 id, 'h1:' 加 14 位小寫 16 進位], ...]`、id 不重複，空陣列合法。 |
| `pickWriteRow(row, contract)` | 存檔寫入列之白名單：只留 `pk` 與 `fields` 內、列上自有且非 `undefined` 之欄位(新物件)；伺服器專有欄位、系統欄位與 `orderKey` 不輸出(`orderKey` 由使用端依列序補)。客戶端持舊列整列送出時，若不經此白名單，系統已改之伺服器專有欄位(如密碼、游標)會被回寫成舊值(規格 V5)。 |
| `getRejectKey(err)` | 統一取拒收鍵：字串原樣(`procOrm` 之 `'rowNotFound'`)、帶字串 `key` 之 `Error`(`guardWrite`)取其 `key`，其餘(一般例外)回 `null`。 |

### `withTabLocks(tableNames, fn)` 與 `guardWrite(...)`(`WServOrm(...)` 回傳物件之方法)
```alias
import WServOrm from 'w-serv-orm/src/WServOrm.mjs'
import { buildBaseline, pickWriteRow } from 'w-serv-orm/src/baseline.mjs'
import contract from './contractUsers.mjs'

let so = WServOrm(ds, WOrm, url, db)
let { procOrm, woItems, withTabLocks, guardWrite } = so

//逐列修改(只改不增): baseline 為前端開啟編輯時以 buildBaseline 對該列自算之 [[id, digest]]
async function saveUser(userId, row, baseline) {
    return guardWrite({
        tables: ['users'],
        read: () => woItems.users.select({ id: { $in: [row.id] } }), //新鮮讀取, 不經快取；逐列存檔只讀該列
        baseline, //undefined 為不帶基準之寫入(外部應用), 仍取鎖
        contract,
        write: async () => {
            //同一表鎖內: 該列已被刪則 reject 'rowNotFound'(零寫入), 不會復活; 只寫白名單欄位(pk 與 fields), 伺服器專有欄位不回寫舊值
            return procOrm(userId, 'users', 'save', [pickWriteRow(row, contract)], { mustExist: true })
        },
    })
}

//整表存檔: read 讀整表(或 scope 內之列), baseline 為載入時所見之整表；write 內依基準內且在 scope 內之 id 計算刪除集合
//(不得用「庫內全部 − 送出」，會刪掉他人於載入後新增者)，再以 procOrm 之 mix 寫入
async function saveUsersAll(userId, diff, baseline) {
    return guardWrite({
        tables: ['users'],
        read: () => woItems.users.select({}),
        baseline,
        contract,
        write: async (rowsNow) => procOrm(userId, 'users', 'mix', diff),
    })
}

//外部同步、系統直寫雙方欄位: 不帶基準, 但取同一表鎖
await withTabLocks(['users'], async () => {
    await procOrm('sync', 'users', 'delAll', {})
    await procOrm('sync', 'users', 'insert', rowsFromExternal)
})
```
* `withTabLocks`：每個實例一個鎖管理器(`wsemi` 之 `pmKeyMutex`)，每表一鍵；`tableNames` 為本實例資料表名之非空陣列(拼錯之表名拋 `Error`)，去重後依表名碼元序取鎖(多表呼叫之順序固定，不死結)；回傳 `fn` 之結果，`fn` 拋錯亦釋放。**不可重入**：`fn` 內不得再對同表呼叫 `withTabLocks` 或 `guardWrite`(排隊等自己，永不返回)；**巢狀取不同表亦有死結風險**(每次呼叫內雖依碼元序取鎖，跨層次序不受控：一個呼叫先持 `b` 再等 `a`、另一個先持 `a` 再等 `b` 即互等)，故須**一次宣告全部要用之表**(如 `['users', 'tokens']`)，不得於 `fn` 內再取其他表之鎖；若必須巢狀，所有呼叫路徑須依同一全域遞增次序。與逐列實體之業務鎖並用時先取表鎖、後取實體鎖。
* `guardWrite({ tables, read, baseline, contract, write })`：取鎖 → `read()`(須 resolve 陣列) → `compareBaseline` → 不符即 reject → `write(rows)`；比對與寫入在同一表鎖內，其間插不進其他寫入。`baseline` 為 `undefined` 才跳過比對(仍取鎖與讀取)；`null` 與其他值皆比對，格式不合即 `baselineFormat`。不符時 reject 一個 `Error`：`message` 與 `key` 皆為固定英文拒收鍵(`baselineMismatch`、`rowNotFound`、`baselineFormat`)，另附 `added`、`removed`、`changed`、`reordered`，`write` 不被呼叫。`write` 自身之 reject(如 `procOrm` 之字串)原樣轉出，使用端以 `getRejectKey(err)` 取拒收鍵。`rowsNow`(`read` 之回傳)之主鍵缺漏或重複為庫內資料異常，reject 之 `Error` 其 `key` 為 `'rowsInvalid'`，非 `baselineFormat`。`contract.table` 若有須在 `tables` 內。

### `procOrm(userId, woName, mode, input, opt)` 之 `opt.mustExist`(只改不增、刪除回報未命中)
`opt` 為選用之第 5 參數，既有四參數呼叫之行為不變。目前有兩個布林鍵：`mustExist`(只適用 `save` 與 `del`，本節)與 `keepUserId`(只適用 `insert`，見下一節)；用於不適用之 mode、未知鍵、非布林者於任何讀寫之前(含早於擴充函數)以固定字串 reject，如 `invalid opt of procOrm, mustExist supports only save and del`。以下為 `{ mustExist: true }`：
* `save`：寫入前以 `select({ id: { $in: [...] } })` 分批(每批至多 1000 個主鍵，避開各 `w-orm-*` 共用條件檢核之 `$in` 上限 10000)檢查全部列(含補主鍵後)皆已存在，任一列不存在(含未帶主鍵者)即整批 reject `'rowNotFound'` 且**零寫入**；並轉傳 `autoInsert: false` 給 ORM 之 `save`，已被刪除之列不會復活。
* `del`：先檢查全部列皆存在，任一列不存在(含無有效主鍵者)即整批零刪除並 reject `'rowNotFound'`；同批重複之主鍵整批 reject `'invalid input of del, duplicate id: data[k]'`(列其位置，零刪除；否則第 1 筆刪除後第 2 筆必未命中)。未帶 `mustExist` 之 `del` 仍回 ORM 之逐筆結果，未命中為 `{ n: 0, nDeleted: 0, ok: 1 }`，不視為錯誤。
* 檢查之後 ORM 仍回報逐筆未命中者(表鎖紀律被破壞)亦 reject `'rowNotFound'`，已寫入或刪除之筆無從回復。
* **存在檢查與寫入非原子，須於該表之表鎖內呼叫**(`withTabLocks` 或 `guardWrite` 之 `write` 內)；`procOrm` 本身不取鎖。擴充函數(`addFunCheck`、前後處理)之參數物件不含 `opt`。
* **w-orm-mdb**：其 Jet 比對不分大小寫(且忽略尾端空白)，而存在檢查以嚴格字串相等比對，故於 mdb 可能把「ORM 會命中」之列判為不存在而 reject `'rowNotFound'`(零寫入)——這是**收嚴方向**(寧可誤拒、不誤寫)，不是放寬；使用端若以 mdb 為後端，主鍵之大小寫與尾端空白須與庫內一致。

### `opt.keepUserId`(insert 保留列上之 `userId`，如權杖之擁有者)
預設 `procOrm` 於 `insert` 把列上之 `userId`(schema 之 keys 含者)一律設為第 1 參數(操作者)，`userIdUpdate` 亦同。當 `userId` 之語意是「擁有者」而非「建立者」(例如 w-web-sso 之 `tokens.userId` 為權杖擁有者，而寫入者為代為建立之操作者)，以 `{ keepUserId: true }` 保留擁有者，並讓稽核欄位仍記操作者：

```js
//操作者'admin-1'替擁有者'owner-1'建立權杖: 庫內 userId 為 'owner-1'，userIdUpdate 為 'admin-1'
await procOrm('admin-1', 'tokens', 'insert', [{ id: 't1', userId: 'owner-1', name: 'tk' }], { keepUserId: true })
```
* 只適用 `insert`；用於 `save`、`del`、`select`、`delAll`、`mix` 或無效 mode 者於任何讀寫之前 reject `invalid opt of procOrm, keepUserId supports only insert`，非布林者 reject `invalid opt of procOrm, keepUserId needs a boolean`，未知鍵(含拼錯，如 `keepuserid`)reject `invalid opt of procOrm, unsupported key`，皆零讀寫、擴充函數(check、前處理)亦 0 次呼叫。`{ keepUserId: false }` 於各 mode 無效果，等同未給。
* **逐列判定**：該列自有、可列舉之資料屬性 `userId` 為**非空字串**者保留(單純空白字串亦屬非空字串)；缺欄、空字串、`null`、`undefined`、非字串、繼承而來或不可列舉者視為未提供，照現行以操作者補。保留之值與其他字串欄位同，仍經 `clearXSS` 清除。
* `userIdUpdate`、`timeCreate`、`timeUpdate` 照現行(`userIdUpdate` 恆為操作者；呼叫端給之值皆被覆寫)。schema 之 keys 不含 `userId` 之表，`keepUserId` 無效果。判定之依據是前處理(`addFunPreProcessing`)改寫後、進入 ORM 之列。
* `save` 現行即不覆寫列上之 `userId`(只補 `userIdUpdate`、`timeUpdate`)，擁有者語意之欄不被操作者覆寫，故 `save` 不需此選項；`mix` 之新增為內部步驟，不開放。
* 兩鍵可同物件給予，惟 `mustExist: true`(限 `save`、`del`)與 `keepUserId: true`(限 `insert`)無任何 mode 可同時為真：於 `insert` 以 `mustExist` 之句 reject，於 `save`、`del` 以 `keepUserId` 之句 reject；型別檢查先於 mode 檢查。

### 使用端之職責(本核心不代為處理)
* **所有寫入者取同一把表鎖**：後台存檔、逐列寫入、外部同步、系統直寫雙方欄位皆經同一實例之 `withTabLocks`／`guardWrite`；未取鎖之寫入者可插入比對與寫入之間。
* **寫入列只含白名單欄位**：用 `pickWriteRow`(或等效)，伺服器專有欄位與系統欄位不入寫入列。
* **整表存檔之刪除集合**＝基準內且在 `scope` 內之 id − 送出之 id；**不得**以「庫內全部 − 送出」(會刪掉他人於載入後新增者)。
* **外部同步沿用穩定 id**(依明確且唯一之來源識別)，內容不變則摘要不變；`withTabLocks` 只保證互斥。
* **前端**：以 `buildBaseline` 對畫面所見之同一快照自算基準；草稿保護(推播時不重建、凍結基準)屬前端；基準經實際傳輸路徑(資料通道或 RPC)後須仍等於伺服端新鮮讀取所算(型別漂移，如數字被傳成字串，會使摘要不同)，各使用端須以其實際傳輸路徑驗證。
* **同表只由同一 ORM 實例寫入、`read` 不經快取、單一行程**(部署前提)。

## Extension functions and `opt.onTrace`
`addFunCheck(f, opt)`、`addFunPreProcessing(f, opt)`、`addFunPostProcessing(f, opt)` 註冊之擴充函數屬於各實例，**註冊後約 1 毫秒(以計時器)才生效**，在此之前之 `procOrm` 呼叫不會套用。第 2 參數 `opt` 為選用，`opt.onTrace` 為觀察回調，於該擴充函數**實際生效**之當下同步呼叫一次，使用端(含測試)可據此得知「已生效」，不必等待固定毫秒：

```js
let so = WServOrm(ds, WOrm, url, db)
await new Promise((resolve) => {
    so.addFunPostProcessing(({ output }) => output, {
        onTrace: (e) => {
            //e = { type: 'active', hook: 'postProcessing', n: 1 }，已凍結
            resolve(e)
        },
    })
})
//此後之 so.procOrm(...) 必定套用該後處理
```
* 事件為凍結物件 `{ type: 'active', hook, n }`：`hook` 為 `'check'`、`'preProcessing'` 或 `'postProcessing'`，`n` 為該實例該類擴充函數生效後之總數(`addFunCheck` 註冊非函數時拋錯並令該實例之 `procOrm` 一律 reject，其恆 reject 之守門函數亦計入 `n`)。註冊時即拋錯者(非函數)不通知。
* 回調同步呼叫、不帶接收者；回調拋錯與回傳之 rejection 一律忽略，不影響註冊與 `procOrm`，回傳值不使用。未給 `opt` 或 `opt.onTrace` 非函數時行為同未支援前。
* 回調之事件格式由 `wsemi` 之 `getTrace`(`wsemi/src/getTrace.mjs`)統一處理，與其他自有套件之 `opt.onTrace` 一致。

## Installation

### Using npm(ES6 module):
```alias
npm i w-serv-orm
```

#### Example for server:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-serv-orm/blob/master/g-mOrm.mjs)]
```alias
// import WOrm from 'w-orm-mongodb/src/WOrmMongodb.mjs' //自行選擇引用ORM
import WOrm from 'w-orm-lowdb/src/WOrmLowdb.mjs' //自行選擇引用ORM
import ds from './schema/index.mjs' //先行建置schema
import WServOrm from './src/WServOrm.mjs'

// //st
// let st = {
//     dbUsername: 'username',
//     dbPassword: 'password',
//     dbName: 'wservorm',
//     dbIP: 'localhost',
//     dbPort: 27017,
// }

//url, db
// let url = `mongodb://${st.dbUsername}:${st.dbPassword}@${st.dbIP}:${st.dbPort}`
// let db = st.dbName
let url = './db.json'
let db = 'worm'

//WServOrm
let r = WServOrm(ds, WOrm, url, db)
console.log(r) //回傳server用orm相關函數
// => {
//   backup: [AsyncFunction: backup],
//   recover: [AsyncFunction: recover],
//   woItems: {
//     tests: EventEmitter {
//       _events: [Object: null prototype] {},
//       _eventsCount: 0,
//       _maxListeners: undefined,
//       select: [AsyncFunction: select],
//       insert: [AsyncFunction: insert],
//       save: [AsyncFunction: save],
//       del: [AsyncFunction: del],
//       delAll: [AsyncFunction: delAll],
//       selectGfs: [AsyncFunction: selectGfs],
//       insertGfs: [AsyncFunction: insertGfs],
//       delGfs: [AsyncFunction: delGfs],
//       delAllGfs: [AsyncFunction: delAllGfs],
//       [Symbol(kCapture)]: false
//     }
//   },
//   closeAll: [AsyncFunction: closeAll],
//   addFunCheck: [Function: addFunCheck],
//   addFunPreProcessing: [Function: addFunPreProcessing],
//   addFunPostProcessing: [Function: addFunPostProcessing],
//   procOrm: [AsyncFunction: procOrm]
// }

// export default r
```
