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
