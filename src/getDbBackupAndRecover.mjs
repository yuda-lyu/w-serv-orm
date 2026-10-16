// import path from 'path'
import fs from 'fs'
import trim from 'lodash-es/trim.js'
import size from 'lodash-es/size.js'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import pmSeries from 'wsemi/src/pmSeries.mjs'
import fsIsFile from 'wsemi/src/fsIsFile.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isbol from 'wsemi/src/isbol.mjs'
import j2o from 'wsemi/src/j2o.mjs'


async function backup(woItems) {

    //check, 同recover; 否則無效值由pmSeries以字串reject, 而空物件或空陣列會產出recover拒收之空備份
    if (!iseobj(woItems)) {
        console.log('woItems', woItems)
        throw new Error('invalid woItems')
    }

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

    //check, 備份內容須為非空陣列, 且各筆之name為woItems內之資料表; 於任何寫入之前驗證, 避免空檔或壞檔(j2o解析失敗回{})假成功, 亦避免部分還原
    if (!isearr(rs)) {
        throw new Error('invalid backup data, need a non-empty array')
    }
    each(rs, (v, k) => {
        let name = get(v, 'name')
        if (!isestr(name)) {
            throw new Error(`invalid backup data, rs[${k}].name is not a string`)
        }
        if (!Object.prototype.hasOwnProperty.call(woItems, name)) { //自有屬性, 不用haskey(in運算含原型鏈, constructor、toString等通過驗證後才在寫入時失敗)
            throw new Error(`invalid backup data, table[${name}] is not in woItems`)
        }
    })

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
