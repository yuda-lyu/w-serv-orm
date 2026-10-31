import iseobj from 'wsemi/src/iseobj.mjs'
import pmSeries from 'wsemi/src/pmSeries.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import getTrace from 'wsemi/src/getTrace.mjs'
import checkOptRemoved from './checkOptRemoved.mjs'
import { getOptProc } from './getMapOrm.mjs'


//GUARD_MSGS, addFunCheck註冊非函數時守門函數之固定詞彙reject(typeof之全部結果), 不經遮罩(R-DIAG-01)
const GUARD_MSGS = ['undefined', 'object', 'boolean', 'number', 'bigint', 'string', 'symbol', 'function'].map((t) => `addFunCheck needs a function, but got ${t}`)


function extErr(st, err) {
    //擴充函數(使用端回呼)拋出或reject之值為外來值, 經本實例之diag.err移除連線憑證後轉出(無應處理者為原值, 身分不變); 守門函數之固定詞彙原樣; 未給diag者(直接使用getProc)原樣
    if (st.diag === null || (typeof err === 'string' && GUARD_MSGS.indexOf(err) >= 0)) {
        return err
    }
    return st.diag.err(err)
}


function addFun(fs, f, name, hook, useGuard, opt) {
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

    //opt.onTrace, 觀察回調(R-TRACE-01, 見規則帳本): 於擴充函數實際生效(推入陣列)當下同步通知, 供測試與使用端以事件而非等待毫秒同步; 未給時trace為null, 不組事件物件
    //取回調放在函數檢查之後, 使無效函數之拋錯與守門行為不受opt影響
    let trace = getTrace(opt)

    setTimeout(() => {
        fs.push(f)
        if (trace) {
            trace('active', { hook, n: fs.length })
        }
    }, 1)

}


async function procOrm(st, userId, woName, mode, input, opt) {
    //封裝mapOrm, 依序執行擴充檢查、前處理、ORM操作與後處理, st為該實例之狀態
    //不做授權: 不檢查使用者亦不依使用者過濾數據, userId只供寫入稽核欄位與交給擴充函數; 開放給前端時須由開放處負責授權
    //st.mapOrm已於getProc建立st時驗證為函數, 且st不外露, 故此處不再檢查

    //opt(第5參數: mustExist, R-ONLYMOD-01; keepUserId, R-KEEPUSER-01)先於任何擴充函數驗證: 無效之opt以固定字串拒收, 不得先執行擴充函數(其可能有寫入等副作用, 且check拋錯會遮蔽固定拒收字串);
    //mapOrm內仍會再驗(直接使用getMapOrm者), 結果相同; opt不交給擴充函數(其參數物件形狀維持)
    let optProc = getOptProc(mode, opt)
    if (optProc.err !== null) {
        return Promise.reject(optProc.err)
    }

    //funChecks, 擴充檢查, 提供給各 mOrm[OOO].mjs 檢查; 其reject經extErr
    try {
        await pmSeries(st.funChecks, (v) => {
            return v({ woName, userId, mode, input })
        })
    }
    catch (err) {
        throw extErr(st, err)
    }

    //funPreProcessing, 擴充前處理input, 提供給各 mOrm[OOO].mjs 前處理
    //逐一呼叫, 各前處理皆收新建之參數物件, input為前一個回傳之input; 回傳須為含input之物件, 否則reject, 避免input成為undefined而令select回全表
    //迭代前先取快照, 呼叫進行中註冊者不套用於本次呼叫
    for (let f of [...st.funPreProcessing]) {
        let paramsOut = null
        try {
            paramsOut = await f({ woName, userId, mode, input })
        }
        catch (err) {
            throw extErr(st, err)
        }
        if (!iseobj(paramsOut) || paramsOut.input === undefined) {
            return Promise.reject(`invalid return of pre-processing, need an object with input`)
        }
        input = paramsOut.input
    }

    //output
    //opt(第5參數, R-ONLYMOD-01、R-KEEPUSER-01)交給mapOrm使用
    let output = await st.mapOrm(userId, woName, mode, input, opt)

    //funPostProcessing, 擴充後處理output, 提供給各 mOrm[OOO].mjs 後處理
    //逐一呼叫, 各後處理皆收新建之參數物件, output為前一個之回傳值, 回傳值成為新output; 迭代前先取快照
    for (let f of [...st.funPostProcessing]) {
        try {
            output = await f({ woName, userId, mode, input, output })
        }
        catch (err) {
            throw extErr(st, err)
        }
    }

    return output
}


function getProc(mapOrm, opt = {}, diag = undefined) {
    //mapOrm為getMapOrm之回傳函數, opt目前無設定鍵, 只檢查已移除之設定, 檢查與WServOrm一致; 本檔為內部檔, 不屬公開子模組(README〈公開子模組〉): 下游測試組真實procOrm請傳替身WOrm給WServOrm, 探測已移除之設定請用checkOptRemoved
    //diag(選用, 內部)為WServOrm實例之診斷出口, 擴充函數之reject經其diag.err(R-DIAG-01); 未給者原樣轉出
    //建構期之錯誤一律為Error, 與procOrm之字串reject區隔

    //checkOptRemoved
    checkOptRemoved(opt)

    //check
    if (!isfun(mapOrm)) {
        throw new Error(`invalid mapOrm`)
    }

    //st, 各實例之狀態, 每次呼叫各自建立, 令同一行程內之多個實例互不干擾
    let st = {
        funChecks: [],
        funPreProcessing: [],
        funPostProcessing: [],
        mapOrm,
        diag: isfun(diag) ? diag : null,
    }

    //回傳函數綁定st而不依賴this, 使用端可解構取用並當裸函數傳遞
    return {
        addFunCheck: (f, opt) => {
            //由外部添加擴充檢查函數
            addFun(st.funChecks, f, 'addFunCheck', 'check', true, opt)
        },
        addFunPreProcessing: (f, opt) => {
            //由外部添加擴充前處理函數
            addFun(st.funPreProcessing, f, 'addFunPreProcessing', 'preProcessing', false, opt)
        },
        addFunPostProcessing: (f, opt) => {
            //由外部添加擴充後置處理函數
            addFun(st.funPostProcessing, f, 'addFunPostProcessing', 'postProcessing', false, opt)
        },
        procOrm: async (userId, woName, mode, input, opt) => {
            return procOrm(st, userId, woName, mode, input, opt)
        },
    }
}


export default getProc
