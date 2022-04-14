import path from 'path'
import fs from 'fs'
import get from 'lodash/get'
import each from 'lodash/each'
import keys from 'lodash/keys'
import iseobj from 'wsemi/src/iseobj.mjs'
import isbol from 'wsemi/src/isbol.mjs'
import isestr from 'wsemi/src/isestr.mjs'
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
            console.log(`資料表[${name}]無settings資訊`)
            return true //跳出換下一個
        }

        //check
        if (!iseobj(ds[name].settings)) {
            console.log(`ds[${name}].settings非有效物件`)
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
        })

}


async function recover(woItems, fp, opt = {}) {

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
    let funGenModels = null
    let bNeedCreateStorage = false
    if (bRela) {
        funGenModels = genModels
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
        })

}


let getDb = {
    backup,
    recover,
}


export default getDb
