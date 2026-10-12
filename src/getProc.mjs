import get from 'lodash-es/get.js'
import filter from 'lodash-es/filter.js'
import isarr from 'wsemi/src/isarr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import haskey from 'wsemi/src/haskey.mjs'
import pmSeries from 'wsemi/src/pmSeries.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isbol from 'wsemi/src/isbol.mjs'


function addFun(fs, f, name, useGuard = false) {
    //由外部添加擴充函數至該實例之陣列
    //延後1ms生效係沿用既有之生效時序: 原為避開模組層陣列於循環引用時之「Cannot access before initialization」,
    //改為各實例狀態後該原因已不成立, 惟使用端之啟動流程可能依賴此時序, 故保留

    //check, 非函數於註冊時即拋錯; useGuard(check用)另推入恆reject之守門函數, 令拋錯被呼叫端攔下時該實例仍維持fail-closed
    //註冊時拋錯屬建構期錯誤故為Error; 守門函數於procOrm內reject, 與procOrm其餘拒絕一致為字串
    if (!isfun(f)) {
        let msg = `${name} needs a function, but got ${typeof f}`
        if (useGuard) {
            fs.push(() => {
                return Promise.reject(msg)
            })
        }
        throw new Error(msg)
    }

    setTimeout(() => {
        fs.push(f)
    }, 1)

}


async function procOrm(st, userId, woName, mode, input) {
    //封裝mapOrm, 添加檢查userId功能, st為該實例之狀態

    //check
    if (!isfun(st.mapOrm)) {
        return Promise.reject(`invalid mapOrm`)
    }

    //check
    if (st.useCheckUser && !isestr(userId)) {
        console.log('userId', userId)
        console.log('invalid userId')
        return Promise.reject(`invalid userId`)
    }

    //isAdmin
    let isAdmin = 'n'

    //useCheckUser
    if (st.useCheckUser) {

        //check
        if (!isfun(st.getUserById)) {
            return Promise.reject(`invalid getUserById`)
        }

        //oSelf
        let oSelf = await st.getUserById(userId)

        //check
        if (!oSelf) {
            console.log('userId', userId)
            console.log('can not find user')
            return Promise.reject(`can not find user`)
        }

        //isAdmin
        isAdmin = get(oSelf, 'isAdmin')
        if (isAdmin !== 'y' && isAdmin !== 'n') {
            isAdmin = 'n'
        }

        //isActive
        let isActive = get(oSelf, 'isActive')
        if (isActive !== 'y' && isActive !== 'n') {
            isActive = 'n'
        }

        //check
        if (isActive !== 'y') {
            console.log('userId', userId)
            console.log('oSelf', oSelf)
            console.log('user is inactive or invalid')
            return Promise.reject(`user is inactive or invalid`)
        }

    }

    //funChecks, 擴充檢查, 提供給各 mOrm[OOO].mjs 檢查
    await pmSeries(st.funChecks, (v) => {
        return v({ woName, userId, isAdmin, mode, input })
    })

    //funPreProcessing, 擴充前處理input, 提供給各 mOrm[OOO].mjs 前處理
    //逐一呼叫, 各前處理皆收新建之參數物件, input為前一個回傳之input; 回傳須為含input之物件, 否則reject, 避免input成為undefined而令select回全表
    //迭代前先取快照, 呼叫進行中註冊者不套用於本次呼叫
    for (let f of [...st.funPreProcessing]) {
        let paramsOut = await f({ woName, userId, isAdmin, mode, input })
        if (!iseobj(paramsOut) || paramsOut.input === undefined) {
            return Promise.reject(`invalid return of pre-processing, need an object with input`)
        }
        input = paramsOut.input
    }

    //output
    let output = await st.mapOrm(userId, woName, mode, input)

    //useExcludeWhenNotAdmin, 非管理者則要過濾掉已刪除之數據
    if (st.useExcludeWhenNotAdmin && isAdmin === 'n') {
        if (mode === 'select' && isarr(output)) { //有可能為錯誤物件
            output = filter(output, (v) => {
                if (haskey(v, 'isActive')) { //針對有isActive屬性
                    return !(v.isActive === 'n') //過濾isActive='n'
                }
                return true
            })
        }
    }

    //funPostProcessing, 擴充後處理output, 提供給各 mOrm[OOO].mjs 後處理
    //逐一呼叫, 各後處理皆收新建之參數物件, output為前一個之回傳值, 回傳值成為新output; 迭代前先取快照
    for (let f of [...st.funPostProcessing]) {
        output = await f({ woName, userId, isAdmin, mode, input, output })
    }

    return output
}


function getProc(mapOrm, opt = {}) {

    //check
    if (!isfun(mapOrm)) {
        return Promise.reject(`invalid mapOrm`)
    }

    //useCheckUser
    let useCheckUser = get(opt, 'useCheckUser')
    if (!isbol(useCheckUser)) {
        useCheckUser = true
    }

    //getUserById, 不事先檢查, 因若useCheckUser=false可允許不給
    let getUserById = get(opt, 'getUserById')

    //useExcludeWhenNotAdmin
    let useExcludeWhenNotAdmin = get(opt, 'useExcludeWhenNotAdmin')
    if (!isbol(useExcludeWhenNotAdmin)) {
        useExcludeWhenNotAdmin = true
    }

    //st, 各實例之狀態, 每次呼叫各自建立, 令同一行程內之多個實例互不干擾
    let st = {
        funChecks: [],
        funPreProcessing: [],
        funPostProcessing: [],
        mapOrm,
        getUserById,
        useCheckUser,
        useExcludeWhenNotAdmin,
    }

    //回傳函數綁定st而不依賴this, 使用端可解構取用並當裸函數傳遞
    return {
        addFunCheck: (f) => {
            //由外部添加擴充檢查函數
            addFun(st.funChecks, f, 'addFunCheck', true)
        },
        addFunPreProcessing: (f) => {
            //由外部添加擴充前處理函數
            addFun(st.funPreProcessing, f, 'addFunPreProcessing')
        },
        addFunPostProcessing: (f) => {
            //由外部添加擴充後置處理函數
            addFun(st.funPostProcessing, f, 'addFunPostProcessing')
        },
        procOrm: async (userId, woName, mode, input) => {
            return procOrm(st, userId, woName, mode, input)
        },
    }
}


export default getProc
