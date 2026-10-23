import path from 'path'
import fs from 'fs'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import keys from 'lodash-es/keys.js'
import iseobj from 'wsemi/src/iseobj.mjs'
import isbol from 'wsemi/src/isbol.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import o2j from 'wsemi/src/o2j.mjs'
import now2strp from 'wsemi/src/now2strp.mjs'
import haskey from 'wsemi/src/haskey.mjs'
import br from './getDbBackupAndRecover.mjs'


let fdSrv = path.resolve()


function genModels(ds, genModelsByTabs, opt = {}) {

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

    //names
    let names = keys(ds)

    //tabs
    let tabs = {}
    each(names, (name) => {

        //check
        if (!haskey(ds[name], 'settings')) {
            console.log(`table[${name}] has no settings`)
            return true //跳出換下一個
        }

        //check
        if (!iseobj(ds[name].settings)) {
            console.log(`invalid ds[${name}].settings`)
            return true //跳出換下一個
        }

        //save
        tabs[name] = ds[name].settings

    })
    if (bLog) {
        console.log('tabs', tabs)
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

    //backup
    await br.backup(woItems)
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
                console.log('backup finish')
            }
        })
        .catch((err) => {
            console.log(err)
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

    //funGenModels and bNeedCreateStorage, 若為關聯資料庫則需使用genModels與needCreateStorage=true
    //genModels須以ds與genModelsByTabs產生model, 低階recover則以無參數呼叫, 故以閉包帶入; 缺則於任何寫入之前reject
    let funGenModels = null
    let bNeedCreateStorage = false
    if (bRela) {
        let ds = get(opt, 'ds')
        let genModelsByTabs = get(opt, 'genModelsByTabs')
        if (!iseobj(ds) || !isfun(genModelsByTabs)) {
            let err = new Error('bRela needs opt.ds and opt.genModelsByTabs')
            console.log(err)
            return Promise.reject(err)
        }
        funGenModels = () => {
            genModels(ds, genModelsByTabs, opt)
        }
        bNeedCreateStorage = true
    }

    //recover
    await br.recover(fp, woItems, funGenModels, bNeedCreateStorage)
        .then(() => {
            if (bLog) {
                console.log('recover finish')
            }
        })
        .catch((err) => {
            console.log(err)
            throw err
        })

}


let getDb = {
    backup,
    recover,
}


export default getDb
