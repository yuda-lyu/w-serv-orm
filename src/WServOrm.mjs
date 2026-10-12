import pmSeries from 'wsemi/src/pmSeries.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import checkOptRemoved from './checkOptRemoved.mjs'
import getDbBackupAndRecover from './getDbBackupAndRecover.mjs'
import getWoItems from './getWoItems.mjs'
import getMapOrm from './getMapOrm.mjs'
import getProc from './getProc.mjs'


/**
 * 產生伺服器ORM的支援物件
 *
 * 每次呼叫各自建立資料表ORM、設定與擴充函數，同一行程內之多個實例互不干擾；同一url與db之資料庫資源能否並存，依所用ORM而定。
 *
 * procOrm之save、del與mix，於ORM回傳之逐筆結果有任一筆ok為0(單筆失敗)時reject，訊息列出失敗筆之主鍵，如'failed to save data: id[b]'(超過100字元者截斷顯示；無有效主鍵者以data[k]列其於輸入內之位置，k自0起；超過10筆者只列前10筆並附總筆數)，錯誤原文另由console.log輸出。
 * 單筆失敗不中斷整批，故reject時其餘筆數已寫入。
 * mix之各步驟遇單筆失敗不中斷後續步驟，待全部步驟完成後一併reject；遇整批性錯誤則立即reject，後續步驟不執行。
 *
 * insert、save與mix之新增、修改，數據未帶有效主鍵(非空字串或數字)者，若資料表之主鍵欄為id且為字串型(或型別未知)，由本套件產生主鍵(同各ORM之genIDSeq)並於resolve時回傳；無欄位之數據不補。
 * reject時不回傳補出之主鍵，故重送未帶主鍵之數據會再產生新主鍵而重複寫入，需冪等重送者請自帶主鍵；save帶主鍵者重送以主鍵覆寫，del重送時已刪除者為主鍵未命中。
 * insert(含mix之新增)為主鍵已存在即略過之冪等新增，回傳之id含被略過者；recover亦以insert還原，故資料表須先清空。
 * insert、save與mix之新增、修改，寫入前各欄位之字串皆經wsemi之clearXSS清除(白名單外之標籤轉義，白名單內之標籤刪除白名單外之屬性與危險網址，標籤外之文字只轉義會開始標籤之<，故'a < b'等數學式不改寫)；select與del不經清除。
 * 字串主鍵若會被清除改寫(含HTML標記，如<後緊接英文字母)，整批reject且不寫入任何一筆(mix於任何步驟之前檢查新增與修改)，訊息列其位置而不回顯主鍵，如'failed to save data, id contains HTML markup: data[1]'；否則改寫後之主鍵與呼叫端所持者不同，以原主鍵查詢與刪除皆找不到。
 *
 * 擴充函數(addFunCheck、addFunPreProcessing、addFunPostProcessing)屬於各實例，重建實例後須重新註冊；註冊時須傳入函數，否則立即拋錯(addFunCheck另令該實例之procOrm一律reject)；註冊後約1毫秒(以計時器)才生效，在此之前之procOrm呼叫不會套用。
 * 呼叫契約：check以reject或拋錯阻擋，回傳值不影響結果，且早於前處理執行；前處理逐一呼叫，各收新建之參數物件{woName,userId,mode,input}，input為前一個回傳之input，回傳須為含input之物件否則reject；後處理逐一呼叫，各收新建之參數物件且其output為前一個之回傳值，最後之回傳值即為procOrm之回傳值。
 * 後處理只在check、前處理與ORM操作皆成功後執行，逐筆失敗(含del)或mix部分寫入後reject者皆不執行；後處理自身亦可reject。後處理之input為呼叫端傳入之數據，不含本套件補出之主鍵，主鍵見output。
 * 如需觀察ORM實際寫入，可另監聽woItems內各ORM之change與error事件；惟事件由ORM發出，不含userId，mix會依步驟分次發出，經woItems直接寫入者亦會發出，insert之結果為聚合計數而非逐筆。
 * 錯誤型別：procOrm由本套件產生之reject一律為英文訊息字串(供前端顯示或對應多語系；ORM之錯誤原文另由console.log輸出而不轉出)，擴充函數自身之reject或拋錯則原樣轉出；建構(設定或ORM無效)、擴充函數註冊、backup與recover由本套件產生之錯誤一律為Error，ORM之錯誤則原樣轉出。
 *
 * 授權：procOrm不做授權，不檢查使用者，亦不依使用者過濾數據；userId只供寫入稽核欄位(userId、userIdUpdate)與交給擴充函數。procOrm開放給前端時(如讓前端經資料通道直接操作資料表)，須由開放處負責授權；addFunCheck可掛額外檢查，惟伺服端程式之呼叫亦會經過。
 * 已移除之設定：useCheckUser、getUserById、useExcludeWhenNotAdmin，未給、null或false者照常建構，給予其他值即於建構時拋錯。
 *
 * @class
 * @param {Object} ds 輸入資料表設定物件
 * @param {Object} WOrm 輸入資料庫ORM物件
 * @param {String} url 輸入資料庫連線位址字串
 * @param {String} db 輸入資料庫名稱字串
 * @param {Object} [opt={}] 輸入設定物件，預設{}；目前無設定鍵，保留供日後擴充，已移除之設定見上述
 * @returns {Object} 回傳伺服器ORM支援物件，含woItems(各資料表ORM實例)、procOrm(資料操作函數，輸入為userId、woName、mode、input)、addFunCheck、addFunPreProcessing、addFunPostProcessing、closeAll(逐一關閉各資料表ORM之連線)，以及backup(woItems)與recover(fp, woItems, genModels, needCreateStorage)；後兩者不綁定本實例，須自行傳入woItems(須為非空物件，否則reject)，其參數順序與getDb之recover(woItems, fp, opt)不同；recover於寫入前驗證備份內容(須為非空陣列且各筆之name為woItems內之資料表)，失敗時reject，逐表寫入時中途失敗則先前之表已寫入
 * @example
 *
 * // import WOrm from 'w-orm-mongodb/src/WOrmMongodb.mjs' //自行選擇引用ORM
 * import WOrm from 'w-orm-lowdb/src/WOrmLowdb.mjs' //自行選擇引用ORM
 * import ds from './schema/index.mjs' //先行建置schema
 * import WServOrm from './src/WServOrm.mjs'
 *
 * // //st
 * // let st = {
 * //     dbUsername: 'username',
 * //     dbPassword: 'password',
 * //     dbName: 'wservorm',
 * //     dbIP: 'localhost',
 * //     dbPort: 27017,
 * // }
 *
 * //url, db
 * // let url = `mongodb://${st.dbUsername}:${st.dbPassword}@${st.dbIP}:${st.dbPort}`
 * // let db = st.dbName
 * let url = './db.json'
 * let db = 'worm'
 *
 * //WServOrm
 * let r = WServOrm(ds, WOrm, url, db)
 * console.log(r) //回傳server用orm相關函數
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
 * //   closeAll: [AsyncFunction: closeAll],
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

    //checkOptRemoved, 須於建立各資料表ORM之前, 否則拋錯時已開啟之ORM(如lmdb之檔案)無從關閉; getProc收到opt時會再檢查一次, 無副作用
    checkOptRemoved(opt)

    //getWoItems
    let woItems = getWoItems(ds, WOrm, url, db)
    // console.log('woItems', woItems)

    //getMapOrm
    let mapOrm = getMapOrm(ds, woItems)
    // console.log('mapOrm', mapOrm)

    //getProc
    let proc = getProc(mapOrm, opt)
    // console.log('proc', proc)

    //closeAll, 逐一關閉woItems內各資料表ORM實例之連線(env), 釋放檔案鎖, 供測試隔離或優雅關機使用
    let closeAll = async () => {
        await pmSeries(woItems, async (wo) => {
            if (wo && isfun(wo.close)) { //ORM未實作close時(如lowdb)自動略過
                await wo.close()
            }
        })
    }

    return {
        ...getDbBackupAndRecover,
        woItems,
        // mapOrm,
        closeAll,
        ...proc,
    }
}


export default WServOrm
