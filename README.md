# w-serv-orm
An operator for orm in server.

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-serv-orm.svg?style=flat)](https://npmjs.org/package/w-serv-orm) 
[![license](https://img.shields.io/npm/l/w-serv-orm.svg?style=flat)](https://npmjs.org/package/w-serv-orm) 
[![gzip file size](http://img.badgesize.io/yuda-lyu/w-serv-orm/master/dist/w-serv-orm-server.umd.js.svg?compression=gzip)](https://github.com/yuda-lyu/w-serv-orm)
[![npm download](https://img.shields.io/npm/dt/w-serv-orm.svg)](https://npmjs.org/package/w-serv-orm) 
[![jsdelivr download](https://img.shields.io/jsdelivr/npm/hm/w-serv-orm.svg)](https://www.jsdelivr.com/package/npm/w-serv-orm)

## Documentation
To view documentation or get support, visit [docs](https://yuda-lyu.github.io/w-serv-orm/WServOrm.html).

## Installation
### Using npm(ES6 module):
> **Note:** `w-serv-orm` is mainly dependent on `lodash` and `wsemi`.

```alias
npm i w-serv-orm
```

#### Example for server:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-serv-orm/blob/master/g.mOrm.mjs)]
```alias
import WOrm from 'w-orm-mongodb/src/WOrmMongodb.mjs' //自行選擇引用ORM
import ds from './schema/index.mjs' //先行建置schema
import WServOrm from './src/WServOrm.mjs'


//st
let st = {
    dbUsername: 'username',
    dbPassword: 'password',
    dbName: 'wservorm',
    dbIP: 'localhost',
    dbPort: 27017,
}

//WServOrm
let opt = {
    url: `mongodb://${st.dbUsername}:${st.dbPassword}@${st.dbIP}:${st.dbPort}`,
    db: st.dbName,
    getUserById: null,
    bCheckUser: false,
    bExcludeWhenNotAdmin: false,
}
let r = WServOrm(ds, WOrm, opt)
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
```
