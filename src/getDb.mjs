import path from 'path'
import fs from 'fs'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import keys from 'lodash-es/keys.js'
import size from 'lodash-es/size.js'
import iseobj from 'wsemi/src/iseobj.mjs'
import isbol from 'wsemi/src/isbol.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import o2j from 'wsemi/src/o2j.mjs'
import now2strp from 'wsemi/src/now2strp.mjs'
import haskey from 'wsemi/src/haskey.mjs'
import br from './getDbBackupAndRecover.mjs'
import { genDiag } from './getDiagBrief.mjs'


let fdSrv = path.resolve()


function genModels(ds, genModelsByTabs, opt = {}, diag = undefined) {
    //diag(選用, 內部): 由recover帶入之診斷出口(建構時已取選項快照, 不再讀取使用端之opt, 其getter可能前後不同); 未給者由opt建立(R-DIAG-01)

    //fdModels
    let fdModels = get(opt, 'fdModels')
    if (!isestr(fdModels)) {
        fdModels = './models'
    }

    //bLog
    let bLog = get(opt, 'bLog')
    if (!isbol(bLog)) {
        bLog = true
    }

    //diag, 同backup(R-DIAG-01)
    if (!isfun(diag)) {
        diag = genDiag(opt)
    }

    //names
    let names = keys(ds)

    //tabs
    let tabs = {}
    each(names, (name) => {

        //check
        if (!haskey(ds[name], 'settings')) {
            diag(`table[${name}] has no settings`)
            return true //跳出換下一個
        }

        //check
        if (!iseobj(ds[name].settings)) {
            diag(`invalid ds[${name}].settings`)
            return true //跳出換下一個
        }

        //save
        tabs[name] = ds[name].settings

    })
    if (bLog) {
        diag('tabs', { n: size(tabs), tables: keys(tabs) }, () => tabs) //預設只列表名, 完整schema設定(可含預設值等)為細節; diag一律交出遮罩後之拷貝, 使用端原地改動不影響其後傳給模型產生器之tabs
    }

    //fd
    let fd = path.resolve(fdSrv, fdModels) //fdSrv + '/models'

    //genModelsByTabs
    genModelsByTabs(fd, tabs)

}


/**
 * 備份各資料表至檔案(公開子模組，見README〈公開子模組〉)
 *
 * 各表以select取全部數據，寫入「模組載入時之工作目錄」(載入後改變cwd不影響)下之backup-時間.json，內容為[{ name, data }, ...]；成功resolve undefined，失敗印診斷輸出後reject(外來錯誤之連線憑證已遮罩)，令呼叫端(含未await之頂層腳本)可偵測。
 * 診斷輸出依opt.bLog、opt.logDetail、opt.funLog(型別錯誤者忽略並用預設)，見README〈Diagnostic output〉。
 *
 * @param {Object} woItems 輸入各資料表ORM實例物件(如WServOrm回傳物件之woItems)
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Boolean} [opt.bLog=true] 輸入是否輸出進度與完成訊息，預設true
 * @param {Boolean} [opt.logDetail=false] 輸入失敗時是否輸出含細節(連線憑證已遮罩)之診斷，預設false
 * @param {Function} [opt.funLog] 輸入使用端提供之紀錄函式(label, safe, detail)，給予時診斷輸出只交給它
 * @returns {Promise<undefined>} 回傳Promise，成功resolve undefined，失敗reject
 * @example
 *
 * import getDb from 'w-serv-orm/src/getDb.mjs'
 *
 * await getDb.backup(woItems) //寫出./backup-時間.json
 *
 */
async function backup(woItems, opt = {}) {
    //備份各資料表至cwd(模組載入時之工作目錄)下之backup-時間.json; 失敗時印log後reject原錯誤, 令呼叫端(含未await之頂層腳本)可偵測

    //bLog
    let bLog = get(opt, 'bLog')
    if (!isbol(bLog)) {
        bLog = true
    }

    //diag, 失敗時之診斷輸出預設只列錯誤類別(原文含ORM回傳, 為細節), opt.logDetail為true輸出遮罩後之細節, opt.funLog收遮罩後之細節(R-DIAG-01); 型別錯誤者忽略, 同bLog
    let diag = genDiag(opt)

    //backup, 低階backup之外來值(ORM)已於該處經diag.err; 本函數之外來值為寫檔之錯誤, 以固定詞彙組成之錯誤不經遮罩
    await br.backup(woItems, diag)
        .then((res) => {

            //o2j
            let j = o2j(res)

            //check, o2j無法序列化時回空字串, 不得寫出空備份而回報成功
            if (!isestr(j)) {
                throw new Error('backup data can not be serialized')
            }

            //fn
            let fn = `backup-${now2strp()}.json`

            //fp
            let fp = path.resolve(fdSrv, fn)

            //writeFileSync, 檔案系統之錯誤為外來值, 經diag.err後轉出(R-DIAG-01; 儲存路徑不屬憑證, 不遮)
            try {
                fs.writeFileSync(fp, j, 'utf8')
            }
            catch (err) {
                throw diag.err(err)
            }

            if (bLog) {
                diag('backup finish')
            }
        })
        .catch((err) => {
            diag('backup catch', diag.brief(err), () => err) //diag交出遮罩後之拷貝, 使用端原地遮罩不改變拋給呼叫端之錯誤
            throw err
        })

}


/**
 * 由備份檔以insert還原各資料表(公開子模組，見README〈公開子模組〉)
 *
 * 參數順序(woItems, fp, opt)與WServOrm實例上之recover(fp, woItems, genModels, needCreateStorage)不同。逐表寫入，主鍵已存在者略過，故資料表須先清空；備份檔不存在或內容無效(須為非空陣列且各筆之name為woItems內之資料表)於任何寫入之前reject；中途失敗(含insert回報ok為0，見README〈Rows〉)於該表停止，先前之表已寫入、之後之表不寫入。
 * 關聯資料庫(opt.bRela為true)須提供opt.ds與opt.genModelsByTabs以產生model，缺則於任何寫入之前reject。診斷輸出依opt.bLog、opt.logDetail、opt.funLog(型別錯誤者忽略並用預設)，見README〈Diagnostic output〉。
 *
 * @param {Object} woItems 輸入各資料表ORM實例物件(如WServOrm回傳物件之woItems)
 * @param {String} fp 輸入備份檔路徑字串
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {Boolean} [opt.bRela=false] 輸入是否為關聯資料庫，預設false
 * @param {Object} [opt.ds] 輸入資料表設定物件，bRela為true時必給
 * @param {Function} [opt.genModelsByTabs] 輸入依資料表設定產生model之函數(fd, tabs)，bRela為true時必給
 * @param {String} [opt.fdModels='./models'] 輸入model輸出資料夾，預設'./models'
 * @param {Boolean} [opt.bLog=true] 輸入是否輸出進度與完成訊息，預設true
 * @param {Boolean} [opt.logDetail=false] 輸入失敗時是否輸出含細節(連線憑證已遮罩)之診斷，預設false
 * @param {Function} [opt.funLog] 輸入使用端提供之紀錄函式(label, safe, detail)，給予時診斷輸出只交給它
 * @returns {Promise<undefined>} 回傳Promise，成功resolve undefined，失敗reject
 * @example
 *
 * import getDb from 'w-serv-orm/src/getDb.mjs'
 *
 * await getDb.recover(woItems, './backup-20260101T000000.json')
 *
 */
async function recover(woItems, fp, opt = {}) {
    //由備份檔以insert還原各資料表; 主鍵已存在者略過, 故資料表須先清空; 逐表寫入, 中途失敗(含insert回報ok為0, 見isOrmFail)時先前之表已寫入, 之後之表不寫入
    //失敗時印log後reject原錯誤; bRela為true時須提供opt.ds與opt.genModelsByTabs以產生model

    //bRela, 是否為關聯資料庫
    let bRela = get(opt, 'bRela')
    if (!isbol(bRela)) {
        bRela = false
    }

    //bLog
    let bLog = get(opt, 'bLog')
    if (!isbol(bLog)) {
        bLog = true
    }

    //diag, 同backup(R-DIAG-01); 外來值(檔案系統、模型產生器、ORM)已於低階recover經diag.err
    let diag = genDiag(opt)

    //funGenModels and bNeedCreateStorage, 若為關聯資料庫則需使用genModels與needCreateStorage=true
    //genModels須以ds與genModelsByTabs產生model, 低階recover則以無參數呼叫, 故以閉包帶入; 缺則於任何寫入之前reject
    let funGenModels = null
    let bNeedCreateStorage = false
    if (bRela) {
        let ds = get(opt, 'ds')
        let genModelsByTabs = get(opt, 'genModelsByTabs')
        if (!iseobj(ds) || !isfun(genModelsByTabs)) {
            let err = new Error('bRela needs opt.ds and opt.genModelsByTabs')
            diag('recover catch', diag.brief(err), () => err)
            return Promise.reject(err)
        }
        funGenModels = () => {
            genModels(ds, genModelsByTabs, opt, diag)
        }
        bNeedCreateStorage = true
    }

    //recover
    await br.recover(fp, woItems, funGenModels, bNeedCreateStorage, diag)
        .then(() => {
            if (bLog) {
                diag('recover finish')
            }
        })
        .catch((err) => {
            diag('recover catch', diag.brief(err), () => err)
            throw err
        })

}


let getDb = {
    backup,
    recover,
}


export default getDb
