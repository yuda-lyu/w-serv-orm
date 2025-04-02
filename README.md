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
let opt = {
    getUserById: null,
    useCheckUser: false,
    useExcludeWhenNotAdmin: false,
}
let r = WServOrm(ds, WOrm, url, db, opt)
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
//   addFunCheck: [Function: addFunCheck],
//   addFunPreProcessing: [Function: addFunPreProcessing],
//   addFunPostProcessing: [Function: addFunPostProcessing],
//   procOrm: [AsyncFunction: procOrm]
// }

// export default r
```
