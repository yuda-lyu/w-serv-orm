import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import map from 'lodash-es/map.js'
import size from 'lodash-es/size.js'
import take from 'lodash-es/take.js'
import join from 'lodash-es/join.js'
import truncate from 'lodash-es/truncate.js'
import nowms2str from 'wsemi/src/nowms2str.mjs'
import genIDSeq from 'wsemi/src/genIDSeq.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isnum from 'wsemi/src/isnum.mjs'
import clearXSS from 'wsemi/src/clearXSS.mjs'
import getItemsFail from 'w-data-collector/src/getItemsFail.mjs'


function getMsgFail(msg, fails) {
    //前端訊息僅列出失敗筆, 錯誤原文另由console.log輸出, 與既有整批錯誤之處理一致
    //有效主鍵(非空字串或數字)列為id[...], 否則列其於輸入內之位置, 失敗筆數過多時僅列前nShow筆並附總筆數
    //主鍵超過nIdMax字元者截斷顯示(LMDB逐筆失敗常因主鍵超長, 故兩者常同時出現), log仍保留全文

    //nShow, nIdMax
    let nShow = 10
    let nIdMax = 100

    //ss
    let ss = map(take(fails, nShow), (v) => {
        if (isestr(v.id) || isnum(v.id)) {
            return `id[${truncate(String(v.id), { length: nIdMax, omission: '…' })}]`
        }
        return `data[${v.k}]`
    })

    //c
    let c = `${msg}: ${join(ss, ', ')}`
    if (size(fails) > nShow) {
        c += `, ... (${size(fails)} in total)`
    }

    return c
}


function isPkIdString(dsTab, keys) {
    //資料表之主鍵欄是否為id且可容納字串型之補值, 供adjustData判斷是否補主鍵

    //check, 須有id欄; 有settings者另須標為pk
    if (keys.indexOf('id') < 0) {
        return false
    }
    let settings = get(dsTab, 'settings', null)
    if (iseobj(settings) && get(settings, 'id.pk') !== true) {
        return false
    }

    //check, 型別已知者須為字串型, 與w-orm-reladb可自動補值之主鍵欄型別一致
    let type = get(settings, 'id.type', '') || get(dsTab, 'kpType.id', '')
    if (isestr(type) && ['STRING', 'TEXT', 'CHAR', 'UUID', 'CITEXT'].indexOf(type.toUpperCase()) < 0) {
        return false
    }

    return true
}


function getItemsIdXSS(data) {
    //輸入數據之主鍵(非空字串)會被clearXSS改寫者, 回傳[{k,id}], k為其於輸入內之位置
    //寫入路徑之欄位皆經clearXSS而select與del不經過, 主鍵被改寫後以原主鍵查詢與刪除皆找不到, 故呼叫端須於寫入前整批拒絕
    let rs = []
    each(isarr(data) ? data : [data], (v, k) => {
        let id = get(v, 'id')
        if (isestr(id) && clearXSS(id) !== id) {
            rs.push({ k, id })
        }
    })
    return rs
}


function getMsgIdXSS(msg, fails) {
    //主鍵含HTML標記, 訊息只列位置不回顯主鍵, 主鍵原文另由console.log輸出
    return getMsgFail(`${msg}, id contains HTML markup`, map(fails, (v) => {
        return { k: v.k }
    }))
}


function adjustData(ds, woName, userId, data, mode = 'save') { //mode: 'insert', 'save', 'insert+save'

    //check
    if (!iseobj(ds)) {
        console.log('ds', ds)
        throw new Error('invalid ds')
    }

    //keys
    let keys = ds[woName].keys

    //one
    let one = false
    if (!isarr(data)) {
        one = true
        data = [data]
    }

    //t
    let t = nowms2str()

    //userId, timeCreate
    if (mode.indexOf('insert') >= 0) {

        //userId
        if (keys.indexOf('userId') >= 0) {
            each(data, (v, k) => {
                data[k].userId = userId
            })
        }

        //timeCreate
        if (keys.indexOf('timeCreate') >= 0) {

            each(data, (v, k) => {
                data[k].timeCreate = t
            })
        }

        //userIdUpdate
        if (keys.indexOf('userIdUpdate') >= 0) {
            each(data, (v, k) => {
                data[k].userIdUpdate = userId
            })
        }

        //timeUpdate
        if (keys.indexOf('timeUpdate') >= 0) {
            each(data, (v, k) => {
                data[k].timeUpdate = t
            })
        }

    }

    //userIdUpdate, timeUpdate, 不能用else否則無法同時處理
    if (mode.indexOf('insert') >= 0 || mode.indexOf('save') >= 0) {

        //userIdUpdate
        if (keys.indexOf('userIdUpdate') >= 0) {
            each(data, (v, k) => {
                data[k].userIdUpdate = userId
            })
        }

        //timeUpdate
        if (keys.indexOf('timeUpdate') >= 0) {
            each(data, (v, k) => {
                data[k].timeUpdate = t
            })
        }

    }

    //clearXSS
    if (true) {
        data = map(data, (v, k) => {
            let dt = {}
            each(v, (vv, kk) => {
                vv = clearXSS(vv)
                dt[kk] = vv
            })
            return dt
        })
    }

    //id, 未提供有效主鍵者由本套件補值, 令回傳之主鍵與實際寫入者一致, 補值器同各ORM之genIDSeq
    //有效主鍵之判定同w-orm系列: 非空字串或數字(reladb、mdb視數字為有效)
    //補值寫在上方之複本, 不改呼叫端原物件; 無欄位之列不補, 保留ORM視空物件為無效輸入之行為
    if (isPkIdString(ds[woName], keys)) {
        each(data, (v) => {
            if (size(v) > 0 && !isestr(v.id) && !isnum(v.id)) {
                v.id = genIDSeq()
            }
        })
    }

    //復原data型態, 若原本data為物件則取第0個回傳
    data = one ? data[0] : data

    return data
}


async function mapOrm(ds, woItems, userId, woName, mode, input) {
    //由woName自動綁定至woItems內的ORM物件
    let err = null
    let r

    //check
    if (!iseobj(woItems)) {
        return Promise.reject(`invalid woItems`)
    }

    //wo
    let wo = get(woItems, woName, null)

    //check
    if (wo === null) {
        return Promise.reject(`can not find table[${woName}] in ORM`)
    }

    if (mode === 'select') {

        //select
        r = await wo.select(input)
            .catch((msg) => {
                console.log(`${woName}.select catch`, msg)
                err = 'failed to select data'
            })

        //check
        if (isestr(err)) {
            return Promise.reject(err)
        }

    }
    else if (mode === 'insert' || mode === 'save') {

        //inputOrig, 呼叫端原輸入, 逐筆失敗之訊息以呼叫端視角列出(本套件補出之主鍵只寫於複本, reject時呼叫端未曾取得)
        let inputOrig = input

        //check, 主鍵會被clearXSS改寫者整批拒絕, 不寫入任何一筆
        let failsIdXSS = getItemsIdXSS(input)
        if (size(failsIdXSS) > 0) {
            console.log(`${woName}.${mode} id changed by clearXSS`, failsIdXSS)
            return Promise.reject(getMsgIdXSS(mode === 'insert' ? 'failed to insert data' : 'failed to save data', failsIdXSS))
        }

        //adjustData
        try {
            input = adjustData(ds, woName, userId, input, mode)
        }
        catch (e) {
            console.log(`${woName}.adjustData catch`, e.toString())
            err = 'failed to adjust data'
            return Promise.reject(err)
        }

        //save
        if (mode === 'insert') {
            r = await wo.insert(input)
                .catch((msg) => {
                    console.log(`${woName}.insert catch`, msg)
                    err = 'failed to insert data'
                })
        }
        else if (mode === 'save') {
            r = await wo.save(input)
                .catch((msg) => {
                    console.log(`${woName}.save catch`, msg)
                    err = 'failed to save data'
                })
        }

        //check
        if (isestr(err)) {
            return Promise.reject(err)
        }

        //check, save單筆失敗時整批仍resolve並以該筆ok為0回報, 須逐筆檢查
        //insert之錯誤皆屬整批性而reject, 其回傳為聚合物件而非逐筆陣列, 故不須檢查
        if (mode === 'save') {
            let fails = getItemsFail(r, input)
            if (size(fails) > 0) {
                console.log(`${woName}.save fail`, fails)
                return Promise.reject(getMsgFail('failed to save data', getItemsFail(r, inputOrig)))
            }
        }

        //僅回傳id避免大量數據時造成負擔
        if (isarr(input)) {
            r = map(input, (v) => {
                return { id: v.id }
            })
        }
        else {
            r = { id: input.id }
        }
        //console.log(mode, ' r', r)

    }
    else if (mode === 'del') {

        //del
        r = await wo.del(input)
            .catch((msg) => {
                console.log(`${woName}.del catch`, msg)
                err = 'failed to delete data'
            })

        //check, 單筆失敗時整批仍resolve並以該筆ok為0回報, 須逐筆檢查
        if (!isestr(err)) {
            let fails = getItemsFail(r, input)
            if (size(fails) > 0) {
                console.log(`${woName}.del fail`, fails)
                err = getMsgFail('failed to delete data', fails)
            }
        }

    }
    else if (mode === 'delAll') {

        //delAll
        r = await wo.delAll(input)
            .catch((msg) => {
                console.log(`${woName}.delAll catch`, msg)
                err = 'failed to delete data'
            })

    }
    else if (mode === 'mix') {

        //check
        if (!iseobj(input)) {
            return Promise.reject('invalid input of mix, need the result object of ltdtDiffByKey')
        }

        //check, 新增與修改之主鍵會被clearXSS改寫者, 於任何步驟寫入之前整批拒絕
        let msgsIdXSS = []
        for (let [key, msg] of [['add', 'failed to insert data'], ['diff', 'failed to update data']]) {
            let fails = getItemsIdXSS(get(input, key, []))
            if (size(fails) > 0) {
                console.log(`${woName}.mix ${key} id changed by clearXSS`, fails)
                msgsIdXSS.push(getMsgIdXSS(msg, fails))
            }
        }
        if (size(msgsIdXSS) > 0) {
            return Promise.reject(join(msgsIdXSS, '; '))
        }

        //rt,r
        let rt
        r = [] //default to array

        //msgsFail, 逐筆失敗僅影響該筆, 不中斷後續步驟, 待全部步驟完成後一併reject; 整批性錯誤則仍立即reject
        let msgsFail = []

        let add = get(input, 'add', [])
        if (size(add) > 0) {

            //adjustData
            try {
                add = adjustData(ds, woName, userId, add, 'insert+save')
            }
            catch (e) {
                console.log(`${woName}.adjustData catch`, e.toString())
                err = 'failed to adjust data'
                return Promise.reject(err)
            }

            //insert
            await wo.insert(add)
                .catch((msg) => {
                    console.log(`${woName}.insert catch`, msg)
                    err = 'failed to insert data'
                })

            //check
            if (isestr(err)) {
                return Promise.reject(err)
            }

            //r
            rt = map(add, (v) => {
                return { id: v.id } //僅回傳id避免大量數據時造成負擔
            })
            r = [...r, ...rt]
        }

        let del = get(input, 'del', [])
        if (size(del) > 0) {

            //del
            let rs = await wo.del(del)
                .catch((msg) => {
                    console.log(`${woName}.del catch`, msg)
                    err = 'failed to delete data'
                })

            //check
            if (isestr(err)) {
                return Promise.reject(err)
            }

            //check, 單筆失敗時整批仍resolve並以該筆ok為0回報, 須逐筆檢查
            let fails = getItemsFail(rs, del)
            if (size(fails) > 0) {
                console.log(`${woName}.del fail`, fails)
                msgsFail.push(getMsgFail('failed to delete data', fails))
            }

            //r
            rt = map(del, (v) => {
                return { id: v.id } //僅回傳id避免大量數據時造成負擔
            })
            r = [...r, ...rt]
        }

        let diff = get(input, 'diff', [])
        if (size(diff) > 0) {

            //diffOrig, 呼叫端原輸入, 逐筆失敗之訊息以呼叫端視角列出
            let diffOrig = diff

            //adjustData
            try {
                diff = adjustData(ds, woName, userId, diff)
            }
            catch (e) {
                console.log(`${woName}.adjustData catch`, e.toString())
                err = 'failed to adjust data'
                return Promise.reject(err)
            }

            //save
            let rs = await wo.save(diff)
                .catch((msg) => {
                    console.log(`${woName}.save catch`, msg)
                    err = 'failed to update data'
                })

            //check
            if (isestr(err)) {
                return Promise.reject(err)
            }

            //check, 單筆失敗時整批仍resolve並以該筆ok為0回報, 須逐筆檢查
            let fails = getItemsFail(rs, diff)
            if (size(fails) > 0) {
                console.log(`${woName}.save fail`, fails)
                msgsFail.push(getMsgFail('failed to update data', getItemsFail(rs, diffOrig)))
            }

            //r
            rt = map(diff, (v) => {
                return { id: v.id } //僅回傳id避免大量數據時造成負擔
            })
            r = [...r, ...rt]
        }

        //check, 各步驟之逐筆失敗於全部步驟完成後一併reject
        if (size(msgsFail) > 0) {
            return Promise.reject(join(msgsFail, '; '))
        }

        //console.log('mix r', r)
    }
    else {
        err = `invalid mode: ${mode}`
    }

    //check
    if (isestr(err)) {
        return Promise.reject(err)
    }

    return r
}


function getMapOrm(ds, woItems) {
    //每次呼叫各自綁定ds與woItems並回傳新函數, 令同一行程內之多個實例互不干擾; 回傳函數之參數形狀維持(userId, woName, mode, input)
    return async (userId, woName, mode, input) => {
        return mapOrm(ds, woItems, userId, woName, mode, input)
    }
}


export default getMapOrm
