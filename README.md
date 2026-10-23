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

## Conditions (find) and delAll
`procOrm` 之 `select`、`delAll` 之條件(find)僅支援 w-orm 系列白名單，由各 `w-orm-*` 後端依相同規則檢核(須為已實作該白名單之 `w-orm-*` 版本；舊版或尚未更新者仍可能接受白名單外之運算子，不在下述保證內)，本套件不依運算子放行或攔截(僅把字串型主鍵條件中的有限數字轉為字串，見 JSDoc)：
* 欄位等值 `{ 欄: 純量 }`(多欄為 AND)；欄位運算子 `$eq $ne $gt $gte $lt $lte`(值為純量)與 `$in $nin`(值為純量陣列)；文件層 `$and $or`(值為條件物件之非空陣列)。純量為字串(不含 NUL 字元與孤立代理字元)、有限數字、布林、有效 Date，`null` 僅可用於欄位等值、`$eq`、`$ne`。欄名、清單長度與巢狀深度等另有上限，完整規則見各 `w-orm-*` 之文件。
* 白名單外之運算子(例如 `$not $nor $regex $options $exists $all $where $expr`)、欄位層 `$and/$or`、函數值、`undefined` 值、空的 `$nin/$and/$or` 等由後端整批 reject，`procOrm` 以固定字串回傳(`select` 為 `failed to select data`，`delAll` 為 `failed to delete data`)，後端錯誤原文只由 `console.log` 輸出，`delAll` 不刪除任何數據。
* `select` 未給、為 `undefined` 或 `{}` 回傳全部數據；傳了值卻不是條件物件(`null`、陣列、字串、數字、布林、函數、類別實例等)整批 reject。
* 條件內任何位置(含 `$and`/`$or` 元素與欄位運算子物件)若有 Symbol 鍵、不可列舉鍵(`invalid find of select, unsupported symbol key or non-enumerable property`)，或 Proxy(含已撤銷者、原型為 Proxy 者)、帶 `Symbol.toStringTag` 者(含 Map、Set 等內建品牌物件)、內建品牌物件(含原型被改為 `null` 者)、非純物件(類別實例、偽原型等)、有空洞或額外屬性或不可列舉元素之陣列、帶自有屬性之 Date、函數值、Symbol 值(`invalid find of select, unsupported irregular object or array`)，整批 reject(`delAll` 同)，不查詢亦不刪除，且檢查期間與拒收後之診斷輸出皆不執行使用端程式(Proxy 陷阱、getter、`Symbol.toStringTag`、`util.inspect.custom`；被拒條件以本層建立之純資料快照輸出至 `console.log`，字串長度、層數與項數有上限)。這些結構在字串型主鍵表之轉型複製時會被洗掉，令後端本會拒收之條件變成較寬甚至無條件；JSON 資料通道無法產生這些結構。以 Proxy 包裝之條件(如 Vue 響應式物件)或 Mongoose、Sequelize 等文件須先轉為純物件(如 `{ ...filter }` 或 `JSON.parse(JSON.stringify(filter))`)。跨 realm(如 `vm`)之純物件照常：於字串型主鍵表之複製位置(頂層、`$and`/`$or` 元素、`id` 之運算子物件)被複製為本 realm 物件，其餘位置原樣交後端，現行 `w-orm-*` 之條件白名單要求本 realm 物件，故會 reject。
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
* ORM 回傳之結果(規則帳本 R-ORM-RESULT-01)：寫入類函數(`insert`、`save`、`del`、`delAll`，含 `mix` 各步驟、`recover`、測試數據寫入)之回傳凡可表達失敗者一律檢查，失敗即 reject 或拋錯，不當成功；判準為聚合物件 `ok` 為 0，或逐筆陣列任一筆 `ok` 為 0。`save`、`del` 與 `mix` 之 `del`、`diff` 於 ORM 逐筆結果有任一筆 `ok` 為 0 時 reject(訊息列失敗筆之主鍵)；ORM 若改回聚合物件而 `ok` 為 0(非契約形狀，無從逐筆列出)亦視為失敗，固定字串 reject(`failed to save data`、`failed to delete data`、`mix` 之 `diff` 為 `failed to update data`)，`mix` 之 `del`、`diff` 遇此為整批性錯誤，立即 reject，後續步驟不執行。`delAll` 依契約回傳聚合物件且 `ok` 恆為 1，`ok` 為 0(或陣列形任一筆 `ok` 為 0)固定字串 reject `failed to delete data`。讀取類 `select` 之回傳為數據列(列內欄位可能名為 `ok`)，失敗只以 reject 表達，不檢查 `ok`。`insert`(含 `mix` 之 `add`)依 ORM 契約回傳聚合物件且 `ok` 恆為 1(錯誤皆整批 reject)；ORM 若 resolve 聚合物件而 `ok` 為 0，或回傳逐筆陣列(非 insert 契約形狀)而任一筆 `ok` 為 0(違約或他種後端)，亦視為失敗，固定字串 reject `failed to insert data`(錯誤原文只進 log)，不回成功；已寫入之筆無從回復。`mix` 之 `add` 遇此為整批性錯誤，立即 reject，`del`、`diff` 步驟不執行。契約內之 ORM(`ok` 為 1，含略過既有主鍵之 `n` 為 0)行為不變；回傳 `undefined`、`null`、無 `ok` 鍵之物件、空陣列或逐筆皆 `ok` 非 0 之陣列者不檢查。備份還原 `recover`(`getDb.recover` 與 `WServOrm` 實例上之 `recover`)逐表以 `insert` 還原，同此判準：失敗時於該表停止並以 `Error` reject，訊息為 `failed to recover data into table[表名]: ` 接 ORM 回傳原文(逐筆陣列則列失敗筆 `{k,id,err}`，至多前 10 筆並附總筆數)，另列先前已寫入之表(`; tables already written: a, b`)；之後之表不寫入，先前之表與該表已被 ORM 寫入之筆無從回復(取捨：不繼續寫入其餘表以免擴大不一致，營運者依訊息清空已寫入之表後重跑)。

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
