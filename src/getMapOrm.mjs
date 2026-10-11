import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import map from 'lodash-es/map.js'
import size from 'lodash-es/size.js'
import take from 'lodash-es/take.js'
import join from 'lodash-es/join.js'
import nowms2str from 'wsemi/src/nowms2str.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isnum from 'wsemi/src/isnum.mjs'
import clearXSS from 'wsemi/src/clearXSS.mjs'
import getItemsFail from './getItemsFail.mjs'


let _ds = null
let _woItems = null


function getMsgFail(msg, fails) {
    //前端訊息僅列出失敗筆, 錯誤原文另由console.log輸出, 與既有整批錯誤之處理一致
    //有效主鍵(非空字串或數字)列為id[...], 否則列其於輸入內之位置, 失敗筆數過多時僅列前nShow筆並附總筆數

    //nShow
    let nShow = 10

    //ss
    let ss = map(take(fails, nShow), (v) => {
        if (isestr(v.id) || isnum(v.id)) {
            return `id[${v.id}]`
        }
        return `第${v.k + 1}筆`
    })

    //c
    let c = `${msg}: ${join(ss, ', ')}`
    if (size(fails) > nShow) {
        c += `等共${size(fails)}筆`
    }

    return c
}


function adjustData(woName, userId, data, mode = 'save') { //mode: 'insert', 'save', 'insert+save'

    //check
    if (!iseobj(_ds)) {
        console.log('ds', _ds)
        throw new Error('invalid ds')
    }

    //keys
    let keys = _ds[woName].keys

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

    //復原data型態, 若原本data為物件則取第0個回傳
    data = one ? data[0] : data

    return data
}


async function mapOrm(userId, woName, mode, input) {
    //由woName自動綁定至woItems內的ORM物件
    let err = null
    let r

    //check
    if (!iseobj(_woItems)) {
        return Promise.reject(`無有效woItems`)
    }

    //wo
    let wo = get(_woItems, woName, null)

    //check
    if (wo === null) {
        return Promise.reject(`ORM找不到表名稱: ${woName}`)
    }

    if (mode === 'select') {

        //select
        r = await wo.select(input)
            .catch((msg) => {
                console.log(`${woName}.select catch`, msg)
                err = '取得資料失敗'
            })

        //check
        if (isestr(err)) {
            return Promise.reject(err)
        }

    }
    else if (mode === 'insert' || mode === 'save') {

        //adjustData
        try {
            input = adjustData(woName, userId, input, mode)
        }
        catch (e) {
            console.log(`adjustData catch`, e.toString())
            err = '調整資料失敗'
            return Promise.reject(err)
        }

        //save
        if (mode === 'insert') {
            r = await wo.insert(input)
                .catch((msg) => {
                    console.log(`${woName}.save catch`, msg)
                    err = '新增資料失敗'
                })
        }
        else if (mode === 'save') {
            r = await wo.save(input)
                .catch((msg) => {
                    console.log(`${woName}.save catch`, msg)
                    err = '儲存資料失敗'
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
                return Promise.reject(getMsgFail('儲存資料失敗', fails))
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
                err = '刪除資料失敗'
            })

        //check, 單筆失敗時整批仍resolve並以該筆ok為0回報, 須逐筆檢查
        if (!isestr(err)) {
            let fails = getItemsFail(r, input)
            if (size(fails) > 0) {
                console.log(`${woName}.del fail`, fails)
                err = getMsgFail('刪除資料失敗', fails)
            }
        }

    }
    else if (mode === 'delAll') {

        //delAll
        r = await wo.delAll(input)
            .catch((msg) => {
                console.log(`${woName}.delAll catch`, msg)
                err = '刪除資料失敗'
            })

    }
    else if (mode === 'mix') {

        //check
        if (!iseobj(input)) {
            return Promise.reject('mix僅支援輸入ltdtDiffByKey結果物件')
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
                add = adjustData(woName, userId, add, 'insert+save')
            }
            catch (e) {
                console.log(`adjustData catch`, e.toString())
                err = '調整資料失敗'
                return Promise.reject(err)
            }

            //insert
            await wo.insert(add)
                .catch((msg) => {
                    console.log(`${woName}.save catch`, msg)
                    err = '新增資料失敗'
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
                    console.log(`${woName}.save catch`, msg)
                    err = '刪除資料失敗'
                })

            //check
            if (isestr(err)) {
                return Promise.reject(err)
            }

            //check, 單筆失敗時整批仍resolve並以該筆ok為0回報, 須逐筆檢查
            let fails = getItemsFail(rs, del)
            if (size(fails) > 0) {
                console.log(`${woName}.del fail`, fails)
                msgsFail.push(getMsgFail('刪除資料失敗', fails))
            }

            //r
            rt = map(del, (v) => {
                return { id: v.id } //僅回傳id避免大量數據時造成負擔
            })
            r = [...r, ...rt]
        }

        let diff = get(input, 'diff', [])
        if (size(diff) > 0) {

            //adjustData
            try {
                diff = adjustData(woName, userId, diff)
            }
            catch (e) {
                console.log(`adjustData catch`, e.toString())
                err = '調整資料失敗'
                return Promise.reject(err)
            }

            //save
            let rs = await wo.save(diff)
                .catch((msg) => {
                    console.log(`${woName}.save catch`, msg)
                    err = '變更資料失敗'
                })

            //check
            if (isestr(err)) {
                return Promise.reject(err)
            }

            //check, 單筆失敗時整批仍resolve並以該筆ok為0回報, 須逐筆檢查
            let fails = getItemsFail(rs, diff)
            if (size(fails) > 0) {
                console.log(`${woName}.save fail`, fails)
                msgsFail.push(getMsgFail('變更資料失敗', fails))
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
    _ds = ds
    _woItems = woItems
    return mapOrm
}


export default getMapOrm
