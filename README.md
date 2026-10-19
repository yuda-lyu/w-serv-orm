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
* **`delAll` 為破壞性操作，須審慎使用，非必要不用**(刪除單筆請用 `del`)：不給條件(未給、`undefined` 或 `{}`)即刪除全部數據，不另行確認；給了條件才是部分刪除。經資料通道(前端直接操作資料表)呼叫之 `delAll` 與此語意一致，不另加通道專屬限制，授權由開放處負責。條件值若來自可能為 `undefined`、`null` 或空陣列之變數，呼叫端須先自行判斷；經 JSON 傳輸時顯式傳入之 `undefined` 會成為 `null` 而被 reject，須省略參數或傳 `{}`。建議先以 `select(find)` 確認命中範圍再刪除(ORM 啟用快取而他方已寫入時，`select` 可能回傳快取，而 `delAll` 一律直讀資料庫，預覽不保證即實際刪除之集合)。

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
