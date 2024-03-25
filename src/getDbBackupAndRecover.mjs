// import path from 'path'
import fs from 'fs'
import trim from 'lodash-es/trim.js'
import size from 'lodash-es/size.js'
import pmSeries from 'wsemi/src/pmSeries.mjs'
import fsIsFile from 'wsemi/src/fsIsFile.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isbol from 'wsemi/src/isbol.mjs'
import j2o from 'wsemi/src/j2o.mjs'


async function backup(woItems) {

    //rs
    let rs = await pmSeries(woItems, async (v, k) => {
        console.log('backup...', k)
        let r = await v.select()
        return {
            name: k,
            data: r,
        }
    })
    // console.log('backup rs', rs)

    return rs
}


async function recover(fp, woItems, genModels, needCreateStorage = false) {

    //check
    if (!fsIsFile(fp)) {
        console.log('fp', fp)
        throw new Error('fp is not exist')
    }
    if (!iseobj(woItems)) {
        console.log('woItems', woItems)
        throw new Error('invalid woItems')
    }

    //genModels
    if (!isfun(genModels)) {
        genModels = null
    }

    //needCreateStorage
    if (!isbol(needCreateStorage)) {
        needCreateStorage = false
    }

    //readFileSync
    let j = fs.readFileSync(fp, 'utf8')
    j = trim(j) //去除bom
    // console.log('j', j)

    //rs
    let rs = j2o(j)
    // console.log('recover rs', rs)

    //genModels
    if (isfun(genModels)) {
        genModels()
    }

    //funTest
    await pmSeries(rs, async (v) => {
        console.log('recover...', v.name)
        if (needCreateStorage) {
            console.log('needCreateStorage')
            await woItems[v.name].createStorage()
        }
        // await woItems[v.name].delAll() //清空資料庫
        let r = null
        if (size(v.data) > 0) {
            r = await woItems[v.name].insert(v.data) //需人工先清空資料庫, 用insert匯入比較快
        }
        return r
    })

}


let getDbBackupAndRecover = {
    backup,
    recover,
}


export default getDbBackupAndRecover
