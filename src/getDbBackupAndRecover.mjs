// import path from 'path'
import fs from 'fs'
import trim from 'lodash-es/trim.js'
import size from 'lodash-es/size.js'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import join from 'lodash-es/join.js'
import take from 'lodash-es/take.js'
import pmSeries from 'wsemi/src/pmSeries.mjs'
import fsIsFile from 'wsemi/src/fsIsFile.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isbol from 'wsemi/src/isbol.mjs'
import j2o from 'wsemi/src/j2o.mjs'
import getItemsFail from 'w-data-collector/src/getItemsFail.mjs'
import isOrmFail from './isOrmFail.mjs'
import { getDiag, getBriefResult, getBriefType, cpDetail } from './getDiag.mjs'


function getMsgFail(name, r, data, written) {
    //還原失敗之訊息(Error.message, 伺服器端工具, 同genTestData含ORM回傳原文): 失敗表名, 聚合物件則列其原文, 逐筆陣列則列失敗筆{k,id,err}(僅前nShow筆並附總筆數), 另列先前已寫入之表

    //nShow
    let nShow = 10

    //detail
    let detail = null
    if (Array.isArray(r)) {
        let fails = getItemsFail(r, data)
        detail = JSON.stringify(take(fails, nShow))
        if (size(fails) > nShow) {
            detail += `, ... (${size(fails)} in total)`
        }
    }
    else {
        detail = JSON.stringify(r)
    }

    //msg
    let msg = `failed to recover data into table[${name}]: ${detail}`
    if (size(written) > 0) {
        msg += `; tables already written: ${join(written, ', ')}`
    }

    return msg
}


async function backup(woItems, optLog = undefined) {
    //optLog(選用, 內部): getDiag可收之{ logDetail, funLog }, 令進度與無效參數之診斷輸出依其設定(R-DIAG-01); 由WServOrm與getDb帶入

    //diag
    let diag = getDiag(optLog)

    //check, 同recover; 否則無效值由pmSeries以字串reject, 而空物件或空陣列會產出recover拒收之空備份
    if (!iseobj(woItems)) {
        diag('woItems', getBriefType(woItems), () => woItems)
        throw new Error('invalid woItems')
    }

    //rs, 進度輸出表名(為woItems之自有鍵, 即資料表名)
    let rs = await pmSeries(woItems, async (v, k) => {
        diag('backup...', k, () => k)
        let r = await v.select()
        return {
            name: k,
            data: r,
        }
    })
    // console.log('backup rs', rs)

    return rs
}


async function recover(fp, woItems, genModels, needCreateStorage = false, optLog = undefined) {
    //optLog(選用, 內部): getDiag可收之{ logDetail, funLog }, 令逐表insert失敗之診斷輸出依其設定(R-DIAG-01); 由WServOrm與getDb帶入, 直接呼叫者未給即預設(安全摘要)

    //diag
    let diag = getDiag(optLog)

    //check
    if (!fsIsFile(fp)) {
        diag('fp', getBriefType(fp), () => fp)
        throw new Error('fp is not exist')
    }
    if (!iseobj(woItems)) {
        diag('woItems', getBriefType(woItems), () => woItems)
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

    //written, 已完成insert之資料表(逐表寫入, 中途失敗時先前之表已寫入, 失敗訊息列出供營運者清理)
    let written = []

    //funTest
    await pmSeries(rs, async (v) => {
        diag('recover...', v.name, () => v.name)
        if (needCreateStorage) {
            diag('needCreateStorage')
            await woItems[v.name].createStorage()
        }
        // await woItems[v.name].delAll() //清空資料庫
        let r = null
        if (size(v.data) > 0) {
            r = await woItems[v.name].insert(v.data) //需人工先清空資料庫, 用insert匯入比較快

            //check, ORM回報失敗(聚合物件ok為0, 或逐筆陣列任一筆ok為0)不得當成功: 於此表停止, 之後之表不寫入; 此表已被ORM寫入之筆與先前之表無從回復
            if (isOrmFail(r)) {
                //先組出Error訊息再交診斷輸出, 使用端之紀錄函式原地改動r不致改變訊息; 組訊息拋錯者(如r含循環而JSON序列化失敗)仍先輸出診斷再拋出同一錯誤(同舊版次序)
                let msg = null
                let threw = false
                let errMsg = null
                try {
                    msg = getMsgFail(v.name, r, v.data, written)
                }
                catch (e) {
                    threw = true //以旗標而非哨兵值判斷: 可拋出任何值(含null、undefined)
                    errMsg = e
                }
                diag(`${v.name}.insert fail`, getBriefResult(r), () => cpDetail(r))
                if (threw) {
                    throw errMsg
                }
                throw new Error(msg)
            }

            written.push(v.name)
        }
        return r
    })

}


let getDbBackupAndRecover = {
    backup,
    recover,
}


export default getDbBackupAndRecover
