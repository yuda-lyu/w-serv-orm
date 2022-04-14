import getDbBackupAndRecover from './getDbBackupAndRecover.mjs'
import getWoItems from './getWoItems.mjs'
import getMapOrm from './getMapOrm.mjs'
import getProc from './getProc.mjs'


/**
 * 產生伺服器ORM的支援物件
 *
 * @class
 * @param {Object} ds 輸入資料表設定物件
 * @param {Object} WOrm 輸入資料庫ORM物件
 * @param {String} url 輸入資料庫連線位址字串
 * @param {String} db 輸入資料庫名稱字串
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Boolean} [opt.bCheckUser=true] 輸入是否檢查使用者資訊布林值，預設true
 * @param {Function} [opt.getUserById=null] 輸入當bCheckUser=true時依照使用者ID取得使用者資訊物件函數，預設null
 * @param {Boolean} [opt.bExcludeWhenNotAdmin=true] 輸入使用ORM的select方法時是否自動刪除數據內isActive欄位之布林值，預設true
 * @returns {Object} 回傳通訊物件，可監聽事件open、error、clientChange、execute、broadcast、deliver，可使用函數broadcast
 * @example
 *
 * import WOrm from 'w-orm-mongodb/src/WOrmMongodb.mjs' //自行選擇引用ORM
 * import ds from './schema/index.mjs' //先行建置schema
 * import WServOrm from './src/WServOrm.mjs'
 *
 * //st
 * let st = {
 *     dbUsername: 'username',
 *     dbPassword: 'password',
 *     dbName: 'wservorm',
 *     dbIP: 'localhost',
 *     dbPort: 27017,
 * }
 *
 * //url, db
 * let url = `mongodb://${st.dbUsername}:${st.dbPassword}@${st.dbIP}:${st.dbPort}`
 * let db = st.dbName
 *
 * //WServOrm
 * let opt = {
 *     getUserById: null,
 *     bCheckUser: false,
 *     bExcludeWhenNotAdmin: false,
 * }
 * let r = WServOrm(ds, WOrm, url, db, opt)
console.log(r) //回傳server用orm相關函數
 * // => {
 * //   backup: [AsyncFunction: backup],
 * //   recover: [AsyncFunction: recover],
 * //   woItems: {
 * //     tests: EventEmitter {
 * //       _events: [Object: null prototype] {},
 * //       _eventsCount: 0,
 * //       _maxListeners: undefined,
 * //       select: [AsyncFunction: select],
 * //       insert: [AsyncFunction: insert],
 * //       save: [AsyncFunction: save],
 * //       del: [AsyncFunction: del],
 * //       delAll: [AsyncFunction: delAll],
 * //       selectGfs: [AsyncFunction: selectGfs],
 * //       insertGfs: [AsyncFunction: insertGfs],
 * //       delGfs: [AsyncFunction: delGfs],
 * //       delAllGfs: [AsyncFunction: delAllGfs],
 * //       [Symbol(kCapture)]: false
 * //     }
 * //   },
 * //   addFunCheck: [Function: addFunCheck],
 * //   addFunPreProcessing: [Function: addFunPreProcessing],
 * //   addFunPostProcessing: [Function: addFunPostProcessing],
 * //   procOrm: [AsyncFunction: procOrm]
 * // }
 *
 * // export default r
 *
 */
function WServOrm(ds, WOrm, url, db, opt = {}) {

    //getWoItems
    let woItems = getWoItems(ds, WOrm, url, db)
    // console.log('woItems', woItems)

    //getMapOrm
    let mapOrm = getMapOrm(ds, woItems)
    // console.log('mapOrm', mapOrm)

    //getProc
    let proc = getProc(mapOrm, opt)
    // console.log('proc', proc)

    return {
        ...getDbBackupAndRecover,
        woItems,
        // mapOrm,
        ...proc,
    }
}


export default WServOrm
