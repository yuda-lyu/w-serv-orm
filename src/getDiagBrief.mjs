import size from 'lodash-es/size.js'
import take from 'lodash-es/take.js'
import map from 'lodash-es/map.js'
import getDiag from 'wsemi/src/getDiag.mjs'
import isProxy from 'wsemi/src/isProxy.mjs'
import { SAFE_KEYS } from './safeKeys.mjs'


//本套件之診斷宣告(R-DIAG-01, 規格為主控dspec〈診斷輸出與遮罩〉, 實作為wsemi之getDiag系列): 遮罩、細節拷貝、錯誤摘要與出口一律由wsemi處理, 本檔只宣告與提供本套件語意之摘要

//錯誤摘要之代碼集合: 本套件可搭配任一w-orm-*, 故宣告wsemi之全部具名集合(SYS、NODE恆含)
const CODES = ['sqlstate', 'sqlite', 'mysql', 'mssql', 'mongo', 'mongoServer', 'lmdb', 'level']

//另讀其code之巢狀錯誤鍵(sequelize之錯誤, 經w-orm-reladb等轉出)
const NESTED = ['original', 'parent']

//摘要中列出之失敗位置數上限, 同getMapOrm之getMsgFail
const N_SHOW = 10

//逐筆結果摘要至多掃描的元素數
const N_SCAN = 100000


function genDiag(opt, secrets) {
    //產生本套件之診斷出口: opt為使用端設定(讀其logDetail與funLog, 任何值皆可, 建構時取快照), secrets為秘密清單(getDiagSecrets之結果, 或回傳其之函數, 未給為無)
    //回傳wsemi之diag(label, safe, getDetail, level), 另帶brief、mask、copy、err、with
    //safeKeys為safe會用到之鍵(白名單外之鍵由wsemi丟棄; errType、errCode恆含), 單一來源為公開之safeKeys.mjs
    return getDiag(opt, { secrets, codes: CODES, nested: NESTED, safeKeys: SAFE_KEYS })
}


function getBriefFails(fails) {
    //失敗清單([{k, ...}])的摘要: 筆數與前N_SHOW筆的位置k, 不含主鍵與錯誤原文
    return {
        n: size(fails),
        ks: map(take(fails, N_SHOW), (v) => {
            return v !== null && typeof v === 'object' && Number.isInteger(v.k) ? v.k : null
        }),
    }
}


//取描述子與判斷自有鍵一律用內建函數(不執行getter、不觸發陷阱; Proxy由呼叫端先以isProxy排除)
const gd = Object.getOwnPropertyDescriptor


function hasOwn(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k)
}


const UNSAFE = Symbol('unsafe')


function readOk(v) {
    //逐筆結果元素的ok: 沿原型鏈只讀資料屬性; 遇存取器或Proxy(元素本身或其原型鏈上)無從安全判讀, 回UNSAFE; 無ok回undefined
    for (let x = v; x !== null; x = Object.getPrototypeOf(x)) {
        if (isProxy(x)) {
            return UNSAFE
        }
        let d = gd(x, 'ok')
        if (d !== undefined) {
            return hasOwn(d, 'value') ? d.value : UNSAFE
        }
    }
    return undefined
}


function getBriefResult(r) {
    //ORM寫入類函數的回傳結果(呼叫端已以isOrmFail判為失敗者)的摘要: 逐筆陣列列失敗筆數與位置; 聚合物件為{ ok: 0 }(判為失敗者其ok即0, 不再讀取其ok, 避免getter前後不同); Proxy不探測
    try {
        if (isProxy(r)) {
            return { type: 'Proxy' }
        }
        if (Array.isArray(r)) {
            let ks = []
            let n = 0
            let nScan = Math.min(r.length, N_SCAN) //掃描筆數上限(稀疏或巨大陣列不使診斷無限耗時), 超過者計入skipped
            let skipped = r.length - nScan
            let protoNonStd = Object.getPrototypeOf(r) !== Array.prototype
            for (let k = 0; k < nScan; k++) {
                let d = gd(r, k)
                if (d !== undefined && !hasOwn(d, 'value')) {
                    skipped++ //索引為存取器: 不執行, 以skipped標示摘要不完整
                    continue
                }
                if (d === undefined && protoNonStd) {
                    skipped++ //空洞且陣列的原型不是標準原型: 該索引可能由原型提供, 無從安全判讀
                    continue
                }
                let v = d !== undefined ? d.value : undefined
                let ok = v !== null && typeof v === 'object' ? readOk(v) : undefined
                if (ok === UNSAFE) {
                    skipped++ //元素為Proxy、其原型鏈有Proxy或ok為存取器: 不執行, 不計入
                    continue
                }
                if (ok === 0) {
                    n++
                    if (ks.length < N_SHOW) {
                        ks.push(k)
                    }
                }
            }
            return skipped > 0 ? { n, ks, skipped } : { n, ks }
        }
        if (r !== null && typeof r === 'object') {
            return { ok: 0 }
        }
        return { type: typeof r }
    }
    catch (e) {
        return { type: 'unknown' }
    }
}


function getBriefType(v) {
    //任意值的型別摘要(不含值): 供呼叫端傳入之無效參數(ds、WOrm、url、db、woItems、fp)的預設輸出
    try {
        if (v === null) {
            return { type: 'null' }
        }
        if (isProxy(v)) {
            return { type: 'Proxy' }
        }
        return { type: Array.isArray(v) ? 'array' : typeof v }
    }
    catch (e) {
        return { type: 'unknown' }
    }
}


function getBriefCount(v) {
    //資料列清單的筆數: 只認非Proxy之真陣列(不讀其length以外, 不執行getter), 其餘為null
    try {
        return Array.isArray(v) && !isProxy(v) ? v.length : null
    }
    catch (e) {
        return null
    }
}


export { genDiag, getBriefFails, getBriefResult, getBriefType, getBriefCount }
