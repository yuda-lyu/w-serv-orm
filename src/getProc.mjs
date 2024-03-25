import get from 'lodash-es/get.js'
import size from 'lodash-es/size.js'
import filter from 'lodash-es/filter.js'
import isarr from 'wsemi/src/isarr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import haskey from 'wsemi/src/haskey.mjs'
import pmSeries from 'wsemi/src/pmSeries.mjs'
import pmChain from 'wsemi/src/pmChain.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isbol from 'wsemi/src/isbol.mjs'


let _funChecks = []
let _funPreProcessing = []
let _funPostProcessing = []
let _mapOrm = null
let _getUserById = null
let bCheckUser = true
let bExcludeWhenNotAdmin = true


function addFunCheck(f) {
    //由外部添加擴充檢查函數

    setTimeout(() => { //因互相引用的關係會出現「Cannot access '_funChecks' before initialization」, 故通過timer脫勾成為動態引用, 避開執行mInitialTestData時會先編譯與偵測問題
        _funChecks.push(f)
    }, 1)

}


function addFunPreProcessing(f) {
    //由外部添加擴充前處理函數

    setTimeout(() => { //因互相引用的關係會出現「Cannot access '_funChecks' before initialization」, 故通過timer脫勾成為動態引用, 避開執行mInitialTestData時會先編譯與偵測問題
        _funPreProcessing.push(f)
    }, 1)

}


function addFunPostProcessing(f) {
    //由外部添加擴充後置處理函數

    setTimeout(() => { //因互相引用的關係會出現「Cannot access '_funChecks' before initialization」, 故通過timer脫勾成為動態引用, 避開執行mInitialTestData時會先編譯與偵測問題
        _funPostProcessing.push(f)
    }, 1)

}


async function procOrm(userId, woName, mode, input) {
    //封裝mapOrm, 添加檢查userId功能

    //check
    if (!isfun(_mapOrm)) {
        return Promise.reject(`invalid mapOrm`)
    }

    //check
    if (bCheckUser && !isestr(userId)) {
        console.log('userId',userId)
        console.log('找不到使用者主鍵')
        return Promise.reject(`找不到使用者主鍵`)
    }

    //isAdmin
    let isAdmin = 'n'

    //bCheckUser
    if (bCheckUser) {

        //check
        if (!isfun(_getUserById)) {
            return Promise.reject(`invalid getUserById`)
        }

        //oSelf
        let oSelf = await _getUserById(userId)

        //check
        if (!oSelf) {
            console.log('userId',userId)
            console.log('找不到使用者資訊')
            return Promise.reject(`找不到使用者資訊`)
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
            console.log('userId',userId)
            console.log('oSelf',oSelf)
            console.log('使用者被停權或無有效使用者資訊')
            return Promise.reject(`使用者被停權或無有效使用者資訊`)
        }

    }

    //_funChecks, 擴充檢查, 提供給各 mOrm[OOO].mjs 檢查
    await pmSeries(_funChecks, (v) => {
        return v({ woName, userId, isAdmin, mode, input })
    })

    //_funPreProcessing, 擴充前處理input, 提供給各 mOrm[OOO].mjs 前處理
    if (size(_funPreProcessing) > 0) {
        let paramsIn = { woName, userId, isAdmin, mode, input } //將input與其他資訊一起封裝成params
        let paramsOut = await pmChain(_funPreProcessing, paramsIn) //各非同步函數拿到輸入處理完皆輸出一樣結構數據params, 使各非同步函數都可拿到非input的重要資訊
        input = paramsOut.input //由params提取input出來
    }

    //output
    let output = await _mapOrm(userId, woName, mode, input)

    //bExcludeWhenNotAdmin, 非管理者則要過濾掉已刪除之數據
    if (bExcludeWhenNotAdmin && isAdmin === 'n') {
        if (mode === 'select' && isarr(output)) { //有可能為錯誤物件
            output = filter(output, (v) => {
                if (haskey(v, 'isActive')) { //針對有isActive屬性
                    return !(v.isActive === 'n') //過濾isActive='n'
                }
                return true
            })
        }
    }

    //_funPostProcessing, 擴充後處理output, 提供給各 mOrm[OOO].mjs 後處理
    if (size(_funPostProcessing) > 0) {
        output = await pmChain(_funPostProcessing, { woName, userId, isAdmin, mode, input, output })
    }

    return output
}


function getProc(mapOrm, opt = {}) {

    //check
    if (!isfun(mapOrm)) {
        return Promise.reject(`invalid mapOrm`)
    }

    //save _mapOrm
    _mapOrm = mapOrm

    //bCheckUser
    bCheckUser = get(opt, 'bCheckUser')
    if (!isbol(bCheckUser)) {
        bCheckUser = true
    }

    //save _getUserById, 不事先檢查, 因若bCheckUser=false可允許不給
    _getUserById = get(opt, 'getUserById')

    //bExcludeWhenNotAdmin
    bExcludeWhenNotAdmin = get(opt, 'bExcludeWhenNotAdmin')
    if (!isbol(bExcludeWhenNotAdmin)) {
        bExcludeWhenNotAdmin = true
    }

    return {
        addFunCheck,
        addFunPreProcessing,
        addFunPostProcessing,
        procOrm,
    }
}


export default getProc
