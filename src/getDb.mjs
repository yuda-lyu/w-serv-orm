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
import { getOptLogLoose, getDiag, getBriefErr, cpDetail } from './getDiag.mjs'


let fdSrv = path.resolve()


function genModels(ds, genModelsByTabs, opt = {}, optLog = undefined) {
    //optLog(選用, 內部): 由recover帶入之診斷選項快照, 不再讀取使用端之opt(其getter可能前後不同); 未給者由opt取(R-DIAG-01)

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
    let diag = getDiag(optLog === undefined ? getOptLogLoose(opt) : optLog)

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
        diag('tabs', { n: size(tabs), tables: keys(tabs) }, () => cpDetail(tabs)) //預設只列表名, 完整schema設定(可含預設值等)為細節; 交出拷貝, 使用端原地改動不影響其後傳給模型產生器之tabs
    }

    //fd
    let fd = path.resolve(fdSrv, fdModels) //fdSrv + '/models'

    //genModelsByTabs
    genModelsByTabs(fd, tabs)

}


async function backup(woItems, opt = {}) {
    //備份各資料表至cwd(模組載入時之工作目錄)下之backup-時間.json; 失敗時印log後reject原錯誤, 令呼叫端(含未await之頂層腳本)可偵測

    //bLog
    let bLog = get(opt, 'bLog')
    if (!isbol(bLog)) {
        bLog = true
    }

    //diag, 失敗時之診斷輸出預設只列錯誤類別(原文含ORM回傳, 為細節), opt.logDetail為true還原完整輸出, opt.funLog收完整細節(R-DIAG-01); 型別錯誤者忽略, 同bLog
    let optLog = getOptLogLoose(opt)
    let diag = getDiag(optLog)

    //backup
    await br.backup(woItems, optLog)
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

            //writeFileSync
            fs.writeFileSync(fp, j, 'utf8')

            if (bLog) {
                diag('backup finish')
            }
        })
        .catch((err) => {
            diag('backup catch', getBriefErr(err), () => cpDetail(err), true) //舊版為console.log(err); 交出拷貝, 使用端原地遮罩不改變拋給呼叫端之原錯誤
            throw err
        })

}


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

    //optLog, diag, 同backup(R-DIAG-01)
    let optLog = getOptLogLoose(opt)
    let diag = getDiag(optLog)

    //funGenModels and bNeedCreateStorage, 若為關聯資料庫則需使用genModels與needCreateStorage=true
    //genModels須以ds與genModelsByTabs產生model, 低階recover則以無參數呼叫, 故以閉包帶入; 缺則於任何寫入之前reject
    let funGenModels = null
    let bNeedCreateStorage = false
    if (bRela) {
        let ds = get(opt, 'ds')
        let genModelsByTabs = get(opt, 'genModelsByTabs')
        if (!iseobj(ds) || !isfun(genModelsByTabs)) {
            let err = new Error('bRela needs opt.ds and opt.genModelsByTabs')
            diag('recover catch', getBriefErr(err), () => cpDetail(err), true) //舊版為console.log(err)
            return Promise.reject(err)
        }
        funGenModels = () => {
            genModels(ds, genModelsByTabs, opt, optLog)
        }
        bNeedCreateStorage = true
    }

    //recover
    await br.recover(fp, woItems, funGenModels, bNeedCreateStorage, optLog)
        .then(() => {
            if (bLog) {
                diag('recover finish')
            }
        })
        .catch((err) => {
            diag('recover catch', getBriefErr(err), () => cpDetail(err), true) //舊版為console.log(err)
            throw err
        })

}


let getDb = {
    backup,
    recover,
}


export default getDb
