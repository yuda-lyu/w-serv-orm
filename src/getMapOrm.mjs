import get from 'lodash/get'
import each from 'lodash/each'
import map from 'lodash/map'
import size from 'lodash/size'
import nowms2str from 'wsemi/src/nowms2str.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isestr from 'wsemi/src/isestr'


let _ds = null
let _woItems = null


function adjustData(woName, userId, data, mode = 'save') { //mode: 'insert', 'save', 'insert+save'

    //check
    if (!iseobj(_ds)) {
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
            r = await wo.save(input, { atomic: true })
                .catch((msg) => {
                    console.log(`${woName}.save catch`, msg)
                    err = '儲存資料失敗'
                })
        }

        //check
        if (isestr(err)) {
            return Promise.reject(err)
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
            return Promise.reject('mix僅支援輸入ltdtdiff結果物件')
        }

        //rt,r
        let rt
        r = [] //default to array

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
            await wo.del(del)
                .catch((msg) => {
                    console.log(`${woName}.save catch`, msg)
                    err = '刪除資料失敗'
                })

            //check
            if (isestr(err)) {
                return Promise.reject(err)
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
            await wo.save(diff)
                .catch((msg) => {
                    console.log(`${woName}.save catch`, msg)
                    err = '變更資料失敗'
                })

            //check
            if (isestr(err)) {
                return Promise.reject(err)
            }

            //r
            rt = map(diff, (v) => {
                return { id: v.id } //僅回傳id避免大量數據時造成負擔
            })
            r = [...r, ...rt]
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
