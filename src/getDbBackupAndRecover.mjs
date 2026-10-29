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
import { genDiag, getBriefResult, getBriefType } from './getDiagBrief.mjs'


function getMsgFail(name, r, data, written, diag) {
    //還原失敗之訊息(Error.message, 伺服器端工具, 同genTestData含ORM回傳原文): 失敗表名, 聚合物件則列其原文, 逐筆陣列則列失敗筆{k,id,err}(僅前nShow筆並附總筆數), 另列先前已寫入之表
    //ORM回傳原文為外來值, 只對該段經diag.mask移除連線憑證; 固定詞彙與表名(部署者宣告之識別字)不經遮罩(R-DIAG-01)

    //nShow
    let nShow = 10

    //detail
    let detail = null
    if (Array.isArray(r)) {
        let fails = getItemsFail(r, data)
        detail = diag.mask(JSON.stringify(take(fails, nShow)))
        if (size(fails) > nShow) {
            detail += `, ... (${size(fails)} in total)`
        }
    }
    else {
        detail = diag.mask(JSON.stringify(r))
    }

    //msg
    let msg = `failed to recover data into table[${name}]: ${detail}`
    if (size(written) > 0) {
        msg += `; tables already written: ${join(written, ', ')}`
    }

    return msg
}


async function backup(woItems, diag = undefined) {
    //diag(選用, 內部): 診斷出口(WServOrm實例或getDb之diag), 令進度與無效參數之診斷輸出及對外錯誤值之遮罩依其設定(R-DIAG-01); 直接呼叫者未給即預設(安全摘要, 無登錄之秘密)

    //diag
    if (!isfun(diag)) {
        diag = genDiag(undefined)
    }

    //check, 同recover; 否則無效值由pmSeries以字串reject, 而空物件或空陣列會產出recover拒收之空備份
    if (!iseobj(woItems)) {
        diag('woItems', getBriefType(woItems), () => woItems)
        throw new Error('invalid woItems')
    }

    //rs, 進度輸出表名(為woItems之自有鍵, 即資料表名)
    let rs = await pmSeries(woItems, async (v, k) => {
        diag('backup...', { table: k }, () => k)
        let r = null
        try {
            r = await v.select()
        }
        catch (err) {
            throw diag.err(err) //ORM之錯誤為外來值, 移除連線憑證後轉出(R-DIAG-01)
        }
        return {
            name: k,
            data: r,
        }
    })
    // console.log('backup rs', rs)

    return rs
}


async function recover(fp, woItems, genModels, needCreateStorage = false, diag = undefined) {
    //diag(選用, 內部): 診斷出口(WServOrm實例或getDb之diag), 令逐表insert失敗之診斷輸出及對外錯誤值之遮罩依其設定(R-DIAG-01); 直接呼叫者未給即預設(安全摘要, 無登錄之秘密)
    //外來值(檔案系統、模型產生器、ORM之createStorage與insert拋出或reject之值)經diag.err移除連線憑證後轉出; 本函數以固定詞彙組成之Error不經遮罩

    //diag
    if (!isfun(diag)) {
        diag = genDiag(undefined)
    }

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
    let j = null
    try {
        j = fs.readFileSync(fp, 'utf8')
    }
    catch (err) {
        throw diag.err(err)
    }
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
        try {
            genModels()
        }
        catch (err) {
            throw diag.err(err)
        }
    }

    //written, 已完成insert之資料表(逐表寫入, 中途失敗時先前之表已寫入, 失敗訊息列出供營運者清理)
    let written = []

    //funTest
    await pmSeries(rs, async (v) => {
        diag('recover...', { table: v.name }, () => v.name)
        if (needCreateStorage) {
            diag('needCreateStorage')
            try {
                await woItems[v.name].createStorage()
            }
            catch (err) {
                throw diag.err(err)
            }
        }
        // await woItems[v.name].delAll() //清空資料庫
        let r = null
        if (size(v.data) > 0) {
            try {
                r = await woItems[v.name].insert(v.data) //需人工先清空資料庫, 用insert匯入比較快
            }
            catch (err) {
                throw diag.err(err)
            }

            //check, ORM回報失敗(聚合物件ok為0, 或逐筆陣列任一筆ok為0)不得當成功: 於此表停止, 之後之表不寫入; 此表已被ORM寫入之筆與先前之表無從回復
            if (isOrmFail(r)) {
                //先組出Error訊息再交診斷輸出, 使用端之紀錄函式原地改動r不致改變訊息; 組訊息拋錯者(如r含循環而JSON序列化失敗)仍先輸出診斷再拋出同一錯誤(同舊版次序)
                let msg = null
                let threw = false
                let errMsg = null
                try {
                    msg = getMsgFail(v.name, r, v.data, written, diag)
                }
                catch (e) {
                    threw = true //以旗標而非哨兵值判斷: 可拋出任何值(含null、undefined)
                    errMsg = e
                }
                diag(`${v.name}.insert fail`, getBriefResult(r), () => r)
                if (threw) {
                    throw diag.err(errMsg) //組訊息時拋出之值(序列化ORM回傳時之例外, 或回傳之toJSON拋出者)為外來值
                }
                throw new Error(msg) //固定詞彙與表名, ORM回傳原文之段已於getMsgFail經diag.mask
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
